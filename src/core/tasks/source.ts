import { isAbsolute, join } from "node:path";
import { completeGithubTask, listGithubTasks, type GhRunner } from "./github";
import { completeMarkdownTask, parseMarkdownTasks } from "./markdown";
import { completeYamlTask, parseYamlTasks } from "./yaml";

export type TaskSourceType = "markdown" | "yaml" | "github";

export type TaskSourceOptions = {
  prd?: string;
  yaml?: string;
  github?: string;
  githubLabel?: string;
  cwd?: string;
  runner?: GhRunner;
};

export type TaskPreview = {
  source: TaskSourceType;
  text: string;
  line?: number;
  url?: string;
  number?: number;
};

export type TasksNextResult =
  | { status: "ok"; task: TaskPreview }
  | { status: "empty"; source: TaskSourceType }
  | { status: "error"; source: TaskSourceType; error: string };

export type TasksCompleteResult =
  | {
      status: "updated" | "already-complete" | "not-found";
      source: TaskSourceType;
      task: string;
      updated?: string;
      issueNumber?: number;
    }
  | { status: "error"; source: TaskSourceType; task: string; error: string };

type SelectedSource =
  | { type: "markdown"; path: string; cwd: string }
  | { type: "yaml"; path: string; cwd: string }
  | { type: "github"; repo?: string; label?: string; cwd: string; runner?: GhRunner };

const resolvePath = (path: string, cwd: string) => (isAbsolute(path) ? path : join(cwd, path));

const selectSource = (options: TaskSourceOptions): SelectedSource => {
  const cwd = options.cwd ?? process.cwd();

  if (options.github) {
    return {
      type: "github",
      repo: options.github,
      label: options.githubLabel,
      cwd,
      runner: options.runner,
    };
  }

  if (options.yaml) {
    return {
      type: "yaml",
      path: resolvePath(options.yaml, cwd),
      cwd,
    };
  }

  const prdPath = resolvePath(options.prd ?? "PRD.md", cwd);
  return {
    type: "markdown",
    path: prdPath,
    cwd,
  };
};

const readFileIfExists = async (path: string) => {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    return null;
  }
  return file.text();
};

export const getNextTask = async (options: TaskSourceOptions = {}): Promise<TasksNextResult> => {
  const source = selectSource(options);

  if (source.type === "github") {
    const tasks = await listGithubTasks({
      repo: source.repo,
      label: source.label,
      cwd: source.cwd,
      runner: source.runner,
    });
    const first = tasks[0];
    if (!first) {
      return { status: "empty", source: "github" };
    }
    return {
      status: "ok",
      task: {
        source: "github",
        text: first.title,
        url: first.url,
        number: first.number,
      },
    };
  }

  const contents = await readFileIfExists(source.path);
  if (!contents) {
    return {
      status: "error",
      source: source.type,
      error: `Missing task source file: ${source.path}`,
    };
  }

  if (source.type === "yaml") {
    const tasks = parseYamlTasks(contents).filter((task) => !task.completed);
    const first = tasks[0];
    if (!first) {
      return { status: "empty", source: "yaml" };
    }
    return {
      status: "ok",
      task: {
        source: "yaml",
        text: first.title,
        line: first.line,
      },
    };
  }

  const tasks = parseMarkdownTasks(contents).filter((task) => !task.completed);
  const first = tasks[0];
  if (!first) {
    return { status: "empty", source: "markdown" };
  }
  return {
    status: "ok",
    task: {
      source: "markdown",
      text: first.text,
      line: first.line,
    },
  };
};

export const completeTask = async (
  task: string,
  options: TaskSourceOptions = {},
): Promise<TasksCompleteResult> => {
  const source = selectSource(options);

  if (source.type === "github") {
    const result = await completeGithubTask(task, {
      repo: source.repo,
      label: source.label,
      cwd: source.cwd,
      runner: source.runner,
    });
    if (result.status === "updated") {
      return {
        status: "updated",
        source: "github",
        task,
        issueNumber: result.issueNumber,
      };
    }
    if (result.status === "already-complete") {
      return {
        status: "already-complete",
        source: "github",
        task,
        issueNumber: result.issueNumber,
      };
    }
    if (result.status === "not-found") {
      return { status: "not-found", source: "github", task };
    }
    return { status: "error", source: "github", task, error: "Unknown GitHub status" };
  }

  const contents = await readFileIfExists(source.path);
  if (!contents) {
    return {
      status: "error",
      source: source.type,
      task,
      error: `Missing task source file: ${source.path}`,
    };
  }

  if (source.type === "yaml") {
    const result = completeYamlTask(contents, task);
    if (result.status === "updated") {
      await Bun.write(source.path, result.updated);
      return {
        status: "updated",
        source: "yaml",
        task,
        updated: result.updated,
      };
    }
    if (result.status === "already-complete") {
      return { status: "already-complete", source: "yaml", task };
    }
    return { status: "not-found", source: "yaml", task };
  }

  const result = completeMarkdownTask(contents, task);
  if (result.status === "updated") {
    await Bun.write(source.path, result.updated);
    return {
      status: "updated",
      source: "markdown",
      task,
      updated: result.updated,
    };
  }
  if (result.status === "already-complete") {
    return { status: "already-complete", source: "markdown", task };
  }
  return { status: "not-found", source: "markdown", task };
};
