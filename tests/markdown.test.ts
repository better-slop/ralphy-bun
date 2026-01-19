import { expect, test } from "bun:test";
import { completeMarkdownTask, parseMarkdownTasks } from "../src/core/tasks/markdown";

test("parses markdown checkbox tasks", () => {
  const contents = [
    "- [ ] First task",
    "  - [x] Done task",
    "* [X] Upper task",
    "Not a task",
  ].join("\n");

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

test("completes matching task and preserves indentation", () => {
  const contents = [
    "- [ ] First task",
    "  - [ ] Second task",
  ].join("\n");

  const result = completeMarkdownTask(contents, "Second task");

  expect(result.status).toBe("updated");
  expect(result.updated).toBe("- [ ] First task\n  - [x] Second task");
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
