import { expect, test } from "bun:test";
import type { AgentEngine } from "../src/shared/types";
import { buildAgentCommand, runAgent } from "../src/core/agents/runner";
import type { AgentCommandOptions } from "../src/core/agents/runner";

type SpawnOptions = Parameters<typeof Bun.spawn>[1];

type SpawnCall = {
  args: string[];
  options: SpawnOptions;
};

const createStream = (text: string) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });

const createSpawn = (callStore: SpawnCall[], output?: { stdout?: string; stderr?: string; exitCode?: number }) =>
  ((args: string[], options: SpawnOptions) => {
    callStore.push({ args: [...args], options });
    return {
      stdout: createStream(output?.stdout ?? "ok"),
      stderr: createStream(output?.stderr ?? ""),
      exited: Promise.resolve(output?.exitCode ?? 0),
    };
  }) satisfies (args: string[], options: SpawnOptions) => {
    stdout: ReadableStream<Uint8Array>;
    stderr: ReadableStream<Uint8Array>;
    exited: Promise<number>;
  };

test("buildAgentCommand creates opencode command with permission env", () => {
  const command = buildAgentCommand("opencode", "do it");
  expect(command.command).toBe("opencode");
  expect(command.args).toEqual(["run", "--format", "json", "do it"]);
  expect(command.env?.OPENCODE_PERMISSION).toBe("{\"*\":\"allow\"}");
});

test("buildAgentCommand creates claude command", () => {
  const command = buildAgentCommand("claude", "prompt");
  expect(command.command).toBe("claude");
  expect(command.args).toEqual([
    "--dangerously-skip-permissions",
    "--verbose",
    "--output-format",
    "stream-json",
    "-p",
    "prompt",
  ]);
});

test("buildAgentCommand creates cursor command", () => {
  const command = buildAgentCommand("cursor", "prompt");
  expect(command.command).toBe("agent");
  expect(command.args).toEqual(["--print", "--force", "--output-format", "stream-json", "prompt"]);
});

test("buildAgentCommand creates qwen command", () => {
  const command = buildAgentCommand("qwen", "prompt");
  expect(command.command).toBe("qwen");
  expect(command.args).toEqual(["--output-format", "stream-json", "--approval-mode", "yolo", "-p", "prompt"]);
});

test("buildAgentCommand creates droid command", () => {
  const command = buildAgentCommand("droid", "prompt");
  expect(command.command).toBe("droid");
  expect(command.args).toEqual(["exec", "--output-format", "stream-json", "--auto", "medium", "prompt"]);
});

test("buildAgentCommand creates codex command with last message path", () => {
  const command = buildAgentCommand("codex", "prompt", { codexLastMessagePath: "last.txt" });
  expect(command.command).toBe("codex");
  expect(command.args).toEqual(["exec", "--full-auto", "--json", "--output-last-message", "last.txt", "prompt"]);
});

test("buildAgentCommand snapshot", () => {
  const cases = [
    { engine: "claude", prompt: "do it" },
    { engine: "opencode", prompt: "do it" },
    { engine: "cursor", prompt: "do it" },
    { engine: "qwen", prompt: "do it" },
    { engine: "droid", prompt: "do it" },
    { engine: "codex", prompt: "do it", options: { codexLastMessagePath: "last.txt" } },
  ] satisfies Array<{ engine: AgentEngine; prompt: string; options?: AgentCommandOptions }>;

  const snapshot = cases.map(({ engine, prompt, options }) => ({
    engine,
    command: buildAgentCommand(engine, prompt, options),
  }));

  expect(snapshot).toMatchSnapshot();
});

test("runAgent uses spawn and merges env", async () => {
  const calls: SpawnCall[] = [];
  const spawn = createSpawn(calls, { stdout: "done", stderr: "warn", exitCode: 0 });

  const result = await runAgent("opencode", "run it", {
    env: { TEST_ENV: "yes" },
    spawn,
  });

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toBe("done");
  expect(result.stderr).toBe("warn");
  expect(result.command.command).toBe("opencode");
  expect(calls).toHaveLength(1);
  const firstCall = calls[0];
  if (!firstCall || !firstCall.options) {
    throw new Error("Missing spawn call");
  }
  expect(firstCall.args).toEqual(["opencode", "run", "--format", "json", "run it"]);
  expect(firstCall.options.env?.OPENCODE_PERMISSION).toBe("{\"*\":\"allow\"}");
  expect(firstCall.options.env?.TEST_ENV).toBe("yes");
});
