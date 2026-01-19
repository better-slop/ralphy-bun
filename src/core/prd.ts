import { join } from "node:path";
import { stat } from "node:fs/promises";
import type {
  AgentUsageTotals,
  PrdRequirement,
  PrdRequirementFailure,
  PrdRequirementsResult,
  PrdRunTask,
  RunPrdRequest,
  RunPrdResponse,
} from "../shared/types";
import { createBranchPerTaskManager } from "./git/branch";
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

type ParallelGroupResult = {
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
): Promise<ParallelGroupResult> => {
  const taskSourcePath = resolveTaskSourcePath(options, cwd);
  const record = await worktreeManager.createWorktree({
    group: group.group,
    taskSourcePath,
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
      cwd: record.path,
    });

    if (result.status !== "ok") {
      const message = result.status === "dry-run" ? "Dry run not supported for PRD execution" : result.error;
      const attempts = result.status === "dry-run" ? 0 : result.attempts;
      await logTaskHistory(record.path, task.text, "failed");
      results.push({ ...buildFailureTask(task.text, task.source, attempts, message), index: task.index });
      return {
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
      tasks: results,
      completed,
      usage,
      failure: { stage: "complete", message, task: task.text },
    };
  }

  return { tasks: results, completed, usage };
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

  const worktreeFactory = deps.worktreeManagerFactory ?? createWorktreeManager;
  const worktreeManager = worktreeFactory({ cwd, baseBranch: options.baseBranch });
  const queue = [...parallelTasks.groups];
  const maxParallel = resolveMaxParallel(options.maxParallel, queue.length);
  const serial = createSerialQueue();
  const runner = deps.runner ?? runSingleTask;
  const complete = deps.completeTask ?? completeTask;
  const results: ParallelGroupResult[] = [];

  const worker = async () => {
    while (queue.length > 0) {
      const group = queue.shift();
      if (!group) {
        return;
      }
      const result = await runParallelGroup(group, options, cwd, runner, complete, worktreeManager);
      await serial(async () => {
        results.push(result);
      });
    }
  };

  try {
    await Promise.all(Array.from({ length: maxParallel }, () => worker()));
  } finally {
    await worktreeManager.cleanup();
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
