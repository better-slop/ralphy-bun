import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { checkPrdRequirements, runPrd } from "../src/core/prd";
import type { PrdRunTask, RunPrdRequest } from "../src/shared/types";

const createWorkspace = async () => mkdtemp(join(tmpdir(), "ralphy-prd-"));

const writeJson = async (path: string, value: unknown) => {
  await Bun.write(path, JSON.stringify(value));
};

const hasFailure = (failures: { requirement: string }[], requirement: string) =>
  failures.some((failure) => failure.requirement === requirement);

test("fails when git directory is missing", async () => {
  const cwd = await createWorkspace();

  try {
    const result = await checkPrdRequirements({ cwd });
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(hasFailure(result.failures, "git")).toBe(true);
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("fails when task source is missing", async () => {
  const cwd = await createWorkspace();

  try {
    await mkdir(join(cwd, ".git"), { recursive: true });
    const result = await checkPrdRequirements({ cwd });
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(hasFailure(result.failures, "task-source")).toBe(true);
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("skips task source check for github mode", async () => {
  const cwd = await createWorkspace();

  try {
    await mkdir(join(cwd, ".git"), { recursive: true });
    const result = await checkPrdRequirements({ cwd, github: "org/repo" });
    expect(result).toEqual({ status: "ok" });
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("fails when dependencies are missing", async () => {
  const cwd = await createWorkspace();

  try {
    await mkdir(join(cwd, ".git"), { recursive: true });
    await Bun.write(join(cwd, "PRD.md"), "- [ ] Task");
    await writeJson(join(cwd, "package.json"), { dependencies: { react: "1.0.0" } });
    const result = await checkPrdRequirements({ cwd });
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(hasFailure(result.failures, "dependencies")).toBe(true);
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("passes when requirements are met", async () => {
  const cwd = await createWorkspace();

  try {
    await mkdir(join(cwd, ".git"), { recursive: true });
    await mkdir(join(cwd, "node_modules"), { recursive: true });
    await Bun.write(join(cwd, "PRD.md"), "- [ ] Task");
    await writeJson(join(cwd, "package.json"), { dependencies: { react: "1.0.0" } });
    const result = await checkPrdRequirements({ cwd });
    expect(result).toEqual({ status: "ok" });
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

const createRunOptions = (
  cwd: string,
  overrides: Partial<RunPrdRequest> = {},
): RunPrdRequest & { cwd: string } => ({
  prd: "PRD.md",
  ...overrides,
  cwd,
});

const createBranchManager = () => {
  const calls: string[] = [];
  return {
    calls,
    manager: {
      prepare: async () => {
        calls.push("prepare");
      },
      checkoutForTask: async (task: string) => {
        calls.push(`checkout:${task}`);
        return `ralphy/${task}`;
      },
      finishTask: async () => {
        calls.push("finish");
      },
      cleanup: async () => {
        calls.push("cleanup");
      },
    },
  };
};

const createWorktreeManager = () => {
  const calls: string[] = [];
  const worktrees: string[] = [];
  const baseBranches: Array<string | undefined> = [];
  return {
    calls,
    worktrees,
    baseBranches,
    manager: {
      createWorktree: async ({
        group,
        taskSourcePath,
        baseBranch,
      }: {
        group: string | number;
        taskSourcePath?: string;
        baseBranch?: string;
      }) => {
        const path = await mkdtemp(join(tmpdir(), "ralphy-parallel-"));
        worktrees.push(path);
        calls.push(`create:${group}`);
        baseBranches.push(baseBranch);
        let copiedTaskSource: string | undefined;
        if (taskSourcePath) {
          const contents = await Bun.file(taskSourcePath).text();
          copiedTaskSource = join(path, basename(taskSourcePath));
          await Bun.write(copiedTaskSource, contents);
        }
        return {
          group: String(group),
          branch: `ralphy/parallel/${group}`,
          path,
          taskSourcePath,
          copiedTaskSource,
        };
      },
      cleanup: async (_options?: { removeBranches?: boolean }) => {
        calls.push("cleanup");
        await Promise.all(worktrees.map((path) => rm(path, { recursive: true, force: true })));
      },
    },
  };
};

const createGitRunner = (options?: {
  responses?: Record<string, string>;
  failures?: Set<string>;
}) => {
  const calls: string[] = [];
  const responses: Record<string, string> = {
    "rev-parse --abbrev-ref HEAD": "main\n",
    "branch --list": "main\n",
    "symbolic-ref --short HEAD": "main\n",
    "diff --name-only --diff-filter=U": "",
    "rev-parse -q --verify MERGE_HEAD": "",
    ...options?.responses,
  };
  const failures = options?.failures ?? new Set<string>();
  const runner = async (args: readonly string[]) => {
    const key = args.join(" ");
    calls.push(key);
    if (failures.has(key)) {
      throw new Error(`git failed: ${key}`);
    }
    return { stdout: responses[key] ?? "" };
  };
  return { runner, calls };
};

test("runPrd stops immediately when max iterations is zero", async () => {
  const cwd = await createWorkspace();
  let runnerCalls = 0;

  try {
    await mkdir(join(cwd, ".git"), { recursive: true });
    await Bun.write(join(cwd, "PRD.md"), "- [ ] Task");

    const result = await runPrd(createRunOptions(cwd, { maxIterations: 0 }), {
      runner: async () => {
        runnerCalls += 1;
        return {
          status: "ok",
          engine: "claude",
          attempts: 1,
          response: "Done",
          usage: { inputTokens: 1, outputTokens: 1 },
          stdout: "ok",
          stderr: "",
          exitCode: 0,
        };
      },
    });

    expect(result).toEqual({
      status: "ok",
      iterations: 0,
      completed: 0,
      stopped: "max-iterations",
      tasks: [],
      usage: { inputTokens: 0, outputTokens: 0 },
    });
    expect(runnerCalls).toBe(0);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("runPrd stops after reaching max iterations", async () => {
  const cwd = await createWorkspace();
  let taskCalls = 0;

  try {
    await mkdir(join(cwd, ".git"), { recursive: true });
    await mkdir(join(cwd, ".ralphy"), { recursive: true });
    await Bun.write(join(cwd, "PRD.md"), "- [ ] Task");
    await Bun.write(join(cwd, ".ralphy", "progress.txt"), "# Ralphy Progress Log\n\n");

    const result = await runPrd(createRunOptions(cwd, { maxIterations: 1 }), {
      getNextTask: async () => {
        taskCalls += 1;
        return { status: "ok", task: { source: "markdown", text: "Ship it" } };
      },
      runner: async () => ({
        status: "ok",
        engine: "claude",
        attempts: 1,
        response: "Done",
        usage: { inputTokens: 2, outputTokens: 3, cost: 0.01, durationMs: 400 },
        stdout: "ok",
        stderr: "",
        exitCode: 0,
      }),
      completeTask: async () => ({ status: "updated", source: "markdown", task: "Ship it" }),
    });

    expect(result).toEqual({
      status: "ok",
      iterations: 1,
      completed: 1,
      stopped: "max-iterations",
      tasks: [
        {
          task: "Ship it",
          source: "markdown",
          status: "completed",
          attempts: 1,
          response: "Done",
        },
      ],
      usage: { inputTokens: 2, outputTokens: 3, cost: 0.01, durationMs: 400 },
    });
    expect(taskCalls).toBe(1);
    const progress = await Bun.file(join(cwd, ".ralphy", "progress.txt")).text();
    expect(progress).toContain("- [✓]");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("runPrd returns error when retries are exhausted", async () => {
  const cwd = await createWorkspace();

  try {
    await mkdir(join(cwd, ".git"), { recursive: true });
    await mkdir(join(cwd, ".ralphy"), { recursive: true });
    await Bun.write(join(cwd, "PRD.md"), "- [ ] Task");
    await Bun.write(join(cwd, ".ralphy", "progress.txt"), "# Ralphy Progress Log\n\n");

    const result = await runPrd(createRunOptions(cwd), {
      getNextTask: async () => ({ status: "ok", task: { source: "markdown", text: "Ship it" } }),
      runner: async () => ({
        status: "error",
        engine: "claude",
        attempts: 3,
        error: "Agent failed",
        stdout: "",
        stderr: "boom",
        exitCode: 1,
      }),
    });

    expect(result).toEqual({
      status: "error",
      stage: "agent",
      message: "Agent failed",
      iterations: 1,
      tasks: [
        {
          task: "Ship it",
          source: "markdown",
          status: "failed",
          attempts: 3,
          error: "Agent failed",
        },
      ],
      task: "Ship it",
      usage: { inputTokens: 0, outputTokens: 0 },
    });
    const progress = await Bun.file(join(cwd, ".ralphy", "progress.txt")).text();
    expect(progress).toContain("- [✗]");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("runPrd returns error when runner returns dry-run", async () => {
  const cwd = await createWorkspace();

  try {
    await mkdir(join(cwd, ".git"), { recursive: true });
    await mkdir(join(cwd, ".ralphy"), { recursive: true });
    await Bun.write(join(cwd, "PRD.md"), "- [ ] Task");
    await Bun.write(join(cwd, ".ralphy", "progress.txt"), "# Ralphy Progress Log\n\n");

    const result = await runPrd(createRunOptions(cwd), {
      getNextTask: async () => ({ status: "ok", task: { source: "markdown", text: "Ship it" } }),
      runner: async () => ({
        status: "dry-run",
        engine: "claude",
        prompt: "Prompt",
      }),
    });

    expect(result).toEqual({
      status: "error",
      stage: "agent",
      message: "Dry run not supported for PRD execution",
      iterations: 1,
      tasks: [
        {
          task: "Ship it",
          source: "markdown",
          status: "failed",
          attempts: 0,
          error: "Dry run not supported for PRD execution",
        },
      ],
      task: "Ship it",
      usage: { inputTokens: 0, outputTokens: 0 },
    });
    const progress = await Bun.file(join(cwd, ".ralphy", "progress.txt")).text();
    expect(progress).toContain("- [✗]");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("runPrd executes tasks sequentially and completes", async () => {
  const cwd = await createWorkspace();
  let taskIndex = 0;
  const completedTasks: PrdRunTask[] = [];

  try {
    await mkdir(join(cwd, ".git"), { recursive: true });
    await mkdir(join(cwd, ".ralphy"), { recursive: true });
    await Bun.write(join(cwd, "PRD.md"), "- [ ] Task");
    await Bun.write(join(cwd, ".ralphy", "progress.txt"), "# Ralphy Progress Log\n\n");

    const result = await runPrd(createRunOptions(cwd, { maxIterations: 2 }), {
      getNextTask: async () => {
        if (taskIndex === 0) {
          taskIndex += 1;
          return { status: "ok", task: { source: "markdown", text: "Ship it" } };
        }
        return { status: "empty", source: "markdown" };
      },
      runner: async ({ task }) => {
        completedTasks.push({
          task,
          source: "markdown",
          status: "completed",
          attempts: 1,
          response: "Done",
        });
        return {
          status: "ok",
          engine: "claude",
          attempts: 1,
          response: "Done",
          usage: { inputTokens: 1, outputTokens: 1, cost: 0.02, durationMs: 1200 },
          stdout: "ok",
          stderr: "",
          exitCode: 0,
        };
      },
      completeTask: async () => ({ status: "updated", source: "markdown", task: "Ship it" }),
    });

    expect(result).toEqual({
      status: "ok",
      iterations: 1,
      completed: 1,
      stopped: "no-tasks",
      tasks: completedTasks,
      usage: { inputTokens: 1, outputTokens: 1, cost: 0.02, durationMs: 1200 },
    });
    const progress = await Bun.file(join(cwd, ".ralphy", "progress.txt")).text();
    expect(progress).toContain("- [✓]");
    expect(progress).toContain("Ship it");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("runPrd uses branch manager when enabled", async () => {
  const cwd = await createWorkspace();
  const { calls, manager } = createBranchManager();

  try {
    await mkdir(join(cwd, ".git"), { recursive: true });
    await mkdir(join(cwd, ".ralphy"), { recursive: true });
    await Bun.write(join(cwd, "PRD.md"), "- [ ] Task");
    await Bun.write(join(cwd, ".ralphy", "progress.txt"), "# Ralphy Progress Log\n\n");

    const result = await runPrd(createRunOptions(cwd, { maxIterations: 1, branchPerTask: true }), {
      getNextTask: async () => ({ status: "ok", task: { source: "markdown", text: "Ship it" } }),
      runner: async () => ({
        status: "ok",
        engine: "claude",
        attempts: 1,
        response: "Done",
        usage: { inputTokens: 1, outputTokens: 1 },
        stdout: "ok",
        stderr: "",
        exitCode: 0,
      }),
      completeTask: async () => ({ status: "updated", source: "markdown", task: "Ship it" }),
      branchManagerFactory: () => manager,
    });

    expect(result.status).toBe("ok");
    expect(calls).toEqual(["prepare", "checkout:Ship it", "finish", "cleanup"]);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("runPrd creates a PR after completion when enabled", async () => {
  const cwd = await createWorkspace();
  const { manager } = createBranchManager();
  const createCalls: Array<{ title: string; body: string; baseBranch?: string; headBranch?: string; draft?: boolean }> = [];

  try {
    await mkdir(join(cwd, ".git"), { recursive: true });
    await mkdir(join(cwd, ".ralphy"), { recursive: true });
    await Bun.write(join(cwd, "PRD.md"), "- [ ] Task");
    await Bun.write(join(cwd, ".ralphy", "progress.txt"), "# Ralphy Progress Log\n\n");

    const result = await runPrd(
      createRunOptions(cwd, {
        maxIterations: 1,
        branchPerTask: true,
        createPr: true,
        baseBranch: "main",
      }),
      {
        getNextTask: async () => ({ status: "ok", task: { source: "markdown", text: "Ship it" } }),
        runner: async () => ({
          status: "ok",
          engine: "claude",
          attempts: 1,
          response: "Done",
          usage: { inputTokens: 1, outputTokens: 1 },
          stdout: "ok",
          stderr: "",
          exitCode: 0,
        }),
        completeTask: async () => ({ status: "updated", source: "markdown", task: "Ship it" }),
        branchManagerFactory: () => manager,
        createPullRequest: async (options) => {
          createCalls.push({
            title: options.title,
            body: options.body,
            baseBranch: options.baseBranch,
            headBranch: options.headBranch,
            draft: options.draft,
          });
        },
      },
    );

    expect(result.status).toBe("ok");
    expect(createCalls).toEqual([
      {
        title: "Ralphy: Ship it",
        body: "## Summary\n- Ship it\n",
        baseBranch: "main",
        headBranch: "ralphy/Ship it",
        draft: undefined,
      },
    ]);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("runPrd returns error when PR creation fails", async () => {
  const cwd = await createWorkspace();

  try {
    await mkdir(join(cwd, ".git"), { recursive: true });
    await mkdir(join(cwd, ".ralphy"), { recursive: true });
    await Bun.write(join(cwd, "PRD.md"), "- [ ] Task");
    await Bun.write(join(cwd, ".ralphy", "progress.txt"), "# Ralphy Progress Log\n\n");

    const result = await runPrd(createRunOptions(cwd, { maxIterations: 1, createPr: true }), {
      getNextTask: async () => ({ status: "ok", task: { source: "markdown", text: "Ship it" } }),
      runner: async () => ({
        status: "ok",
        engine: "claude",
        attempts: 1,
        response: "Done",
        usage: { inputTokens: 1, outputTokens: 1 },
        stdout: "ok",
        stderr: "",
        exitCode: 0,
      }),
      completeTask: async () => ({ status: "updated", source: "markdown", task: "Ship it" }),
      createPullRequest: async () => {
        throw new Error("gh failed");
      },
    });

    expect(result).toEqual({
      status: "error",
      stage: "pr",
      message: "gh failed",
      iterations: 1,
      tasks: [
        {
          task: "Ship it",
          source: "markdown",
          status: "completed",
          attempts: 1,
          response: "Done",
        },
      ],
      task: "Ship it",
      usage: { inputTokens: 1, outputTokens: 1 },
    });
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("runPrd returns error when completion fails", async () => {
  const cwd = await createWorkspace();

  try {
    await mkdir(join(cwd, ".git"), { recursive: true });
    await Bun.write(join(cwd, "PRD.md"), "- [ ] Task");

    const result = await runPrd(createRunOptions(cwd), {
      getNextTask: async () => ({ status: "ok", task: { source: "markdown", text: "Ship it" } }),
      runner: async () => ({
        status: "ok",
        engine: "claude",
        attempts: 1,
        response: "Done",
        usage: { inputTokens: 1, outputTokens: 1 },
        stdout: "ok",
        stderr: "",
        exitCode: 0,
      }),
      completeTask: async () => ({
        status: "error",
        source: "markdown",
        task: "Ship it",
        error: "No write",
      }),
    });

    expect(result).toEqual({
      status: "error",
      stage: "complete",
      message: "No write",
      iterations: 1,
      tasks: [
        {
          task: "Ship it",
          source: "markdown",
          status: "completed",
          attempts: 1,
          response: "Done",
        },
      ],
      task: "Ship it",
      usage: { inputTokens: 1, outputTokens: 1 },
    });
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("runPrd executes parallel groups with max-parallel", async () => {
  const cwd = await createWorkspace();
  const { calls, manager } = createWorktreeManager();
  const yamlPath = join(cwd, "tasks.yaml");
  const progressPath = join(cwd, ".ralphy", "progress.txt");

  let active = 0;
  let maxActive = 0;

  const delay = () =>
    new Promise<void>((resolve) => {
      setTimeout(resolve, 20);
    });

  try {
    await mkdir(join(cwd, ".git"), { recursive: true });
    await mkdir(join(cwd, ".ralphy"), { recursive: true });
    await Bun.write(progressPath, "# Ralphy Progress Log\n\n");
    await Bun.write(
      yamlPath,
      [
        "tasks:",
        "  - title: Task A",
        "    completed: false",
        "    parallel_group: 1",
        "  - title: Task B",
        "    completed: false",
        "    parallel_group: 1",
        "  - title: Task C",
        "    completed: false",
        "    parallel_group: 2",
        "  - title: Task D",
        "    completed: false",
        "    parallel_group: 2",
      ].join("\n"),
    );

    const { runner: gitRunner } = createGitRunner();
    const result = await runPrd(
      { cwd, yaml: "tasks.yaml", parallel: true, maxParallel: 1 },
      {
        runner: async ({ task }) => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await delay();
          active -= 1;
          return {
            status: "ok",
            engine: "claude",
            attempts: 1,
            response: `Done ${task}`,
            usage: { inputTokens: 1, outputTokens: 1 },
            stdout: "ok",
            stderr: "",
            exitCode: 0,
          };
        },
        completeTask: async () => ({ status: "updated", source: "yaml", task: "task" }),
        worktreeManagerFactory: () => manager,
        gitRunner,
      },
    );

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.tasks.map((task) => task.task)).toEqual(["Task A", "Task B", "Task C", "Task D"]);
      expect(result.completed).toBe(4);
    }
    expect(maxActive).toBe(1);
    expect(calls.filter((call) => call.startsWith("create:")).length).toBe(2);
    expect(calls.at(-1)).toBe("cleanup");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("runPrd allows multiple parallel workers", async () => {
  const cwd = await createWorkspace();
  const { manager } = createWorktreeManager();
  const yamlPath = join(cwd, "tasks.yaml");

  let active = 0;
  let maxActive = 0;

  const delay = () =>
    new Promise<void>((resolve) => {
      setTimeout(resolve, 20);
    });

  try {
    await mkdir(join(cwd, ".git"), { recursive: true });
    await mkdir(join(cwd, ".ralphy"), { recursive: true });
    await Bun.write(join(cwd, ".ralphy", "progress.txt"), "# Ralphy Progress Log\n\n");
    await Bun.write(
      yamlPath,
      [
        "tasks:",
        "  - title: Task A",
        "    completed: false",
        "    parallel_group: 1",
        "  - title: Task C",
        "    completed: false",
        "    parallel_group: 2",
      ].join("\n"),
    );

    const { runner: gitRunner } = createGitRunner();
    const result = await runPrd(
      { cwd, yaml: "tasks.yaml", parallel: true, maxParallel: 2 },
      {
        runner: async ({ task }) => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await delay();
          active -= 1;
          return {
            status: "ok",
            engine: "claude",
            attempts: 1,
            response: `Done ${task}`,
            usage: { inputTokens: 1, outputTokens: 1 },
            stdout: "ok",
            stderr: "",
            exitCode: 0,
          };
        },
        completeTask: async () => ({ status: "updated", source: "yaml", task: "task" }),
        worktreeManagerFactory: () => manager,
        gitRunner,
      },
    );

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.completed).toBe(2);
    }
    expect(maxActive).toBe(2);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("runPrd merges integration branches between groups", async () => {
  const cwd = await createWorkspace();
  const { manager, baseBranches } = createWorktreeManager();
  const yamlPath = join(cwd, "tasks.yaml");

  try {
    await mkdir(join(cwd, ".git"), { recursive: true });
    await mkdir(join(cwd, ".ralphy"), { recursive: true });
    await Bun.write(join(cwd, ".ralphy", "progress.txt"), "# Ralphy Progress Log\n\n");
    await Bun.write(
      yamlPath,
      [
        "tasks:",
        "  - title: Task A",
        "    completed: false",
        "    parallel_group: 1",
        "  - title: Task B",
        "    completed: false",
        "    parallel_group: 2",
      ].join("\n"),
    );

    const { runner: gitRunner, calls } = createGitRunner();
    const result = await runPrd(
      { cwd, yaml: "tasks.yaml", parallel: true, maxParallel: 1 },
      {
        runner: async ({ task }) => ({
          status: "ok",
          engine: "claude",
          attempts: 1,
          response: `Done ${task}`,
          usage: { inputTokens: 1, outputTokens: 1 },
          stdout: "ok",
          stderr: "",
          exitCode: 0,
        }),
        completeTask: async () => ({ status: "updated", source: "yaml", task: "task" }),
        worktreeManagerFactory: () => manager,
        gitRunner,
      },
    );

    expect(result.status).toBe("ok");
    expect(baseBranches).toEqual(["main", "ralphy/integration-group-1"]);
    expect(calls).toContain("branch ralphy/integration-group-1 main");
    expect(calls).toContain("merge --no-edit ralphy/parallel/1");
    expect(calls).toContain("branch ralphy/integration-group-2 ralphy/integration-group-1");
    expect(calls).toContain("merge --no-edit ralphy/parallel/2");
    expect(calls).toContain("merge --no-edit ralphy/integration-group-2");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("runPrd reports merge failures", async () => {
  const cwd = await createWorkspace();
  const { manager } = createWorktreeManager();
  const yamlPath = join(cwd, "tasks.yaml");

  try {
    await mkdir(join(cwd, ".git"), { recursive: true });
    await mkdir(join(cwd, ".ralphy"), { recursive: true });
    await Bun.write(join(cwd, ".ralphy", "progress.txt"), "# Ralphy Progress Log\n\n");
    await Bun.write(
      yamlPath,
      [
        "tasks:",
        "  - title: Task A",
        "    completed: false",
        "    parallel_group: 1",
        "  - title: Task B",
        "    completed: false",
        "    parallel_group: 2",
      ].join("\n"),
    );

    const { runner: gitRunner } = createGitRunner({
      failures: new Set(["merge --no-edit ralphy/integration-group-2"]),
    });
    const result = await runPrd(
      { cwd, yaml: "tasks.yaml", parallel: true, maxParallel: 1 },
      {
        runner: async ({ task }) => ({
          status: "ok",
          engine: "claude",
          attempts: 1,
          response: `Done ${task}`,
          usage: { inputTokens: 1, outputTokens: 1 },
          stdout: "ok",
          stderr: "",
          exitCode: 0,
        }),
        completeTask: async () => ({ status: "updated", source: "yaml", task: "task" }),
        worktreeManagerFactory: () => manager,
        gitRunner,
      },
    );

    expect(result.status).toBe("error");
    if (result.status === "error" && "stage" in result) {
      expect(result.stage).toBe("merge");
      expect(result.message).toContain("merge --no-edit");
      expect(result.tasks.map((task) => task.task)).toEqual(["Task A", "Task B"]);
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
