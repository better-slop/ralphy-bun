import { expect, test } from "bun:test";
import {
  buildBranchName,
  createBranchPerTaskManager,
  ensureUniqueBranchName,
  parseBranchList,
  slugifyTask,
} from "../src/core/git/branch";

type RunnerCall = {
  args: readonly string[];
  cwd?: string;
};

type RunnerResponseMap = Record<string, string>;

type RunnerHarness = {
  runner: (args: readonly string[], options?: { cwd?: string }) => Promise<{ stdout: string }>;
  calls: RunnerCall[];
};

const createRunner = (responses: RunnerResponseMap): RunnerHarness => {
  const calls: RunnerCall[] = [];
  return {
    calls,
    runner: async (args, options) => {
      calls.push({ args, cwd: options?.cwd });
      return { stdout: responses[args.join(" ")] ?? "" };
    },
  };
};

test("slugifyTask cleans and truncates", () => {
  expect(slugifyTask(" Ship it!! ")).toBe("ship-it");
  expect(slugifyTask("###")).toBe("task");
  const long = "a".repeat(80);
  expect(slugifyTask(long).length).toBe(48);
});

test("buildBranchName prefixes slug", () => {
  expect(buildBranchName("ship-it")).toBe("ralphy/ship-it");
});

test("ensureUniqueBranchName increments suffix", () => {
  const existing = ["ralphy/ship-it", "ralphy/ship-it-2"];
  expect(ensureUniqueBranchName("ralphy/ship-it", existing)).toBe("ralphy/ship-it-3");
});

test("parseBranchList strips markers", () => {
  const branches = parseBranchList("* main\n  ralphy/ship-it\n\n");
  expect(branches).toEqual(["main", "ralphy/ship-it"]);
});

test("branch manager stashes and checks out task branches", async () => {
  const { runner, calls } = createRunner({
    "rev-parse --abbrev-ref HEAD": "main\n",
    "status --porcelain": " M file.txt\n",
    "stash list --format=%gd -n 1": "stash@{0}\n",
    "branch --list": "main\n",
  });
  const manager = createBranchPerTaskManager({ cwd: "/repo", runner });

  await manager.prepare();
  const branch = await manager.checkoutForTask("Ship it");
  await manager.finishTask();
  await manager.cleanup();

  expect(branch).toBe("ralphy/ship-it");
  expect(calls.map((call) => call.args.join(" "))).toEqual([
    "rev-parse --abbrev-ref HEAD",
    "status --porcelain",
    "stash push -u -m ralphy: branch-per-task",
    "stash list --format=%gd -n 1",
    "branch --list",
    "checkout -b ralphy/ship-it main",
    "checkout main",
    "stash pop stash@{0}",
  ]);
});
