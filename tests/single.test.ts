import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSingleTask } from "../src/core/single";
import type { AgentEngine } from "../src/shared/types";

let workingDir = "";

beforeEach(async () => {
  workingDir = await mkdtemp(join(tmpdir(), "ralphy-single-"));
});

afterEach(async () => {
  if (workingDir) {
    await rm(workingDir, { recursive: true, force: true });
  }
});

type RunnerResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

type RunnerFn = (
  engine: AgentEngine,
  prompt: string,
  options?: { codexLastMessagePath?: string },
) => Promise<RunnerResult>;

const createRunner = (runner: RunnerFn) =>
  async (engine: AgentEngine, prompt: string, options?: { codexLastMessagePath?: string }) => ({
    command: { command: "mock", args: [] },
    ...(await runner(engine, prompt, options)),
  });


test("dry-run returns prompt without executing", async () => {
  const result = await runSingleTask({ task: "Ship it", dryRun: true, cwd: workingDir });

  expect(result.status).toBe("dry-run");
  if (result.status !== "dry-run") {
    throw new Error("Expected dry-run result");
  }
  expect(result.engine).toBe("claude");
  expect(result.prompt).toContain("## Task\nShip it");
});

test("parses claude stream-json result", async () => {
  const stdout = `${JSON.stringify({
    type: "result",
    result: "All set",
    usage: { input_tokens: 12, output_tokens: 34 },
    duration_ms: 1500,
  })}\n`;
  const runner = createRunner(async () => ({ stdout, stderr: "", exitCode: 0 }));

  const result = await runSingleTask(
    { task: "Do work", cwd: workingDir, maxRetries: 1, retryDelay: 0 },
    { runner },
  );

  expect(result.status).toBe("ok");
  if (result.status !== "ok") {
    throw new Error("Expected ok result");
  }
  expect(result.response).toBe("All set");
  expect(result.usage).toEqual({ inputTokens: 12, outputTokens: 34, durationMs: 1500 });
  expect(result.attempts).toBe(1);
});

test("parses opencode output and usage", async () => {
  const stdout = [
    JSON.stringify({ type: "text", part: { text: "Hello " } }),
    JSON.stringify({ type: "text", part: { text: "world" } }),
    JSON.stringify({ type: "step_finish", part: { tokens: { input: 3, output: 5 }, cost: 0.02 } }),
    "",
  ].join("\n");
  const runner = createRunner(async () => ({ stdout, stderr: "", exitCode: 0 }));

  const result = await runSingleTask(
    { task: "Say hi", engine: "opencode", cwd: workingDir, maxRetries: 1, retryDelay: 0 },
    { runner },
  );

  expect(result.status).toBe("ok");
  if (result.status !== "ok") {
    throw new Error("Expected ok result");
  }
  expect(result.response).toBe("Hello world");
  expect(result.usage).toEqual({ inputTokens: 3, outputTokens: 5, cost: 0.02 });
});

test("retries after failed attempt", async () => {
  let attempts = 0;
  const runner = createRunner(async () => {
    attempts += 1;
    if (attempts === 1) {
      return { stdout: "", stderr: "boom", exitCode: 1 };
    }
    const stdout = `${JSON.stringify({ type: "result", result: "Recovered", usage: { input_tokens: 1, output_tokens: 2 } })}\n`;
    return { stdout, stderr: "", exitCode: 0 };
  });

  const result = await runSingleTask(
    { task: "Retry", cwd: workingDir, maxRetries: 2, retryDelay: 0 },
    { runner },
  );

  expect(result.status).toBe("ok");
  if (result.status !== "ok") {
    throw new Error("Expected ok result");
  }
  expect(result.attempts).toBe(2);
  expect(result.response).toBe("Recovered");
});

test("returns error when agent sends error event", async () => {
  const stdout = `${JSON.stringify({ type: "error", error: { message: "boom" } })}\n`;
  const runner = createRunner(async () => ({ stdout, stderr: "", exitCode: 0 }));

  const result = await runSingleTask(
    { task: "Fail", cwd: workingDir, maxRetries: 1, retryDelay: 0 },
    { runner },
  );

  expect(result.status).toBe("error");
  if (result.status !== "error") {
    throw new Error("Expected error result");
  }
  expect(result.error).toBe("boom");
});

test("parses codex last-message output", async () => {
  const runner = createRunner(async (_engine, _prompt, options) => {
    if (!options?.codexLastMessagePath) {
      throw new Error("Missing codex path");
    }
    await Bun.write(
      options.codexLastMessagePath,
      "Task completed successfully.\n\nWrapped up",
    );
    return { stdout: "", stderr: "", exitCode: 0 };
  });

  const result = await runSingleTask(
    { task: "Codex run", engine: "codex", cwd: workingDir, maxRetries: 1, retryDelay: 0 },
    { runner },
  );

  expect(result.status).toBe("ok");
  if (result.status !== "ok") {
    throw new Error("Expected ok result");
  }
  expect(result.response).toBe("Wrapped up");
  expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
});
