import type { AgentCommand, AgentEngine, AgentRunResult } from "../../shared/types";

export type AgentCommandOptions = {
  codexLastMessagePath?: string;
};

export type SpawnedProcess = {
  stdout: ReadableStream<Uint8Array> | null;
  stderr: ReadableStream<Uint8Array> | null;
  exited: Promise<number>;
};

export type SpawnOptions = Parameters<typeof Bun.spawn>[1];

export type SpawnFn = (args: string[], options: SpawnOptions) => SpawnedProcess;

export type AgentRunOptions = {
  cwd?: string;
  env?: Record<string, string>;
  codexLastMessagePath?: string;
  spawn?: SpawnFn;
};

const opencodePermission = "{\"*\":\"allow\"}";

export const buildAgentCommand = (
  engine: AgentEngine,
  prompt: string,
  options: AgentCommandOptions = {},
): AgentCommand => {
  switch (engine) {
    case "opencode":
      return {
        command: "opencode",
        args: ["run", "--format", "json", prompt],
        env: {
          OPENCODE_PERMISSION: opencodePermission,
        },
      };
    case "cursor":
      return {
        command: "agent",
        args: ["--print", "--force", "--output-format", "stream-json", prompt],
      };
    case "qwen":
      return {
        command: "qwen",
        args: ["--output-format", "stream-json", "--approval-mode", "yolo", "-p", prompt],
      };
    case "droid":
      return {
        command: "droid",
        args: ["exec", "--output-format", "stream-json", "--auto", "medium", prompt],
      };
    case "codex": {
      const args = ["exec", "--full-auto", "--json"];
      if (options.codexLastMessagePath) {
        args.push("--output-last-message", options.codexLastMessagePath);
      }
      args.push(prompt);
      return {
        command: "codex",
        args,
      };
    }
    case "claude":
    default:
      return {
        command: "claude",
        args: [
          "--dangerously-skip-permissions",
          "--verbose",
          "--output-format",
          "stream-json",
          "-p",
          prompt,
        ],
      };
  }
};

const mergeEnv = (
  sources: Array<Record<string, string | undefined> | undefined>,
): Record<string, string> => {
  const merged: Record<string, string> = {};
  for (const source of sources) {
    if (!source) {
      continue;
    }
    for (const [key, value] of Object.entries(source)) {
      if (value !== undefined) {
        merged[key] = value;
      }
    }
  }
  return merged;
};

export const runAgent = async (
  engine: AgentEngine,
  prompt: string,
  options: AgentRunOptions = {},
): Promise<AgentRunResult> => {
  const command = buildAgentCommand(engine, prompt, {
    codexLastMessagePath: options.codexLastMessagePath,
  });
  const env = mergeEnv([process.env, command.env, options.env]);
  const spawn = options.spawn ?? Bun.spawn;
  const child = spawn([command.command, ...command.args], {
    cwd: options.cwd,
    stdout: "pipe",
    stderr: "pipe",
    env,
  });

  const stdoutPromise = child.stdout
    ? new Response(child.stdout).text()
    : Promise.resolve("");
  const stderrPromise = child.stderr
    ? new Response(child.stderr).text()
    : Promise.resolve("");
  const [stdout, stderr, exitCode] = await Promise.all([
    stdoutPromise,
    stderrPromise,
    child.exited,
  ]);

  return {
    command,
    stdout,
    stderr,
    exitCode,
  };
};
