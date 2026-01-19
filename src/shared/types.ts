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

export type ConfigRulesRequest = {
  rule: string;
};

export type ServerRequestBody =
  | RunSingleRequest
  | RunPrdRequest
  | ConfigRulesRequest;
