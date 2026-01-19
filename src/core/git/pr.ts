export type GhCommandResult = {
  stdout: string;
};

export type GhRunner = (args: readonly string[], options?: { cwd?: string }) => Promise<GhCommandResult>;

export type PrCreateOptions = {
  cwd: string;
  title: string;
  body: string;
  baseBranch?: string;
  headBranch?: string;
  draft?: boolean;
  runner?: GhRunner;
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

export const buildPrCreateArgs = (options: PrCreateOptions) => {
  const args = ["pr", "create", "--title", options.title, "--body", options.body];
  if (options.baseBranch) {
    args.push("--base", options.baseBranch);
  }
  if (options.headBranch) {
    args.push("--head", options.headBranch);
  }
  if (options.draft) {
    args.push("--draft");
  }
  return args;
};

export const createPullRequest = async (options: PrCreateOptions) => {
  const runner = options.runner ?? defaultRunner;
  const args = buildPrCreateArgs(options);
  await runner(args, { cwd: options.cwd });
};
