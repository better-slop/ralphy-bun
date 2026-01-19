export type GitCommandResult = {
  stdout: string;
};

export type GitRunner = (args: readonly string[], options?: { cwd?: string }) => Promise<GitCommandResult>;

type BranchPerTaskOptions = {
  cwd: string;
  baseBranch?: string;
  runner?: GitRunner;
};

export type BranchPerTaskManager = {
  prepare: () => Promise<void>;
  checkoutForTask: (task: string) => Promise<string>;
  finishTask: () => Promise<void>;
  cleanup: () => Promise<void>;
};

const defaultRunner: GitRunner = async (args, options) => {
  const process = Bun.spawn(["git", ...args], {
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
    throw new Error(trimmed.length > 0 ? trimmed : "git command failed");
  }
  return { stdout };
};

export const parseBranchList = (stdout: string) =>
  stdout
    .split(/\r?\n/)
    .map((line) => line.replace(/^\*?\s*/, "").trim())
    .filter((line) => line.length > 0);

export const slugifyTask = (task: string, maxLength = 48) => {
  const lowered = task.toLowerCase();
  const cleaned = lowered.replace(/[^a-z0-9]+/g, "-");
  const trimmed = cleaned.replace(/^-+/, "").replace(/-+$/, "");
  const collapsed = trimmed.replace(/-+/g, "-");
  const base = collapsed.length > 0 ? collapsed : "task";
  const clipped = base.slice(0, maxLength);
  return clipped.replace(/-+$/, "");
};

export const buildBranchName = (slug: string) => `ralphy/${slug}`;

export const ensureUniqueBranchName = (baseName: string, existingBranches: string[], maxLength = 60) => {
  if (!existingBranches.includes(baseName)) {
    return baseName;
  }
  let counter = 2;
  while (counter < 1000) {
    const suffix = `-${counter}`;
    const clipped = baseName.slice(0, Math.max(1, maxLength - suffix.length));
    const candidate = `${clipped}${suffix}`;
    if (!existingBranches.includes(candidate)) {
      return candidate;
    }
    counter += 1;
  }
  return `${baseName}-${Date.now()}`;
};

const listBranches = async (runner: GitRunner, cwd: string) => {
  const { stdout } = await runner(["branch", "--list"], { cwd });
  return parseBranchList(stdout);
};

const getCurrentBranch = async (runner: GitRunner, cwd: string) => {
  const { stdout } = await runner(["rev-parse", "--abbrev-ref", "HEAD"], { cwd });
  return stdout.trim();
};

const isWorkingTreeDirty = async (runner: GitRunner, cwd: string) => {
  const { stdout } = await runner(["status", "--porcelain"], { cwd });
  return stdout.trim().length > 0;
};

const stashChanges = async (runner: GitRunner, cwd: string, message: string) => {
  await runner(["stash", "push", "-u", "-m", message], { cwd });
  const { stdout } = await runner(["stash", "list", "--format=%gd", "-n", "1"], { cwd });
  const ref = stdout.trim();
  return ref.length > 0 ? ref : undefined;
};

const popStash = async (runner: GitRunner, cwd: string, ref?: string) => {
  if (!ref) {
    return;
  }
  await runner(["stash", "pop", ref], { cwd });
};

const checkoutBranch = async (runner: GitRunner, cwd: string, branch: string) => {
  await runner(["checkout", branch], { cwd });
};

const createBranch = async (runner: GitRunner, cwd: string, branch: string, baseBranch: string) => {
  await runner(["checkout", "-b", branch, baseBranch], { cwd });
};

export const createBranchPerTaskManager = (options: BranchPerTaskOptions): BranchPerTaskManager => {
  const runner = options.runner ?? defaultRunner;
  const cwd = options.cwd;
  const stashMessage = "ralphy: branch-per-task";
  let baseBranch = options.baseBranch?.trim();
  let originalBranch = "";
  let stashRef: string | undefined;

  const prepare = async () => {
    originalBranch = await getCurrentBranch(runner, cwd);
    baseBranch = baseBranch && baseBranch.length > 0 ? baseBranch : originalBranch;
    if (await isWorkingTreeDirty(runner, cwd)) {
      stashRef = await stashChanges(runner, cwd, stashMessage);
    }
    if (baseBranch !== originalBranch) {
      await checkoutBranch(runner, cwd, baseBranch);
    }
  };

  const checkoutForTask = async (task: string) => {
    const baseSlug = slugifyTask(task);
    const baseName = buildBranchName(baseSlug);
    const branches = await listBranches(runner, cwd);
    const branchName = ensureUniqueBranchName(baseName, branches);
    await createBranch(runner, cwd, branchName, baseBranch ?? originalBranch);
    return branchName;
  };

  const finishTask = async () => {
    const target = baseBranch ?? originalBranch;
    await checkoutBranch(runner, cwd, target);
  };

  const cleanup = async () => {
    if (originalBranch && baseBranch && originalBranch !== baseBranch) {
      await checkoutBranch(runner, cwd, originalBranch);
    }
    await popStash(runner, cwd, stashRef);
  };

  return {
    prepare,
    checkoutForTask,
    finishTask,
    cleanup,
  };
};
