import { mkdir, stat } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import { ensureUniqueBranchName, parseBranchList, slugifyTask, type GitRunner } from "../git/branch";

export type WorktreeRecord = {
  group: string;
  branch: string;
  path: string;
  taskSourcePath?: string;
  copiedTaskSource?: string;
};

export type WorktreeCreateOptions = {
  group: string | number;
  taskSourcePath?: string;
  baseBranch?: string;
};

export type WorktreeManager = {
  createWorktree: (options: WorktreeCreateOptions) => Promise<WorktreeRecord>;
  cleanup: (options?: { removeBranches?: boolean; preserveDirty?: boolean }) => Promise<void>;
};


export type WorktreeManagerOptions = {
  cwd: string;
  baseBranch?: string;
  worktreeRoot?: string;
  runner?: GitRunner;
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

const pathExists = async (path: string) => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

const getCurrentBranch = async (runner: GitRunner, cwd: string) => {
  const { stdout } = await runner(["rev-parse", "--abbrev-ref", "HEAD"], { cwd });
  return stdout.trim();
};

const listBranches = async (runner: GitRunner, cwd: string) => {
  const { stdout } = await runner(["branch", "--list"], { cwd });
  return parseBranchList(stdout);
};

const isWorktreeDirty = async (runner: GitRunner, cwd: string) => {
  try {
    const { stdout } = await runner(["status", "--porcelain"], { cwd });
    return stdout.trim().length > 0;
  } catch {
    return true;
  }
};

const buildBranchName = (group: string, existing: string[]) => {
  const slug = slugifyTask(group);
  const baseName = `ralphy/parallel/${slug}`;
  return ensureUniqueBranchName(baseName, existing, 60);
};

const buildWorktreeRoot = (cwd: string, root?: string) => root ?? join(cwd, ".ralphy", "worktrees");

const normalizeGroup = (value: string | number) => String(value).trim() || "group";

const ensureUniquePath = async (basePath: string) => {
  if (!(await pathExists(basePath))) {
    return basePath;
  }
  for (let counter = 2; counter < 1000; counter += 1) {
    const candidate = `${basePath}-${counter}`;
    if (!(await pathExists(candidate))) {
      return candidate;
    }
  }
  return `${basePath}-${Date.now()}`;
};

const ensureWorktreeDirectory = async (path: string) => {
  await mkdir(path, { recursive: true });
};

const resolveTaskSourcePath = (cwd: string, path: string) =>
  path.startsWith("/") ? path : resolve(cwd, path);

const toWorktreeTargetPath = (cwd: string, absolutePath: string) => {
  const relativePath = relative(cwd, absolutePath);
  if (relativePath.startsWith("..")) {
    return basename(absolutePath);
  }
  return relativePath;
};

const copyTaskSource = async (cwd: string, worktreePath: string, sourcePath: string) => {
  const absolute = resolveTaskSourcePath(cwd, sourcePath);
  const file = Bun.file(absolute);
  if (!(await file.exists())) {
    throw new Error(`Task source not found: ${absolute}`);
  }
  const targetRelative = toWorktreeTargetPath(cwd, absolute);
  const targetPath = join(worktreePath, targetRelative);
  await mkdir(join(targetPath, ".."), { recursive: true });
  const contents = await file.text();
  await Bun.write(targetPath, contents);
  return targetPath;
};

export const createWorktreeManager = (options: WorktreeManagerOptions): WorktreeManager => {
  const runner = options.runner ?? defaultRunner;
  const cwd = options.cwd;
  const created: WorktreeRecord[] = [];

  const createWorktree = async ({ group, taskSourcePath, baseBranch }: WorktreeCreateOptions) => {
    const normalizedGroup = normalizeGroup(group);
    const targetBaseBranch = baseBranch?.trim() || options.baseBranch?.trim() || (await getCurrentBranch(runner, cwd));
    const existingBranches = await listBranches(runner, cwd);
    const branchName = buildBranchName(normalizedGroup, existingBranches);
    const root = buildWorktreeRoot(cwd, options.worktreeRoot);
    await ensureWorktreeDirectory(root);

    const worktreeName = branchName.replace(/^ralphy\/parallel\//, "") || slugifyTask(normalizedGroup);
    const basePath = join(root, worktreeName);
    const worktreePath = await ensureUniquePath(basePath);

    await runner(["worktree", "add", "-b", branchName, worktreePath, targetBaseBranch], { cwd });
    await ensureWorktreeDirectory(worktreePath);

    let copiedTaskSource: string | undefined;
    if (taskSourcePath) {
      copiedTaskSource = await copyTaskSource(cwd, worktreePath, taskSourcePath);
    }

    const record: WorktreeRecord = {
      group: normalizedGroup,
      branch: branchName,
      path: worktreePath,
      taskSourcePath,
      copiedTaskSource,
    };
    created.push(record);
    return record;
  };

const cleanup = async (options?: { removeBranches?: boolean; preserveDirty?: boolean }) => {
  const errors: Error[] = [];
  const removeBranches = options?.removeBranches ?? true;
  const preserveDirty = options?.preserveDirty ?? false;
  const remaining: WorktreeRecord[] = [];

  for (const record of created) {
    if (preserveDirty) {
      const dirty = await isWorktreeDirty(runner, record.path);
      if (dirty) {
        remaining.push(record);
        continue;
      }
    }

    try {
      await runner(["worktree", "remove", "--force", record.path], { cwd });
    } catch (error) {
      errors.push(error instanceof Error ? error : new Error("Worktree removal failed"));
    }

    if (removeBranches) {
      try {
        await runner(["branch", "-D", record.branch], { cwd });
      } catch (error) {
        errors.push(error instanceof Error ? error : new Error("Branch removal failed"));
      }
    }
  }

  created.length = 0;
  created.push(...remaining);

  if (errors.length > 0) {
    throw new Error(errors.map((error) => error.message).join("; "));
  }
};


  return { createWorktree, cleanup };
};
