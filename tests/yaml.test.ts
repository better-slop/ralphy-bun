import { expect, test } from "bun:test";
import { join } from "node:path";
import { completeYamlTask, parseYamlTasks } from "../src/core/tasks/yaml";

const readFixture = (name: string) => Bun.file(join(import.meta.dir, "fixtures", "yaml", name)).text();

test("parses yaml task list with completion state", async () => {
  const contents = await readFixture("tasks.yaml");

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

test("completes task by updating completed flag", async () => {
  const contents = await readFixture("complete.yaml");

  const result = completeYamlTask(contents, "Second task");

  expect(result.status).toBe("updated");
  expect(result.updated).toBe(
    "tasks:\n  - title: First task\n    completed: false\n  - title: Second task\n    completed: true\n    parallel_group: 1\n",
  );
});

test("returns already-complete when task is done", async () => {
  const contents = await readFixture("done.yaml");

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
