import { expect, test } from "bun:test";
import { completeYamlTask, parseYamlTasks } from "../src/core/tasks/yaml";

test("parses yaml task list with completion state", () => {
  const contents = [
    "tasks:",
    "  - title: First task",
    "    completed: false",
    "  - title: Second task",
    "    completed: true",
    "    parallel_group: 2",
  ].join("\n");

  const tasks = parseYamlTasks(contents);

  expect(tasks).toHaveLength(2);
  expect(tasks[0]).toEqual({
    title: "First task",
    completed: false,
    parallelGroup: 0,
    line: 2,
    raw: "  - title: First task",
  });
  expect(tasks[1]).toEqual({
    title: "Second task",
    completed: true,
    parallelGroup: 2,
    line: 4,
    raw: "  - title: Second task",
  });
});

test("completes task by updating completed flag", () => {
  const contents = [
    "tasks:",
    "  - title: First task",
    "    completed: false",
    "  - title: Second task",
    "    parallel_group: 1",
  ].join("\n");

  const result = completeYamlTask(contents, "Second task");

  expect(result.status).toBe("updated");
  expect(result.updated).toBe(
    "tasks:\n  - title: First task\n    completed: false\n  - title: Second task\n    completed: true\n    parallel_group: 1",
  );
});

test("returns already-complete when task is done", () => {
  const contents = ["tasks:", "  - title: First task", "    completed: true"].join("\n");

  const result = completeYamlTask(contents, "First task");

  expect(result.status).toBe("already-complete");
  expect(result.updated).toBe(contents);
});

test("returns not-found when task title is missing", () => {
  const contents = ["tasks:", "  - title: First task", "    completed: false"].join("\n");

  const result = completeYamlTask(contents, "Missing task");

  expect(result.status).toBe("not-found");
  expect(result.updated).toBe(contents);
});
