import { join } from "node:path";
import type { PromptMode, TaskSource } from "../shared/types";

export type PromptConfig = {
  task?: string;
  cwd?: string;
  configPath?: string;
  progressPath?: string;
  skipTests?: boolean;
  skipLint?: boolean;
  autoCommit?: boolean;
  promptMode?: PromptMode;
  taskSource?: TaskSource;
  taskSourcePath?: string;
  issueBody?: string;
};

type ProjectContext = {
  name?: string;
  language?: string;
  framework?: string;
  description?: string;
};

type ParsedConfig = {
  project: ProjectContext;
  rules: string[];
  boundaries: string[];
};

const defaultConfig: ParsedConfig = {
  project: {},
  rules: [],
  boundaries: [],
};

const stripQuotes = (value: string) => {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).replaceAll("\\\"", "\"");
  }
  return trimmed;
};

const parseProjectSection = (lines: string[]): ProjectContext => {
  const project: ProjectContext = {};
  for (const line of lines) {
    const match = line.match(/^\s*(name|language|framework|description):\s*(.+)$/);
    if (!match) {
      continue;
    }
    const key = match[1] as keyof ProjectContext;
    const value = stripQuotes(match[2] ?? "");
    if (value.length > 0) {
      project[key] = value;
    }
  }
  return project;
};

const collectBlock = (lines: string[], startIndex: number, indentSize: number) => {
  const block: string[] = [];
  for (let i = startIndex + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      block.push(line);
      continue;
    }
    const indent = line.match(/^\s*/)?.[0].length ?? 0;
    if (indent <= indentSize) {
      break;
    }
    block.push(line);
  }
  return block;
};

const parseListBlock = (lines: string[]) => {
  const items: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("-")) {
      const value = stripQuotes(trimmed.replace(/^-\s*/, ""));
      if (value.length > 0) {
        items.push(value);
      }
    }
  }
  return items;
};

const parseConfigYaml = (contents: string): ParsedConfig => {
  const lines = contents.split(/\r?\n/);
  const config: ParsedConfig = { ...defaultConfig };

  const projectIndex = lines.findIndex((line) => line.trimStart().startsWith("project:"));
  if (projectIndex >= 0) {
    const indent = lines[projectIndex]?.match(/^\s*/)?.[0].length ?? 0;
    const projectLines = collectBlock(lines, projectIndex, indent);
    config.project = parseProjectSection(projectLines);
  }

  const rulesIndex = lines.findIndex((line) => line.trimStart().startsWith("rules:"));
  if (rulesIndex >= 0) {
    const indent = lines[rulesIndex]?.match(/^\s*/)?.[0].length ?? 0;
    const rulesLines = collectBlock(lines, rulesIndex, indent);
    config.rules = parseListBlock(rulesLines);
  }

  const boundariesIndex = lines.findIndex((line) => line.trimStart().startsWith("boundaries:"));
  if (boundariesIndex >= 0) {
    const indent = lines[boundariesIndex]?.match(/^\s*/)?.[0].length ?? 0;
    const boundariesLines = collectBlock(lines, boundariesIndex, indent);
    const neverTouchIndex = boundariesLines.findIndex((line) =>
      line.trimStart().startsWith("never_touch:"),
    );
    if (neverTouchIndex >= 0) {
      const absoluteStart = boundariesIndex + neverTouchIndex + 1;
      const neverTouchIndent =
        lines[absoluteStart]?.match(/^\s*/)?.[0].length ?? indent + 2;
      const neverTouchLines = collectBlock(lines, absoluteStart, neverTouchIndent);
      config.boundaries = parseListBlock(neverTouchLines);
    }
  }

  return config;
};

const readConfig = async (configPath: string): Promise<ParsedConfig> => {
  const file = Bun.file(configPath);
  if (!(await file.exists())) {
    return { ...defaultConfig };
  }
  const contents = await file.text();
  return parseConfigYaml(contents);
};

const formatProjectContext = (project: ProjectContext) => {
  const lines: string[] = [];
  if (project.name) {
    lines.push(`Project: ${project.name}`);
  }
  if (project.language) {
    lines.push(`Language: ${project.language}`);
  }
  if (project.framework) {
    lines.push(`Framework: ${project.framework}`);
  }
  if (project.description) {
    lines.push(`Description: ${project.description}`);
  }
  return lines.length > 0 ? `## Project Context\n${lines.join("\n")}` : "";
};

const formatRules = (rules: string[]) =>
  rules.length > 0 ? `## Rules (you MUST follow these)\n${rules.join("\n")}` : "";

const formatBoundaries = (boundaries: string[]) => {
  if (boundaries.length === 0) {
    return "";
  }
  return `## Boundaries\nDo NOT modify these files/directories:\n${boundaries.join("\n")}`;
};

const formatInstructions = (
  progressPath: string,
  skipTests: boolean,
  skipLint: boolean,
  autoCommit: boolean,
) => {
  const lines: string[] = [];
  let step = 1;

  lines.push(`${step}. Implement the task described above`);
  step += 1;

  if (!skipTests) {
    lines.push(`${step}. Write tests for the feature.`);
    step += 1;
    lines.push(`${step}. Run tests and ensure they pass before proceeding.`);
    step += 1;
  }

  if (!skipLint) {
    lines.push(`${step}. Run linting and ensure it passes before proceeding.`);
    step += 1;
  }

  lines.push(`${step}. Append your progress to ${progressPath}.`);
  step += 1;

  if (autoCommit) {
    lines.push(`${step}. Commit your changes with a descriptive message.`);
    step += 1;
  }

  lines.push("ONLY WORK ON A SINGLE TASK.");
  if (!skipTests) {
    lines.push("Do not proceed if tests fail.");
  }
  if (!skipLint) {
    lines.push("Do not proceed if linting fails.");
  }
  lines.push("If ALL tasks in the PRD are complete, output <promise>COMPLETE</promise>.");

  return `## Instructions\n${lines.join("\n")}`;
};

