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
import { logTaskHistory } from "./progress";
import { runSingleTask } from "./single";
import { completeTask, getNextTask } from "./tasks/source";

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
