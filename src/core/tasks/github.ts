export type GithubTask = {
  number: number;
  title: string;
  url: string;
};

export type GithubTaskCompletionStatus = "updated" | "not-found" | "already-complete";

export type GithubTaskCompletionResult = {
  status: GithubTaskCompletionStatus;
  taskTitle: string;
  issueNumber?: number;
};

export type GhCommandResult = {
  stdout: string;
};

export type GhRunner = (args: readonly string[], options?: { cwd?: string }) => Promise<GhCommandResult>;

export type GithubTaskSourceOptions = {
  repo?: string;
  label?: string;
  cwd?: string;
  runner?: GhRunner;
};

type IssueListRecord = {
  number: number;
  title: string;
  url: string;
};

type IssueViewRecord = {
  number: number;
  title: string;
  state: string;
};

const normalizeTaskTitle = (value: string) => value.trim();

const isIssueListRecord = (value: unknown): value is IssueListRecord => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value;
  const numberValue = Reflect.get(record, "number");
  const titleValue = Reflect.get(record, "title");
  const urlValue = Reflect.get(record, "url");
  return typeof numberValue === "number" && typeof titleValue === "string" && typeof urlValue === "string";
};

const isIssueViewRecord = (value: unknown): value is IssueViewRecord => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value;
  const numberValue = Reflect.get(record, "number");
  const titleValue = Reflect.get(record, "title");
  const stateValue = Reflect.get(record, "state");
  return typeof numberValue === "number" && typeof titleValue === "string" && typeof stateValue === "string";
};

const parseIssueList = (stdout: string): IssueListRecord[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.filter(isIssueListRecord);
};

const parseIssueView = (stdout: string): IssueViewRecord | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return null;
  }
  if (!isIssueViewRecord(parsed)) {
    return null;
  }
  return parsed;
};

const defaultRunner: GhRunner = async (args, options) => {
  const process = Bun.spawn(["gh", ...args], {
    cwd: options?.cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  const exitCode = await process.exited;
  if (exitCode !== 0) {
    const trimmed = stderr.trim();
    throw new Error(trimmed.length > 0 ? trimmed : "gh command failed");
  }
  return { stdout };
};

const buildRepoArgs = (options: GithubTaskSourceOptions): string[] => {
  if (options.repo && options.repo.trim().length > 0) {
    return ["--repo", options.repo];
  }
  return [];
};

const buildLabelArgs = (options: GithubTaskSourceOptions): string[] => {
  if (options.label && options.label.trim().length > 0) {
    return ["--label", options.label];
  }
  return [];
};

export const listGithubTasks = async (options: GithubTaskSourceOptions = {}): Promise<GithubTask[]> => {
  const runner = options.runner ?? defaultRunner;
  const args = [
    "issue",
    "list",
    "--state",
    "open",
    "--json",
    "number,title,url",
    "--limit",
    "200",
    ...buildLabelArgs(options),
    ...buildRepoArgs(options),
  ];
  const { stdout } = await runner(args, { cwd: options.cwd });
  return parseIssueList(stdout).map((issue) => ({
    number: issue.number,
    title: normalizeTaskTitle(issue.title),
    url: issue.url,
  }));
};

export const completeGithubTask = async (
  taskTitle: string,
  options: GithubTaskSourceOptions = {},
): Promise<GithubTaskCompletionResult> => {
  const runner = options.runner ?? defaultRunner;
  const normalizedTarget = normalizeTaskTitle(taskTitle);
  const listArgs = [
    "issue",
    "list",
    "--state",
    "all",
    "--json",
    "number,title,url",
    "--limit",
    "200",
    ...buildLabelArgs(options),
    ...buildRepoArgs(options),
  ];
  const { stdout } = await runner(listArgs, { cwd: options.cwd });
  const issues = parseIssueList(stdout);
  const match = issues.find((issue) => normalizeTaskTitle(issue.title) === normalizedTarget);
  if (!match) {
    return { status: "not-found", taskTitle };
  }

  const viewArgs = ["issue", "view", String(match.number), "--json", "number,title,state", ...buildRepoArgs(options)];
  const viewResult = await runner(viewArgs, { cwd: options.cwd });
  const view = parseIssueView(viewResult.stdout);
  if (!view) {
    return { status: "not-found", taskTitle, issueNumber: match.number };
  }
  if (view.state.toLowerCase() === "closed") {
    return { status: "already-complete", taskTitle, issueNumber: view.number };
  }

  const closeArgs = ["issue", "close", String(view.number), ...buildRepoArgs(options)];
  await runner(closeArgs, { cwd: options.cwd });
  return { status: "updated", taskTitle, issueNumber: view.number };
};
