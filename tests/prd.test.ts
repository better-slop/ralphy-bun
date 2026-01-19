import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
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
