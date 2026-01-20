export type AgentEngine = "claude" | "opencode" | "cursor" | "codex" | "qwen" | "droid";

export type AgentCommand = {
  command: string;
  args: string[];
  env?: Record<string, string>;
};

export type AgentRunResult = {
  command: AgentCommand;
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type AgentUsage = {
  inputTokens: number;
  outputTokens: number;
  cost?: number;
  durationMs?: number;
};

export type AgentUsageTotals = {
  inputTokens: number;
  outputTokens: number;
  cost?: number;
  durationMs?: number;
};

export type CliOptions = {
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

export type HealthResponse = {
  status: "ok";
  version: string;
};

export type VersionResponse = {
  version: string;
};

export type ErrorResponse = {
  error: string;
};

export type TaskSource = "markdown" | "yaml" | "github";

export type PromptMode = "single" | "prd";

export type RunSingleRequest = {
  task: string;
  engine?: AgentEngine;
  skipTests?: boolean;
  skipLint?: boolean;
  autoCommit?: boolean;
  dryRun?: boolean;
  maxRetries?: number;
  retryDelay?: number;
  promptMode?: PromptMode;
  taskSource?: TaskSource;
  taskSourcePath?: string;
  issueBody?: string;
};

export type RunSingleResponse =
  | {
      status: "ok";
      engine: AgentEngine;
      attempts: number;
      response: string;
      usage: AgentUsage;
      stdout: string;
      stderr: string;
      exitCode: number;
    }
  | {
      status: "error";
      engine: AgentEngine;
      attempts: number;
      error: string;
      stdout: string;
      stderr: string;
      exitCode: number;
    }
  | {
      status: "dry-run";
      engine: AgentEngine;
      prompt: string;
    };

export type RunPrdRequest = {
  prd?: string;
  yaml?: string;
  github?: string;
  githubLabel?: string;
  maxIterations?: number;
  maxRetries?: number;
  retryDelay?: number;
  parallel?: boolean;
  maxParallel?: number;
  branchPerTask?: boolean;
  baseBranch?: string;
  createPr?: boolean;
  draftPr?: boolean;
  skipTests?: boolean;
  skipLint?: boolean;
  autoCommit?: boolean;
  engine?: AgentEngine;
};

export type PrdRequirement = "git" | "dependencies" | "task-source";

export type PrdRequirementFailure = {
  requirement: PrdRequirement;
  message: string;
};

export type PrdRequirementsResult =
  | { status: "ok" }
  | { status: "error"; failures: PrdRequirementFailure[] };

export type PrdRunTask = {
  task: string;
  source: TaskSource;
  status: "completed" | "failed";
  attempts: number;
  response?: string;
  error?: string;
};

export type RunPrdSuccess = {
  status: "ok";
  iterations: number;
  completed: number;
  stopped: "no-tasks" | "max-iterations";
  tasks: PrdRunTask[];
  usage: AgentUsageTotals;
};

export type RunPrdFailure =
  | { status: "error"; failures: PrdRequirementFailure[]; usage?: AgentUsageTotals }
  | {
      status: "error";
      stage: "task-source" | "agent" | "complete" | "pr" | "merge";
      message: string;
      iterations: number;
      tasks: PrdRunTask[];
      task?: string;
      usage: AgentUsageTotals;
    };

export type RunPrdResponse = RunPrdSuccess | RunPrdFailure;

export type TasksNextQuery = {
  prd?: string;
  yaml?: string;
  github?: string;
  githubLabel?: string;
};

export type TaskPreview = {
  source: TaskSource;
  text: string;
  line?: number;
  url?: string;
  number?: number;
};

export type TasksNextResponse =
  | { status: "ok"; task: TaskPreview }
  | { status: "empty" | "error"; source: TaskSource; error?: string };

export type TasksCompleteRequest = {
  task: string;
  prd?: string;
  yaml?: string;
  github?: string;
  githubLabel?: string;
};

export type TasksCompleteResponse =
  | {
      status: "updated" | "already-complete" | "not-found";
      source: "markdown" | "yaml" | "github";
      task: string;
      updated?: string;
      issueNumber?: number;
    }
  | {
      status: "error";
      source: "markdown" | "yaml" | "github";
      task: string;
      error: string;
    };

export type ConfigRulesRequest = {
  rule: string;
};

export type ServerRequestBody =
  | RunSingleRequest
  | RunPrdRequest
  | TasksCompleteRequest
  | ConfigRulesRequest;
