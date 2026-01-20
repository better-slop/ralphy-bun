import { join } from "node:path";
import { stat } from "node:fs/promises";
import type {
  AgentEngine,
  AgentUsageTotals,
  PrdRequirement,
  PrdRequirementFailure,
  PrdRequirementsResult,
  PrdRunTask,
  RunPrdRequest,
  RunPrdResponse,
} from "../shared/types";
import { runAgent } from "./agents/runner";
import { createBranchPerTaskManager, ensureUniqueBranchName, parseBranchList, slugifyTask, type GitRunner } from "./git/branch";
import { createPullRequest } from "./git/pr";
import { createWorktreeManager } from "./parallel/worktrees";
import { logTaskHistory } from "./progress";
import { runSingleTask } from "./single";
import { parseMarkdownTasks } from "./tasks/markdown";
import { completeTask, getNextTask } from "./tasks/source";
import { parseYamlTasks } from "./tasks/yaml";

const pathExists = async (path: string) => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

const hasDependencies = (payload: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }) =>
  Object.keys(payload.dependencies ?? {}).length > 0 ||
  Object.keys(payload.devDependencies ?? {}).length > 0;

const defaultGitRunner: GitRunner = async (args, options) => {
  const process = Bun.spawn(["git", ...args], {
    cwd: options?.cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  const exitCode = await process.exited;
  if (exitCode !== 0) {
    const trimmed = stderr.trim();
    throw new Error(trimmed.length > 0 ? trimmed : "git command failed");
  }
  return { stdout };
};

const getCurrentBranch = async (runner: GitRunner, cwd: string) => {
  const { stdout } = await runner(["rev-parse", "--abbrev-ref", "HEAD"], { cwd });
  return stdout.trim();
};

const listBranches = async (runner: GitRunner, cwd: string) => {
  const { stdout } = await runner(["branch", "--list"], { cwd });
  return parseBranchList(stdout);
};

const buildIntegrationBranchName = (group: string, existingBranches: string[]) => {
  const slug = slugifyTask(group);
  const baseName = `ralphy/integration-group-${slug}`;
  return ensureUniqueBranchName(baseName, existingBranches, 60);
};

const tryGit = async (runner: GitRunner, cwd: string, args: readonly string[]) => {
  try {
    const { stdout } = await runner(args, { cwd });
    return { status: "ok" as const, stdout };
  } catch (error) {
    const message = error instanceof Error ? error.message : "git command failed";
    return { status: "error" as const, message };
  }
};

const listConflicts = async (runner: GitRunner, cwd: string) => {
  const { stdout } = await runner(["diff", "--name-only", "--diff-filter=U"], { cwd });
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
};

const isMergeInProgress = async (runner: GitRunner, cwd: string) => {
  const result = await tryGit(runner, cwd, ["rev-parse", "-q", "--verify", "MERGE_HEAD"]);
  if (result.status === "error") {
    return false;
  }
  return result.stdout.trim().length > 0;
};

const buildMergePrompt = (files: string[]) => `You are resolving a git merge conflict. The following files have conflicts:

${files.join("\n")}

For each conflicted file:
1. Read the file to see the conflict markers (<<<<<<< HEAD, =======, >>>>>>> branch)
2. Understand what both versions are trying to do
3. Edit the file to resolve the conflict by combining both changes intelligently
4. Remove all conflict markers
5. Make sure the resulting code is valid and compiles

After resolving all conflicts:
1. Run 'git add' on each resolved file
2. Run 'git commit --no-edit' to complete the merge

Be careful to preserve functionality from BOTH branches. The goal is to integrate all features.`;

const resolveEngine = (engine?: AgentEngine): AgentEngine => engine ?? "claude";

const resolveMergeWithAi = async (options: {
  runner: GitRunner;
  agentRunner: typeof runAgent;
  cwd: string;
  engine: AgentEngine;
}) => {
  const conflicts = await listConflicts(options.runner, options.cwd);
  if (conflicts.length === 0) {
    return { status: "ok" as const };
  }
  await options.agentRunner(options.engine, buildMergePrompt(conflicts), { cwd: options.cwd });
  const remaining = await listConflicts(options.runner, options.cwd);
  if (remaining.length === 0) {
    if (await isMergeInProgress(options.runner, options.cwd)) {
      const commitResult = await tryGit(options.runner, options.cwd, ["commit", "--no-edit"]);
      if (commitResult.status === "error") {
        return { status: "error" as const, message: commitResult.message };
      }
    }
    return { status: "ok" as const };
  }
  await tryGit(options.runner, options.cwd, ["merge", "--abort"]);
  return { status: "error" as const, message: "Merge conflict could not be resolved automatically" };
};

const resolveTaskSourcePath = (options: RunPrdRequest, cwd: string) => {
  if (options.yaml) {
    return join(cwd, options.yaml);
  }

  return join(cwd, options.prd ?? "PRD.md");
};

const fail = (requirement: PrdRequirement, message: string): PrdRequirementFailure => ({
  requirement,
  message,
});

const ensureMaxIterations = (value?: number) => {
  if (value === undefined) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.max(0, value);
};

const createUsageTotals = (): AgentUsageTotals => ({
  inputTokens: 0,
  outputTokens: 0,
});

const addUsageTotals = (totals: AgentUsageTotals, usage: AgentUsageTotals) => {
  totals.inputTokens += usage.inputTokens;
  totals.outputTokens += usage.outputTokens;
  if (usage.cost !== undefined) {
    totals.cost = (totals.cost ?? 0) + usage.cost;
  }
  if (usage.durationMs !== undefined) {
    totals.durationMs = (totals.durationMs ?? 0) + usage.durationMs;
  }
};

const buildPrTitle = (task: string) => `Ralphy: ${task}`;

const buildPrBody = (task: string) => `## Summary\n- ${task}\n`;

type RunPrdDeps = {
  runner?: typeof runSingleTask;
  getNextTask?: typeof getNextTask;
  completeTask?: typeof completeTask;
  branchManagerFactory?: typeof createBranchPerTaskManager;
  createPullRequest?: typeof createPullRequest;
  worktreeManagerFactory?: typeof createWorktreeManager;
  gitRunner?: GitRunner;
  agentRunner?: typeof runAgent;
};

export const checkPrdRequirements = async (
  options: RunPrdRequest & { cwd?: string },
): Promise<PrdRequirementsResult> => {
  const cwd = options.cwd ?? process.cwd();
  const failures: PrdRequirementFailure[] = [];

  if (!(await pathExists(join(cwd, ".git")))) {
    failures.push(fail("git", `Missing .git directory in ${cwd}`));
  }

  if (!options.github) {
    const taskSourcePath = resolveTaskSourcePath(options, cwd);
    if (!(await pathExists(taskSourcePath))) {
      failures.push(fail("task-source", `Missing task source file: ${taskSourcePath}`));
    }
  }

  const packagePath = join(cwd, "package.json");
  if (await pathExists(packagePath)) {
    const contents = await Bun.file(packagePath).text();
    const parsed = JSON.parse(contents) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    if (hasDependencies(parsed)) {
      const nodeModulesPath = join(cwd, "node_modules");
      if (!(await pathExists(nodeModulesPath))) {
        failures.push(fail("dependencies", `Missing node_modules in ${cwd}`));
      }
    }
  }

  if (failures.length > 0) {
    return { status: "error", failures };
  }

  return { status: "ok" };
};

const buildTaskSourceOptions = (options: RunPrdRequest, cwd: string) => ({
  prd: options.prd,
  yaml: options.yaml,
  github: options.github,
  githubLabel: options.githubLabel,
  cwd,
});

const buildSuccessTask = (task: string, source: PrdRunTask["source"], attempts: number, response: string): PrdRunTask => ({
  task,
  source,
  status: "completed",
  attempts,
  response,
});

const buildFailureTask = (task: string, source: PrdRunTask["source"], attempts: number, error: string): PrdRunTask => ({
  task,
  source,
  status: "failed",
  attempts,
  error,
});

type ParallelTask = {
  text: string;
  source: PrdRunTask["source"];
  line?: number;
  group: string;
  index: number;
};

type ParallelGroup = {
  group: string;
  tasks: ParallelTask[];
};

type ParallelTasksResult =
  | { status: "ok"; source: PrdRunTask["source"]; groups: ParallelGroup[]; total: number; truncated: boolean }
  | { status: "empty"; source: PrdRunTask["source"] }
  | { status: "error"; message: string };

const resolveMaxParallel = (value: number | undefined, groupCount: number) => {
  if (!Number.isFinite(value)) {
    return Math.max(1, groupCount);
  }
  return Math.max(1, Math.min(groupCount, Math.floor(value ?? 1)));
};

const groupParallelTasks = (tasks: ParallelTask[]): ParallelGroup[] => {
  const groups = new Map<string, ParallelTask[]>();
  tasks.forEach((task) => {
    const key = task.group;
    const existing = groups.get(key);
    if (existing) {
      existing.push(task);
      return;
    }
    groups.set(key, [task]);
  });
  return Array.from(groups.entries()).map(([group, groupedTasks]) => ({
    group,
    tasks: groupedTasks,
  }));
};

const loadParallelTasks = async (
  options: RunPrdRequest,
  cwd: string,
  maxIterations: number,
): Promise<ParallelTasksResult> => {
  if (options.github) {
    return { status: "error", message: "Parallel mode does not support GitHub task sources" };
  }

  const sourcePath = resolveTaskSourcePath(options, cwd);
  const file = Bun.file(sourcePath);
  if (!(await file.exists())) {
    return { status: "error", message: `Missing task source file: ${sourcePath}` };
  }

  const contents = await file.text();
  const limit = Number.isFinite(maxIterations) ? Math.max(0, maxIterations) : Number.POSITIVE_INFINITY;
  const tasks: ParallelTask[] = [];

  if (options.yaml) {
    const parsed = parseYamlTasks(contents).filter((task) => !task.completed);
    const limited = limit === Number.POSITIVE_INFINITY ? parsed : parsed.slice(0, limit);
    let index = 0;
    limited.forEach((task) => {
      tasks.push({
        text: task.title,
        source: "yaml",
        line: task.line,
        group: String(task.parallelGroup),
        index,
      });
      index += 1;
    });
    if (tasks.length === 0) {
      return { status: "empty", source: "yaml" };
    }
    return {
      status: "ok",
      source: "yaml",
      groups: groupParallelTasks(tasks),
      total: parsed.length,
      truncated: limited.length < parsed.length,
    };
  }

  const parsed = parseMarkdownTasks(contents).filter((task) => !task.completed);
  const limited = limit === Number.POSITIVE_INFINITY ? parsed : parsed.slice(0, limit);
  let index = 0;
  limited.forEach((task) => {
    tasks.push({
      text: task.text,
      source: "markdown",
      line: task.line,
      group: "default",
      index,
    });
    index += 1;
  });

  if (tasks.length === 0) {
    return { status: "empty", source: "markdown" };
  }

  return {
    status: "ok",
    source: "markdown",
    groups: groupParallelTasks(tasks),
    total: parsed.length,
    truncated: limited.length < parsed.length,
  };
};

const createSerialQueue = () => {
  let chain = Promise.resolve();
  return async <T>(work: () => Promise<T>): Promise<T> => {
    const next = chain.then(work, work);
    chain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };
};

const registerCleanupSignals = (cleanup: () => Promise<void>) => {
  let handled = false;
  const handler = (signal: string) => {
    if (handled) {
      return;
    }
    handled = true;
    void cleanup().finally(() => {
      if (signal === "SIGINT") {
        process.exitCode = 130;
      }
      if (signal === "SIGTERM") {
        process.exitCode = 143;
      }
    });
  };

  process.on("SIGINT", handler);
  process.on("SIGTERM", handler);

  return () => {
    process.off("SIGINT", handler);
    process.off("SIGTERM", handler);
  };
};

type ParallelGroupResult = {
  group: string;
  branches: string[];
  tasks: Array<PrdRunTask & { index: number }>;
  completed: number;
  usage: AgentUsageTotals;
  failure?: { stage: "agent" | "complete"; message: string; task: string };
};

type ParallelRunResult = {
  tasks: PrdRunTask[];
  completed: number;
  iterations: number;
  usage: AgentUsageTotals;
  failure?: { stage: "agent" | "complete"; message: string; task: string };
  stopped: "no-tasks" | "max-iterations";
};

const buildTaskSourceOverride = (
  task: ParallelTask,
  record: { copiedTaskSource?: string; path: string },
  options: RunPrdRequest,
) => {
  const path = record.copiedTaskSource ?? resolveTaskSourcePath(options, record.path);
  if (task.source === "yaml") {
    return { cwd: record.path, yaml: path };
  }
  return { cwd: record.path, prd: path };
};

const runParallelGroup = async (
  group: ParallelGroup,
  options: RunPrdRequest,
  cwd: string,
  runner: typeof runSingleTask,
  complete: typeof completeTask,
  worktreeManager: ReturnType<typeof createWorktreeManager>,
  baseBranch: string,
): Promise<ParallelGroupResult> => {
  const taskSourcePath = resolveTaskSourcePath(options, cwd);
  const record = await worktreeManager.createWorktree({
    group: group.group,
    taskSourcePath,
    baseBranch,
  });
  const usage = createUsageTotals();
  const results: Array<PrdRunTask & { index: number }> = [];
  let completed = 0;

  for (const task of group.tasks) {
    const result = await runner({
      task: task.text,
      engine: options.engine,
      skipTests: options.skipTests,
      skipLint: options.skipLint,
      autoCommit: options.autoCommit,
      maxRetries: options.maxRetries,
      retryDelay: options.retryDelay,
      promptMode: "prd",
      taskSource: task.source,
      taskSourcePath: options.yaml ?? options.prd,
      cwd: record.path,
    });

    if (result.status !== "ok") {
      const message = result.status === "dry-run" ? "Dry run not supported for PRD execution" : result.error;
      const attempts = result.status === "dry-run" ? 0 : result.attempts;
      await logTaskHistory(record.path, task.text, "failed");
      results.push({ ...buildFailureTask(task.text, task.source, attempts, message), index: task.index });
      return {
        group: group.group,
        branches: [],
        tasks: results,
        completed,
        usage,
        failure: { stage: "agent", message, task: task.text },
      };
    }

    addUsageTotals(usage, result.usage);
    await logTaskHistory(record.path, task.text, "completed");
    results.push({ ...buildSuccessTask(task.text, task.source, result.attempts, result.response), index: task.index });
    completed += 1;

    const completion = await complete(task.text, buildTaskSourceOverride(task, record, options));
    if (completion.status === "updated" || completion.status === "already-complete") {
      continue;
    }
    const message = "Task not found in source";
    return {
      group: group.group,
      branches: [],
      tasks: results,
      completed,
      usage,
      failure: { stage: "complete", message, task: task.text },
    };
  }

  return { group: group.group, branches: [record.branch], tasks: results, completed, usage };
};

const runParallelTasks = async (
  options: RunPrdRequest,
  cwd: string,
  maxIterations: number,
  deps: RunPrdDeps,
): Promise<ParallelRunResult | RunPrdResponse> => {
  if (options.branchPerTask || options.createPr || options.draftPr) {
    return {
      status: "error",
      stage: "pr",
      message: "Parallel mode does not support branch-per-task or PR creation",
      iterations: 0,
      tasks: [],
      usage: createUsageTotals(),
    };
  }

  const parallelTasks = await loadParallelTasks(options, cwd, maxIterations);
  if (parallelTasks.status === "error") {
    return {
      status: "error",
      stage: "task-source",
      message: parallelTasks.message,
      iterations: 0,
      tasks: [],
      usage: createUsageTotals(),
    };
  }
  if (parallelTasks.status === "empty") {
    return {
      tasks: [],
      completed: 0,
      iterations: 0,
      usage: createUsageTotals(),
      stopped: "no-tasks",
    };
  }

  const gitRunner = deps.gitRunner ?? defaultGitRunner;
  const agentRunner = deps.agentRunner ?? runAgent;
  const worktreeFactory = deps.worktreeManagerFactory ?? createWorktreeManager;
  const worktreeManager = worktreeFactory({ cwd, baseBranch: options.baseBranch, runner: gitRunner });
  const queue = [...parallelTasks.groups];
  const maxParallel = resolveMaxParallel(options.maxParallel, queue.length);
  const serial = createSerialQueue();
  const runner = deps.runner ?? runSingleTask;
  const complete = deps.completeTask ?? completeTask;
  const results: ParallelGroupResult[] = [];
  const completedBranches: string[] = [];
  const integrationBranches: string[] = [];
  const isYaml = parallelTasks.source === "yaml";
  const shouldIntegrate = isYaml && parallelTasks.groups.length > 1;
  const originalBaseBranch = options.baseBranch?.trim() || (await getCurrentBranch(gitRunner, cwd));
  let baseBranch = originalBaseBranch;

  const mergeGroupIntoIntegration = async (group: string, branches: string[]) => {
    if (!shouldIntegrate || branches.length === 0) {
      return { status: "ok" as const };
    }
    const existing = await listBranches(gitRunner, cwd);
    const integrationBranch = buildIntegrationBranchName(group, existing);
    const createResult = await tryGit(gitRunner, cwd, ["branch", integrationBranch, baseBranch]);
    if (createResult.status === "error") {
      return { status: "error" as const, message: createResult.message };
    }
    const headResult = await tryGit(gitRunner, cwd, ["symbolic-ref", "--short", "HEAD"]);
    const currentHead = headResult.status === "ok" ? headResult.stdout.trim() : "";
    const checkoutResult = await tryGit(gitRunner, cwd, ["checkout", integrationBranch]);
    if (checkoutResult.status === "error") {
      await tryGit(gitRunner, cwd, ["branch", "-D", integrationBranch]);
      return { status: "error" as const, message: checkoutResult.message };
    }

    for (const branch of branches) {
      const mergeResult = await tryGit(gitRunner, cwd, ["merge", "--no-edit", branch]);
      if (mergeResult.status === "error") {
        await tryGit(gitRunner, cwd, ["merge", "--abort"]);
        if (currentHead.length > 0) {
          await tryGit(gitRunner, cwd, ["checkout", currentHead]);
        } else {
          await tryGit(gitRunner, cwd, ["checkout", originalBaseBranch]);
        }
        await tryGit(gitRunner, cwd, ["branch", "-D", integrationBranch]);
        return { status: "error" as const, message: mergeResult.message };
      }
    }

    if (currentHead.length > 0) {
      await tryGit(gitRunner, cwd, ["checkout", currentHead]);
    } else {
      await tryGit(gitRunner, cwd, ["checkout", originalBaseBranch]);
    }

    return { status: "ok" as const, integrationBranch };
  };

  const mergeBranchesIntoBase = async () => {
    if (completedBranches.length === 0) {
      return { status: "ok" as const };
    }
    const checkoutResult = await tryGit(gitRunner, cwd, ["checkout", originalBaseBranch]);
    if (checkoutResult.status === "error") {
      return { status: "error" as const, message: checkoutResult.message };
    }

    if (integrationBranches.length > 0) {
      const finalIntegration = integrationBranches[integrationBranches.length - 1];
      if (!finalIntegration) {
        return { status: "error" as const, message: "Integration branch missing" };
      }
      const mergeResult = await tryGit(gitRunner, cwd, ["merge", "--no-edit", finalIntegration]);
      if (mergeResult.status === "error") {
        await tryGit(gitRunner, cwd, ["merge", "--abort"]);
        return { status: "error" as const, message: mergeResult.message };
      }
      for (const branch of integrationBranches) {
        await tryGit(gitRunner, cwd, ["branch", "-D", branch]);
      }
      for (const branch of completedBranches) {
        await tryGit(gitRunner, cwd, ["branch", "-D", branch]);
      }
      return { status: "ok" as const };
    }

    const failed: string[] = [];
    for (const branch of completedBranches) {
      const mergeResult = await tryGit(gitRunner, cwd, ["merge", "--no-edit", branch]);
      if (mergeResult.status === "ok") {
        await tryGit(gitRunner, cwd, ["branch", "-d", branch]);
        continue;
      }

      const resolved = await resolveMergeWithAi({
        runner: gitRunner,
        agentRunner,
        cwd,
        engine: resolveEngine(options.engine),
      });

      if (resolved.status === "ok") {
        await tryGit(gitRunner, cwd, ["branch", "-d", branch]);
        continue;
      }

      failed.push(branch);
    }

    if (failed.length > 0) {
      return { status: "error" as const, message: `Merge conflicts remain in: ${failed.join(", ")}` };
    }

    return { status: "ok" as const };
  };

  const worker = async () => {
    while (queue.length > 0) {
      const group = queue.shift();
      if (!group) {
        return;
      }
      const groupBaseBranch = baseBranch;
      const result = await runParallelGroup(group, options, cwd, runner, complete, worktreeManager, groupBaseBranch);
      await serial(async () => {
        results.push(result);
        completedBranches.push(...result.branches);
        if (!result.failure) {
          const mergeResult = await mergeGroupIntoIntegration(result.group, result.branches);
          if (mergeResult.status === "ok" && mergeResult.integrationBranch) {
            integrationBranches.push(mergeResult.integrationBranch);
            baseBranch = mergeResult.integrationBranch;
          }
        }
      });
    }
  };

  const releaseSignals = registerCleanupSignals(async () => {
    await worktreeManager.cleanup({ removeBranches: false, preserveDirty: true });
  });

  try {
    await Promise.all(Array.from({ length: maxParallel }, () => worker()));
  } finally {
    releaseSignals();
    await worktreeManager.cleanup({ removeBranches: false });
  }

  const tasks = results.flatMap((result) => result.tasks).sort((a, b) => a.index - b.index);
  const usage = createUsageTotals();
  let completed = 0;
  let failure: ParallelGroupResult["failure"] | undefined;
  results.forEach((result) => {
    addUsageTotals(usage, result.usage);
    completed += result.completed;
    if (!failure && result.failure) {
      failure = result.failure;
    }
  });

  const iterations = tasks.length;
  const stopped = parallelTasks.truncated ? "max-iterations" : "no-tasks";

  if (failure) {
    return {
      status: "error",
      stage: failure.stage,
      message: failure.message,
      iterations,
      tasks,
      task: failure.task,
      usage,
    };
  }

  const mergeResult = await mergeBranchesIntoBase();
  if (mergeResult.status === "error") {
    return {
      status: "error",
      stage: "merge",
      message: mergeResult.message,
      iterations,
      tasks,
      usage,
    };
  }

  return { tasks, completed, iterations, usage, stopped };
};

export const runPrd = async (
  options: RunPrdRequest & { cwd?: string },
  deps: RunPrdDeps = {},
): Promise<RunPrdResponse> => {
  const requirements = await checkPrdRequirements(options);
  if (requirements.status === "error") {
    return requirements;
  }

  const cwd = options.cwd ?? process.cwd();
  const maxIterations = ensureMaxIterations(options.maxIterations);
  const tasks: PrdRunTask[] = [];
  const usage = createUsageTotals();
  let iterations = 0;
  let completed = 0;

  if (maxIterations === 0) {
    return {
      status: "ok",
      iterations,
      completed,
      stopped: "max-iterations",
      tasks,
      usage,
    };
  }

  if (options.parallel) {
    const parallelResult = await runParallelTasks(options, cwd, maxIterations, deps);
    if ("status" in parallelResult) {
      return parallelResult;
    }
    return {
      status: "ok",
      iterations: parallelResult.iterations,
      completed: parallelResult.completed,
      stopped: parallelResult.stopped,
      tasks: parallelResult.tasks,
      usage: parallelResult.usage,
    };
  }

  const taskSourceOptions = buildTaskSourceOptions(options, cwd);
  const runner = deps.runner ?? runSingleTask;
  const nextTask = deps.getNextTask ?? getNextTask;
  const complete = deps.completeTask ?? completeTask;
  const createPr = deps.createPullRequest ?? createPullRequest;
  const branchManagerFactory = deps.branchManagerFactory ?? createBranchPerTaskManager;
  const branchManager = options.branchPerTask
    ? branchManagerFactory({ cwd, baseBranch: options.baseBranch })
    : null;

  if (branchManager) {
    await branchManager.prepare();
  }

  try {
    while (iterations < maxIterations) {
      const next = await nextTask(taskSourceOptions);
      if (next.status === "empty") {
        return {
          status: "ok",
          iterations,
          completed,
          stopped: "no-tasks",
          tasks,
          usage,
        };
      }
      if (next.status === "error") {
        return {
          status: "error",
          stage: "task-source",
          message: next.error ?? "Task source error",
          iterations,
          tasks,
          usage,
        };
      }

      const taskText = next.task.text;
      const taskSource = next.task.source;
      iterations += 1;

      let taskBranch: string | undefined;
      if (branchManager) {
        taskBranch = await branchManager.checkoutForTask(taskText);
      }

      let result: Awaited<ReturnType<typeof runSingleTask>>;

      try {
        result = await runner({
          task: taskText,
          engine: options.engine,
          skipTests: options.skipTests,
          skipLint: options.skipLint,
          autoCommit: options.autoCommit,
          maxRetries: options.maxRetries,
          retryDelay: options.retryDelay,
          cwd,
        });
      } finally {
        if (branchManager) {
          await branchManager.finishTask();
        }
      }

      if (result.status === "ok") {
        addUsageTotals(usage, result.usage);
        await logTaskHistory(cwd, taskText, "completed");
        tasks.push(buildSuccessTask(taskText, taskSource, result.attempts, result.response));
        completed += 1;
        const completion = await complete(taskText, taskSourceOptions);
        if (completion.status === "updated" || completion.status === "already-complete") {
          if (options.createPr || options.draftPr) {
            try {
              await createPr({
                cwd,
                title: buildPrTitle(taskText),
                body: buildPrBody(taskText),
                baseBranch: options.baseBranch,
                headBranch: taskBranch,
                draft: options.draftPr,
              });
            } catch (error) {
              const message = error instanceof Error ? error.message : "Pull request failed";
              return {
                status: "error",
                stage: "pr",
                message,
                iterations,
                tasks,
                task: taskText,
                usage,
              };
            }
          }
          if (iterations >= maxIterations) {
            break;
          }
          continue;
        }
        if (completion.status === "not-found") {
          return {
            status: "error",
            stage: "complete",
            message: "Task not found in source",
            iterations,
            tasks,
            task: taskText,
            usage,
          };
        }
        return {
          status: "error",
          stage: "complete",
          message: completion.status === "error" ? completion.error : "Task completion failed",
          iterations,
          tasks,
          task: taskText,
          usage,
        };
      }

      const errorMessage =
        result.status === "dry-run" ? "Dry run not supported for PRD execution" : result.error;
      const attempts = result.status === "dry-run" ? 0 : result.attempts;
      await logTaskHistory(cwd, taskText, "failed");
      tasks.push(buildFailureTask(taskText, taskSource, attempts, errorMessage));
      return {
        status: "error",
        stage: "agent",
        message: errorMessage,
        iterations,
        tasks,
        task: taskText,
        usage,
      };
    }

    return {
      status: "ok",
      iterations,
      completed,
      stopped: "max-iterations",
      tasks,
      usage,
    };
  } finally {
    if (branchManager) {
      await branchManager.cleanup();
    }
  }
};
