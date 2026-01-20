import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSingleTaskPrompt } from "./prompts";
import { runAgent } from "./agents/runner";
import type {
  AgentEngine,
  AgentUsage,
  RunSingleRequest,
  RunSingleResponse,
} from "../shared/types";

export type RunSingleTaskFn = (options: RunSingleRequest & { cwd?: string }) => Promise<RunSingleResponse>;

type RunSingleDeps = {
  runner?: typeof runAgent;
};

type ParsedAgentOutput = {
  response: string;
  usage: AgentUsage;
  error?: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>

  typeof value === "object" && value !== null;

const getString = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

const getNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const parseJsonLines = (stdout: string) => {
  const events: unknown[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      events.push(parsed);
    } catch {
      continue;
    }
  }
  return events;
};

const readErrorMessage = (event: Record<string, unknown>) => {
  const errorValue = event.error;
  if (isRecord(errorValue)) {
    const message = getString(errorValue.message);
    if (message) {
      return message;
    }
  }
  const message = getString(event.message);
  if (message) {
    return message;
  }
  return undefined;
};

const parseCodexMessage = async (path?: string) => {
  if (!path) {
    return "";
  }
  const file = Bun.file(path);
  if (!(await file.exists())) {
    return "";
  }
  const text = await file.text();
  return text.replace(/^[Tt]ask completed successfully\.[\s\n]*/u, "").trim();
};

const parseOpenCodeOutput = (events: unknown[]) => {
  const parts: string[] = [];
  const usage: AgentUsage = { inputTokens: 0, outputTokens: 0 };
  let cost: number | undefined;

  for (const event of events) {
    if (!isRecord(event)) {
      continue;
    }
    const type = getString(event.type);
    if (type === "text") {
      const part = event.part;
      if (isRecord(part)) {
        const text = getString(part.text);
        if (text) {
          parts.push(text);
        }
      }
      continue;
    }
    if (type === "step_finish") {
      const part = event.part;
      if (isRecord(part)) {
        const tokens = part.tokens;
        if (isRecord(tokens)) {
          const input = getNumber(tokens.input);
          const output = getNumber(tokens.output);
          if (input !== undefined) {
            usage.inputTokens = input;
          }
          if (output !== undefined) {
            usage.outputTokens = output;
          }
        }
        const parsedCost = getNumber(part.cost);
        if (parsedCost !== undefined) {
          cost = parsedCost;
        }
      }
    }
  }

  if (cost !== undefined) {
    usage.cost = cost;
  }

  return {
    response: parts.join("").trim(),
    usage,
  };
};

const parseStreamJsonResult = (events: unknown[], engine: AgentEngine) => {
  const usage: AgentUsage = { inputTokens: 0, outputTokens: 0 };
  let response = "";
  let durationMs: number | undefined;

  for (const event of events) {
    if (!isRecord(event)) {
      continue;
    }
    const type = getString(event.type);
    if (type === "result") {
      const result = getString(event.result);
      if (result) {
        response = result;
      }
      const usageValue = event.usage;
      if (isRecord(usageValue)) {
        const input = getNumber(usageValue.input_tokens);
        const output = getNumber(usageValue.output_tokens);
        if (input !== undefined) {
          usage.inputTokens = input;
        }
        if (output !== undefined) {
          usage.outputTokens = output;
        }
      }
      const duration = getNumber(event.duration_ms);
      if (duration !== undefined) {
        durationMs = duration;
      }
    }

    if (engine === "cursor" && type === "assistant") {
      const message = event.message;
      if (isRecord(message)) {
        const content = message.content;
        if (typeof content === "string") {
          response = response || content;
        } else if (Array.isArray(content)) {
          const texts = content
            .map((item) => (isRecord(item) ? getString(item.text) : undefined))
            .filter((text): text is string => typeof text === "string" && text.length > 0);
          if (texts.length > 0 && response.length === 0) {
            response = texts.join("");
          }
        }
      }
    }

    if (engine === "droid" && type === "completion") {
      const finalText = getString(event.finalText);
      if (finalText) {
        response = finalText;
      }
      const duration = getNumber(event.durationMs);
      if (duration !== undefined) {
        durationMs = duration;
      }
    }
  }

  if (durationMs !== undefined) {
    usage.durationMs = durationMs;
  }

  return { response: response.trim(), usage };
};

