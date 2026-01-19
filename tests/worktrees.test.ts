import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorktreeManager } from "../src/core/parallel/worktrees";

type RunnerCall = {
  args: readonly string[];
  cwd?: string;
};

type RunnerHarness = {
  runner: (args: readonly string[], options?: { cwd?: string }) => Promise<{ stdout: string }>;
  calls: RunnerCall[];
};

const createRunner = (responses: Record<string, string>): RunnerHarness => {
  const calls: RunnerCall[] = [];
  return {
    calls,
    runner: async (args, options) => {
      calls.push({ args, cwd: options?.cwd });
      return { stdout: responses[args.join(" ")] ?? "" };
    },
  };
};

const createWorkspace = async () => {
  const cwd = await mkdtemp(join(tmpdir(), "ralphy-worktrees-"));
  await mkdir(join(cwd, ".ralphy"), { recursive: true });
  return cwd;
};

test("creates worktree and copies task source", async () => {
  const cwd = await createWorkspace();

  try {
    const prdPath = join(cwd, "PRD.md");
    await Bun.write(prdPath, "- [ ] Ship it");

    const { runner, calls } = createRunner({
      "rev-parse --abbrev-ref HEAD": "main\n",
      "branch --list": "main\n",
    });
    const manager = createWorktreeManager({ cwd, runner });
    const record = await manager.createWorktree({ group: "Group A", taskSourcePath: "PRD.md" });

    expect(record.branch).toBe("ralphy/parallel/group-a");
    expect(record.path).toBe(join(cwd, ".ralphy", "worktrees", "group-a"));
    expect(record.copiedTaskSource).toBe(join(record.path, "PRD.md"));

    const copied = await Bun.file(record.copiedTaskSource ?? "").text();
    expect(copied).toBe("- [ ] Ship it");

    expect(calls.map((call) => call.args.join(" "))).toEqual([
      "rev-parse --abbrev-ref HEAD",
      "branch --list",
      `worktree add -b ${record.branch} ${record.path} main`,
    ]);

    await manager.cleanup();
    expect(calls.map((call) => call.args.join(" "))).toEqual([
      "rev-parse --abbrev-ref HEAD",
      "branch --list",
      `worktree add -b ${record.branch} ${record.path} main`,
      `worktree remove --force ${record.path}`,
      `branch -D ${record.branch}`,
    ]);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("creates unique worktree path when directory exists", async () => {
  const cwd = await createWorkspace();

  try {
    const root = join(cwd, ".ralphy", "worktrees");
    await mkdir(join(root, "group"), { recursive: true });

    const { runner } = createRunner({
      "rev-parse --abbrev-ref HEAD": "main\n",
      "branch --list": "main\n",
    });
    const manager = createWorktreeManager({ cwd, runner, worktreeRoot: root });
    const record = await manager.createWorktree({ group: "Group" });

    expect(record.path).toBe(join(root, "group-2"));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("cleanup preserves dirty worktrees when requested", async () => {
  const cwd = await createWorkspace();

  try {
    const prdPath = join(cwd, "PRD.md");
    await Bun.write(prdPath, "- [ ] Ship it");

    const { runner, calls } = createRunner({
      "rev-parse --abbrev-ref HEAD": "main\n",
      "branch --list": "main\n",
      "status --porcelain": " M PRD.md\n",
    });
    const manager = createWorktreeManager({ cwd, runner });
    const record = await manager.createWorktree({ group: "Group A", taskSourcePath: "PRD.md" });

    await manager.cleanup({ preserveDirty: true });
    expect(calls.map((call) => call.args.join(" "))).toEqual([
      "rev-parse --abbrev-ref HEAD",
      "branch --list",
      `worktree add -b ${record.branch} ${record.path} main`,
      "status --porcelain",
    ]);

    await manager.cleanup({ preserveDirty: false });
    expect(calls.map((call) => call.args.join(" "))).toEqual([
      "rev-parse --abbrev-ref HEAD",
      "branch --list",
      `worktree add -b ${record.branch} ${record.path} main`,
      "status --porcelain",
      `worktree remove --force ${record.path}`,
      `branch -D ${record.branch}`,
    ]);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
