import yargs from "yargs/yargs";
import type { Argv } from "yargs";
import { packageVersion } from "./shared/version";
import { createServer } from "./server";
import type {
  AgentEngine,
  CliOptions,
  ConfigRulesRequest,
  RunPrdRequest,
  RunSingleRequest,
  ServerRequestBody,
} from "./shared/types";

type CliArgs = CliOptions;

const configureCli = (args: string[]): Argv<CliArgs> =>
  yargs(args)
    .scriptName("ralphy")
    .usage("$0 [task...]")
    .command(
      "$0 [task...]",
      "Run a task or PRD loop",
      (command: Argv<CliArgs>) =>
        command.positional("task", {
          describe: "Task text to run in single-task mode",
          type: "string",
        }),
    )
    .option("init", {
      type: "boolean",
      describe: "Initialize .ralphy config",
    })
    .option("config", {
      type: "boolean",
      describe: "Show config",
    })
    .option("add-rule", {
      type: "string",
      describe: "Add a config rule",
    })
    .option("skip-tests", {
      alias: "no-tests",
      type: "boolean",
      describe: "Skip test execution",
    })
    .option("skip-lint", {
      alias: "no-lint",
      type: "boolean",
      describe: "Skip lint execution",
    })
    .option("fast", {
      type: "boolean",
      describe: "Run in fast mode",
    })
    .option("dry-run", {
      type: "boolean",
      describe: "Run without executing external tools",
    })
    .option("max-iterations", {
      type: "number",
      describe: "Maximum number of iterations",
    })
    .option("max-retries", {
      type: "number",
      describe: "Maximum retries per task",
    })
    .option("retry-delay", {
      type: "number",
      describe: "Retry delay in seconds",
    })
    .option("claude", {
      type: "boolean",
      describe: "Use Claude",
    })
    .option("opencode", {
      type: "boolean",
      describe: "Use OpenCode",
    })
    .option("cursor", {
      alias: "agent",
      type: "boolean",
      describe: "Use Cursor",
    })
    .option("codex", {
      type: "boolean",
      describe: "Use Codex",
    })
    .option("qwen", {
      type: "boolean",
      describe: "Use Qwen",
    })
    .option("droid", {
      type: "boolean",
      describe: "Use Droid",
    })
    .option("parallel", {
      type: "boolean",
      describe: "Enable parallel mode",
    })
    .option("max-parallel", {
      type: "number",
      describe: "Maximum parallel tasks",
    })
    .option("branch-per-task", {
      type: "boolean",
      describe: "Create a branch per task",
    })
    .option("base-branch", {
      type: "string",
      describe: "Base branch for PRs",
    })
    .option("create-pr", {
      type: "boolean",
      describe: "Create a pull request",
    })
    .option("draft-pr", {
      type: "boolean",
      describe: "Create a draft pull request",
    })
    .option("commit", {
      type: "boolean",
      default: true,
      describe: "Enable git commits",
    })
    .option("prd", {
      type: "string",
      describe: "PRD markdown path",
    })
    .option("yaml", {
      type: "string",
      describe: "YAML task source path",
    })
    .option("github", {
      type: "string",
      describe: "GitHub issue source",
    })
    .option("github-label", {
      type: "string",
      describe: "GitHub label filter",
    })
    .option("verbose", {
      alias: "v",
      type: "boolean",
      describe: "Enable verbose logging",
    })
    .help()
    .version("version", "Show version number", packageVersion)
    .exitProcess(false);

type DispatchTarget = {
  method: "GET" | "POST";
  path: string;
  body?: ServerRequestBody;
};

const selectEngine = (args: CliArgs): AgentEngine | undefined => {
  if (args.opencode) {
    return "opencode";
  }
  if (args.cursor || args.agent) {
    return "cursor";
  }
  if (args.codex) {
    return "codex";
  }
  if (args.qwen) {
    return "qwen";
  }
  if (args.droid) {
    return "droid";
  }
  if (args.claude) {
    return "claude";
  }
  return undefined;
};

const resolveSkipTests = (args: CliArgs) => args.skipTests ?? args.noTests;

const resolveSkipLint = (args: CliArgs) => args.skipLint ?? args.noLint;

