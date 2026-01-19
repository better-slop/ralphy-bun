import { expect, test } from "bun:test";
import { join } from "node:path";
import { completeMarkdownTask, parseMarkdownTasks } from "../src/core/tasks/markdown";

const readFixture = (name: string) =>
  Bun.file(join(import.meta.dir, "fixtures", "markdown", name)).text();

test("parses markdown checkbox tasks", async () => {
  const contents = await readFixture("tasks.md");

  const tasks = parseMarkdownTasks(contents);

  expect(tasks).toHaveLength(3);
  expect(tasks[0]).toEqual({
    text: "First task",
    completed: false,
    line: 1,
    raw: "- [ ] First task",
  });
  expect(tasks[1]).toEqual({
    text: "Done task",
    completed: true,
    line: 2,
    raw: "  - [x] Done task",
  });
  expect(tasks[2]).toEqual({
    text: "Upper task",
    completed: true,
    line: 3,
    raw: "* [X] Upper task",
  });
});

test("completes matching task and preserves indentation", async () => {
  const contents = await readFixture("complete.md");

  const result = completeMarkdownTask(contents, "Second task");

  expect(result.status).toBe("updated");
  expect(result.updated).toBe("- [ ] First task\n  - [x] Second task\n");
});

test("returns already-complete when task is done", () => {
  const contents = "- [x] First task";

  const result = completeMarkdownTask(contents, "First task");

  expect(result.status).toBe("already-complete");
  expect(result.updated).toBe(contents);
});

test("returns not-found when task text is missing", () => {
  const contents = "- [ ] First task";

  const result = completeMarkdownTask(contents, "Missing task");

  expect(result.status).toBe("not-found");
  expect(result.updated).toBe(contents);
});
