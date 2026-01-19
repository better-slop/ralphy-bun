import { expect, test } from "bun:test";
import { join } from "node:path";
import { completeGithubTask, listGithubTasks } from "../src/core/tasks/github";

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

const readFixture = (name: string) =>
  Bun.file(join(import.meta.dir, "fixtures", "github", name)).text();

test("lists github issues with label and repo", async () => {
  const { runner, calls } = createRunner([
    {
      args: [],
      stdout: await readFixture("issue-list.json"),
    },
  ]);

  const tasks = await listGithubTasks({ repo: "owner/repo", label: "ready", runner });

  expect(tasks).toEqual([
    { number: 12, title: "First task", url: "https://example.com/1" },
    { number: 13, title: "Second task", url: "https://example.com/2" },
  ]);
  expect(calls[0]?.args).toEqual([
    "issue",
    "list",
    "--state",
    "open",
    "--json",
    "number,title,url",
    "--limit",
    "200",
    "--label",
    "ready",
    "--repo",
    "owner/repo",
  ]);
});

test("completes open issue by title", async () => {
  const { runner, calls } = createRunner([
    {
      args: [],
      stdout: await readFixture("issue-list-mixed.json"),
    },
    { args: [], stdout: await readFixture("issue-view-open.json") },
    { args: [], stdout: "" },
  ]);

  const result = await completeGithubTask("Ship it", { runner });

  expect(result).toEqual({ status: "updated", taskTitle: "Ship it", issueNumber: 42 });
  expect(calls.map((call) => call.args)).toEqual([
    ["issue", "list", "--state", "all", "--json", "number,title,url", "--limit", "200"],
    ["issue", "view", "42", "--json", "number,title,state"],
    ["issue", "close", "42"],
  ]);
});

test("returns already-complete when issue closed", async () => {
  const { runner } = createRunner([
    {
      args: [],
      stdout: await readFixture("issue-list-single.json"),
    },
    { args: [], stdout: await readFixture("issue-view-closed.json") },
  ]);

  const result = await completeGithubTask("Done task", { runner });

  expect(result).toEqual({ status: "already-complete", taskTitle: "Done task", issueNumber: 5 });
});

test("returns not-found when issue missing", async () => {
  const { runner } = createRunner([
    { args: [], stdout: await readFixture("issue-list-single.json") },
  ]);

  const result = await completeGithubTask("Missing", { runner });

  expect(result).toEqual({ status: "not-found", taskTitle: "Missing" });
});