const parseAgentOutput = async (
  engine: AgentEngine,
  stdout: string,
  codexLastMessagePath?: string,
): Promise<ParsedAgentOutput> => {
  const events = parseJsonLines(stdout);
  for (const event of events) {
    if (!isRecord(event)) {
      continue;
    }
    if (getString(event.type) === "error") {
      const message = readErrorMessage(event);
      return {
        response: "",
        usage: { inputTokens: 0, outputTokens: 0 },
        error: message ?? "Agent error",
      };
    }
  }

  if (engine === "opencode") {
    return parseOpenCodeOutput(events);
  }

  if (engine === "codex") {
    const response = await parseCodexMessage(codexLastMessagePath);
    return {
      response,
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }

  return parseStreamJsonResult(events, engine);
};

const ensureEngine = (engine?: AgentEngine): AgentEngine => engine ?? "claude";

const delay = (seconds: number) =>
  new Promise<void>((resolve) => {
    const ms = Math.max(0, seconds) * 1000;
    setTimeout(resolve, ms);
  });

export const runSingleTask = async (
  options: RunSingleRequest & { cwd?: string },
  deps: RunSingleDeps = {},
): Promise<RunSingleResponse> => {
  const engine = ensureEngine(options.engine);
  const maxRetries = options.maxRetries ?? 3;
  const retryDelay = options.retryDelay ?? 5;
  const runner = deps.runner ?? runAgent;

  const prompt = await buildSingleTaskPrompt({
    task: options.task,
    cwd: options.cwd,
    skipTests: options.skipTests,
    skipLint: options.skipLint,
    autoCommit: options.autoCommit,
    promptMode: options.promptMode,
    taskSource: options.taskSource,
    taskSourcePath: options.taskSourcePath,
    issueBody: options.issueBody,
  });

  if (options.dryRun) {
    return {
      status: "dry-run",
      engine,
      prompt,
    };
  }

  let attempts = 0;
  let lastError = "";
  let lastResult = {
    stdout: "",
    stderr: "",
    exitCode: 1,
  };

  while (attempts < maxRetries) {
    attempts += 1;
    let codexDir: string | undefined;
    let codexLastMessagePath: string | undefined;

    if (engine === "codex") {
      codexDir = await mkdtemp(join(tmpdir(), "ralphy-codex-"));
      codexLastMessagePath = join(codexDir, "last-message.txt");
    }

    try {
      const result = await runner(engine, prompt, {
        cwd: options.cwd,
        codexLastMessagePath,
      });
      lastResult = { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode };

      const parsed = await parseAgentOutput(engine, result.stdout, codexLastMessagePath);
      if (parsed.error) {
        lastError = parsed.error;
      } else if (result.exitCode !== 0) {
        lastError = `Agent exited with code ${result.exitCode}`;
      } else if (!parsed.response) {
        lastError = "Empty response from agent";
      } else {
        return {
          status: "ok",
          engine,
          attempts,
          response: parsed.response,
          usage: parsed.usage,
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
        };
      }
    } finally {
      if (codexDir) {
        await rm(codexDir, { recursive: true, force: true });
      }
    }

    if (attempts < maxRetries) {
      await delay(retryDelay);
    }
  }

  return {
    status: "error",
    engine,
    attempts,
    error: lastError || "Task failed",
    stdout: lastResult.stdout,
    stderr: lastResult.stderr,
    exitCode: lastResult.exitCode,
  };
};