type DispatchResult = {
  target: DispatchTarget;
  status: number;
  payload: unknown;
};

type ServerInstance = {
  hostname: string;
  port: number;
  stop: () => Promise<void>;
};

type Fetcher = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

type DispatchDependencies = {
  createServer?: (options?: { port?: number; hostname?: string }) => ServerInstance;
  fetcher?: Fetcher;
  hostname?: string;
  port?: number;
};

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const isHelpOrVersion = (args: string[]) =>
  args.includes("--help") || args.includes("-h") || args.includes("--version");

const selectDispatchTarget = (args: CliArgs): DispatchTarget => {
  if (args.dryRun) {
    return { method: "GET", path: "/v1/health" };
  }

  if (args.init) {
    return { method: "POST", path: "/v1/config/init" };
  }

  if (args.config) {
    return { method: "GET", path: "/v1/config" };
  }

  if (typeof args.addRule === "string") {
    const body: ConfigRulesRequest = { rule: args.addRule };
    return {
      method: "POST",
      path: "/v1/config/rules",
      body,
    };
  }

  const taskText = args.task?.join(" ");
  if (taskText) {
    const body: RunSingleRequest = {
      task: taskText,
      engine: selectEngine(args),
      skipTests: resolveSkipTests(args),
      skipLint: resolveSkipLint(args),
      autoCommit: args.commit,
      maxRetries: args.maxRetries,
      retryDelay: args.retryDelay,
    };
    return { method: "POST", path: "/v1/run/single", body };
  }

  const body: RunPrdRequest = {
    prd: args.prd,
    yaml: args.yaml,
    github: args.github,
    githubLabel: args.githubLabel,
    maxIterations: args.maxIterations,
    maxRetries: args.maxRetries,
    retryDelay: args.retryDelay,
    branchPerTask: args.branchPerTask,
    baseBranch: args.baseBranch,
    createPr: args.createPr,
    draftPr: args.draftPr,
    skipTests: resolveSkipTests(args),
    skipLint: resolveSkipLint(args),
    autoCommit: args.commit,
    engine: selectEngine(args),
  };
  return {
    method: "POST",
    path: "/v1/run/prd",
    body,
  };
};

const waitForReady = async (fetcher: Fetcher, baseUrl: string) => {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      const response = await fetcher(`${baseUrl}/v1/health`);
      if (response.ok) {
        return;
      }
      lastError = new Error(`Server responded with ${response.status}`);
    } catch (error) {
      if (error instanceof Error) {
        lastError = error;
      } else {
        lastError = new Error("Server readiness failed");
      }
    }

    await delay(50);
  }

  throw lastError ?? new Error("Server not ready");
};

const dispatchRequest = async (
  target: DispatchTarget,
  baseUrl: string,
  fetcher: Fetcher,
): Promise<DispatchResult> => {
  const init: RequestInit = {
    method: target.method,
    headers: {
      "content-type": "application/json",
    },
  };

  if (target.body !== undefined) {
    init.body = JSON.stringify(target.body);
  }

  const response = await fetcher(`${baseUrl}${target.path}`, init);
  let payload: unknown = null;

  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  return { target, status: response.status, payload };
};

export const buildCli = (args: string[]) => configureCli(args);

export const parseArgs = (args: string[]) => buildCli(args).parseSync();

export const runCli = async (
  args: string[],
  deps: DispatchDependencies = {},
): Promise<DispatchResult | null> => {
  if (isHelpOrVersion(args)) {
    parseArgs(args);
    return null;
  }

  const parsed = parseArgs(args);
  const serverFactory = deps.createServer ?? createServer;
  const fetcher = deps.fetcher ?? fetch;
  const server = serverFactory({
    hostname: deps.hostname ?? "127.0.0.1",
    port: deps.port ?? 0,
  });
  const baseUrl = `http://${server.hostname}:${server.port}`;
  const target = selectDispatchTarget(parsed);

  try {
    if (!(target.method === "GET" && target.path === "/v1/health")) {
      await waitForReady(fetcher, baseUrl);
    }
    return await dispatchRequest(target, baseUrl, fetcher);
  } finally {
    await server.stop();
  }
};

if (import.meta.main) {
  await runCli(process.argv.slice(2));
}
