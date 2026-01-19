import yargs from "yargs/yargs";
import type { Argv } from "yargs";
import { packageVersion } from "./shared/version";

type CliArgs = {
  task?: string[];
  init?: boolean;
  config?: boolean;
  addRule?: string;
  skipTests?: boolean;
  noTests?: boolean;
  skipLint?: boolean;
  noLint?: boolean;
  fast?: boolean;
  dryRun?: boolean;
  maxIterations?: number;
  maxRetries?: number;
  retryDelay?: number;
  claude?: boolean;
  opencode?: boolean;
  cursor?: boolean;
  agent?: boolean;
  codex?: boolean;
  qwen?: boolean;
  droid?: boolean;
  parallel?: boolean;
  maxParallel?: number;
  branchPerTask?: boolean;
  baseBranch?: string;
  createPr?: boolean;
  draftPr?: boolean;
  commit?: boolean;
  prd?: string;
  yaml?: string;
  github?: string;
  githubLabel?: string;
  verbose?: boolean;
  v?: boolean;
};

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

export const buildCli = (args: string[]) => configureCli(args);

export const parseArgs = (args: string[]) => buildCli(args).parseSync();

if (import.meta.main) {
  parseArgs(process.argv.slice(2));
}
