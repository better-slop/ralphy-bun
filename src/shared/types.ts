export type AgentEngine = "claude" | "opencode" | "cursor" | "codex" | "qwen" | "droid";

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

export type RunSingleRequest = {
  task: string;
};

export type RunPrdRequest = {
  prd?: string;
  yaml?: string;
  github?: string;
  githubLabel?: string;
};

export type TasksNextQuery = {
  prd?: string;
  yaml?: string;
  github?: string;
  githubLabel?: string;
};

export type TaskPreview = {
  source: "markdown" | "yaml" | "github";
  text: string;
  line?: number;
  url?: string;
  number?: number;
};

export type TasksNextResponse =
  | { status: "ok"; task: TaskPreview }
  | { status: "empty" | "error"; source: "markdown" | "yaml" | "github"; error?: string };

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
