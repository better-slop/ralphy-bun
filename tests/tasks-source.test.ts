import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { completeTask, getNextTask } from "../src/core/tasks/source";

const readFixture = (path: string) => Bun.file(join(import.meta.dir, "fixtures", path)).text();

type RunnerCall = {
  args: string[];
};

type RunnerResponse = {
  args: string[];
  stdout: string;
};

const createRunner = (responses: RunnerResponse[]) => {
  const calls: RunnerCall[] = [];
  const runner = async (args: readonly string[]) => {
    calls.push({ args: [...args] });
    const response = responses.shift();
    if (!response) {
      throw new Error("Unexpected runner call");
    }
    return { stdout: response.stdout };
  };
  return { runner, calls };
};

let workingDir = "";

beforeEach(async () => {
  workingDir = await mkdtemp(join(tmpdir(), "ralphy-tasks-"));
});

afterEach(async () => {
  if (workingDir) {
    await rm(workingDir, { recursive: true, force: true });
  }
});

test("getNextTask returns next markdown task", async () => {
  const prdPath = join(workingDir, "PRD.md");
  await Bun.write(prdPath, await readFixture("markdown/tasks.md"));

  const result = await getNextTask({ cwd: workingDir, prd: "PRD.md" });

  expect(result).toEqual({
    status: "ok",
    task: {
      source: "markdown",
      text: "First task",
      line: 1,
    },
  });
});

test("completeTask updates markdown source", async () => {
  const prdPath = join(workingDir, "PRD.md");
  await Bun.write(prdPath, await readFixture("markdown/complete.md"));

  const result = await completeTask("Second task", { cwd: workingDir, prd: "PRD.md" });

  expect(result).toEqual({
    status: "updated",
    source: "markdown",
    task: "Second task",
    updated: "- [ ] First task\n  - [x] Second task\n",
  });
  expect(await Bun.file(prdPath).text()).toBe("- [ ] First task\n  - [x] Second task\n");
});

test("getNextTask returns next yaml task", async () => {
  const yamlPath = join(workingDir, "tasks.yaml");
  await Bun.write(yamlPath, await readFixture("yaml/tasks.yaml"));

  const result = await getNextTask({ cwd: workingDir, yaml: "tasks.yaml" });

  expect(result).toEqual({
    status: "ok",
    task: {
      source: "yaml",
      text: "First task",
      line: 2,
    },
  });
});

test("completeTask updates yaml source", async () => {
  const yamlPath = join(workingDir, "tasks.yaml");
  await Bun.write(yamlPath, await readFixture("yaml/complete.yaml"));

  const result = await completeTask("Second task", { cwd: workingDir, yaml: "tasks.yaml" });

  expect(result).toEqual({
    status: "updated",
    source: "yaml",
    task: "Second task",
    updated:
      "tasks:\n  - title: First task\n    completed: false\n  - title: Second task\n    completed: true\n    parallel_group: 1\n",
  });
  expect(await Bun.file(yamlPath).text()).toBe(
    "tasks:\n  - title: First task\n    completed: false\n  - title: Second task\n    completed: true\n    parallel_group: 1\n",
  );
});

test("getNextTask returns next github task", async () => {
  const { runner } = createRunner([
    {
      args: [],
      stdout: await readFixture("github/issue-list.json"),
    },
  ]);

  const result = await getNextTask({ github: "org/repo", runner });

  expect(result).toEqual({
    status: "ok",
    task: {
      source: "github",
      text: "First task",
      url: "https://example.com/1",
      number: 12,
    },
  });
});

test("completeTask closes github issue", async () => {
  const { runner, calls } = createRunner([
    {
      args: [],
      stdout: await readFixture("github/issue-list-mixed.json"),
    },
    { args: [], stdout: await readFixture("github/issue-view-open.json") },
    { args: [], stdout: "" },
  ]);

  const result = await completeTask("Ship it", { github: "org/repo", runner });

  expect(result).toEqual({
    status: "updated",
    source: "github",
    task: "Ship it",
    issueNumber: 42,
  });
  expect(calls.map((call) => call.args)).toEqual([
    [
      "issue",
      "list",
      "--state",
      "all",
      "--json",
      "number,title,url",
      "--limit",
      "200",
      "--repo",
      "org/repo",
    ],
    ["issue", "view", "42", "--json", "number,title,state", "--repo", "org/repo"],
    ["issue", "close", "42", "--repo", "org/repo"],
  ]);
});