const resolveTaskSource = (options: PromptConfig, cwd: string, useRelativeDefaults: boolean) => {
  const taskSource = options.taskSource ?? "markdown";
  if (taskSource === "github") {
    return { taskSource, taskSourcePath: undefined } as const;
  }
  const defaultFile = taskSource === "yaml" ? "tasks.yaml" : "PRD.md";
  const taskSourcePath = options.taskSourcePath ?? (useRelativeDefaults ? defaultFile : join(cwd, defaultFile));
  return { taskSource, taskSourcePath } as const;
};

const formatPrdInstructions = (options: {
  taskSource: TaskSource;
  taskSourcePath?: string;
  progressPath: string;
  skipTests: boolean;
  skipLint: boolean;
}) => {
  const lines: string[] = [];
  let step = 1;

  lines.push(`${step}. Find the highest-priority incomplete task and implement it.`);
  step += 1;

  if (!options.skipTests) {
    lines.push(`${step}. Write tests for the feature.`);
    step += 1;
    lines.push(`${step}. Run tests and ensure they pass before proceeding.`);
    step += 1;
  }

  if (!options.skipLint) {
    lines.push(`${step}. Run linting and ensure it passes before proceeding.`);
    step += 1;
  }

  if (options.taskSource === "yaml") {
    lines.push(
      `${step}. Update ${options.taskSourcePath ?? "tasks.yaml"} to mark the task as completed (set completed: true).`,
    );
  } else if (options.taskSource === "github") {
    lines.push(
      `${step}. The task will be marked complete automatically. Just note the completion in ${options.progressPath}.`,
    );
  } else {
    lines.push(
      `${step}. Update the PRD to mark the task as complete (change '- [ ]' to '- [x]').`,
    );
  }
  step += 1;

  lines.push(`${step}. Append your progress to ${options.progressPath}.`);
  step += 1;
  lines.push(`${step}. Commit your changes with a descriptive message.`);
  lines.push("ONLY WORK ON A SINGLE TASK.");
  if (!options.skipTests) {
    lines.push("Do not proceed if tests fail.");
  }
  if (!options.skipLint) {
    lines.push("Do not proceed if linting fails.");
  }
  lines.push("If ALL tasks in the PRD are complete, output <promise>COMPLETE</promise>.");

  return lines.join("\n");
};

const formatPrdContext = (options: {
  taskSource: TaskSource;
  taskSourcePath?: string;
  progressPath: string;
  task?: string;
  issueBody?: string;
}) => {
  if (options.taskSource === "github") {
    const title = options.task ?? "";
    const body = options.issueBody ?? "";
    return [
      `Task from GitHub Issue: ${title}`,
      "",
      "Issue Description:",
      body,
      "",
      `@${options.progressPath}`,
    ].join("\n");
  }

  const parts = [] as string[];
  if (options.taskSourcePath) {
    parts.push(`@${options.taskSourcePath}`);
  }
  parts.push(`@${options.progressPath}`);
  return parts.join(" ");
};

export const buildSingleTaskPrompt = async (options: PromptConfig): Promise<string> => {
  const cwd = options.cwd ?? process.cwd();
  const configPath = options.configPath ?? join(cwd, ".ralphy", "config.yaml");
  const promptMode = options.promptMode ?? "single";
  const progressPath =
    options.progressPath ?? (promptMode === "prd" ? ".ralphy/progress.txt" : join(cwd, ".ralphy", "progress.txt"));
  const skipTests = options.skipTests ?? false;
  const skipLint = options.skipLint ?? false;
  const autoCommit = options.autoCommit ?? true;

  if (promptMode === "prd") {
    const { taskSource, taskSourcePath } = resolveTaskSource(options, cwd, true);
    const context = formatPrdContext({
      taskSource,
      taskSourcePath,
      progressPath,
      task: options.task,
      issueBody: options.issueBody,
    });
    const instructions = formatPrdInstructions({
      taskSource,
      taskSourcePath,
      progressPath,
      skipTests,
      skipLint,
    });
    return `${context}\n${instructions}\n`;
  }

  if (!options.task || options.task.trim().length === 0) {
    throw new Error("Task is required for single-task prompts");
  }

  const config = await readConfig(configPath);
  const sections: string[] = [];

  const progressFile = Bun.file(progressPath);
  if (await progressFile.exists()) {
    sections.push(`@${progressPath}`);
  }

  const projectSection = formatProjectContext(config.project);
  if (projectSection) {
    sections.push(projectSection);
  }

  const rulesSection = formatRules(config.rules);
  if (rulesSection) {
    sections.push(rulesSection);
  }

  const boundariesSection = formatBoundaries(config.boundaries);
  if (boundariesSection) {
    sections.push(boundariesSection);
  }

  sections.push(`## Task\n${options.task}`);
  sections.push(formatInstructions(progressPath, skipTests, skipLint, autoCommit));

  return `${sections.join("\n\n")}\n`;
};
