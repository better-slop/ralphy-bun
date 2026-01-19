export type YamlTask = {
  title: string;
  completed: boolean;
  parallelGroup: number;
  line: number;
  raw: string;
};

export type YamlTaskCompletionStatus = "updated" | "not-found" | "already-complete";

export type YamlTaskCompletionResult = {
  status: YamlTaskCompletionStatus;
  taskTitle: string;
  updated: string;
};

type TaskBlock = {
  startIndex: number;
  lines: string[];
  itemIndent: string;
};

type ParsedBlock = {
  title: string;
  completed: boolean;
  parallelGroup: number;
  completedLineOffset: number | null;
  titleLineOffset: number | null;
  propertyIndent: string;
};

const normalizeTaskTitle = (value: string) => value.trim();

const parseYamlValue = (value: string) => {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
};

const parseBoolean = (value: string) => parseYamlValue(value).toLowerCase() === "true";

const parseNumber = (value: string) => {
  const parsed = Number.parseInt(parseYamlValue(value), 10);
  return Number.isNaN(parsed) ? 0 : parsed;
};

const tasksHeaderPattern = /^(\s*)tasks:\s*$/;

const extractTaskBlocks = (contents: string): TaskBlock[] => {
  const lines = contents.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => tasksHeaderPattern.test(line));
  if (headerIndex < 0) {
    return [];
  }

  const headerLine = lines[headerIndex] ?? "";
  const indentMatch = headerLine.match(tasksHeaderPattern);
  const tasksIndent = indentMatch?.[1] ?? "";
  const tasksIndentLength = tasksIndent.length;
  const blocks: TaskBlock[] = [];

  let current: TaskBlock | null = null;

  for (let i = headerIndex + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();
    const indentMatchLine = line.match(/^(\s*)/);
    const indentLength = indentMatchLine?.[1]?.length ?? 0;

    if (trimmed.length > 0 && indentLength <= tasksIndentLength) {
      if (current) {
        blocks.push(current);
      }
      break;
    }

    const itemMatch = line.match(/^(\s*)-\s+(.+)?$/);
    if (itemMatch && indentLength > tasksIndentLength) {
      if (current) {
        blocks.push(current);
      }
      current = {
        startIndex: i,
        lines: [line],
        itemIndent: itemMatch[1] ?? "",
      };
      continue;
    }

    if (current) {
      current.lines.push(line);
    }
  }

  if (current) {
    blocks.push(current);
  }

  return blocks;
};

const parseTaskBlock = (block: TaskBlock): ParsedBlock => {
  const { lines, itemIndent } = block;
  let title = "";
  let completed = false;
  let parallelGroup = 0;
  let completedLineOffset: number | null = null;
  let titleLineOffset: number | null = null;
  let propertyIndent = `${itemIndent}  `;

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      return;
    }

    const content =
      index === 0
        ? (line.match(/^\s*-\s*(.*)$/)?.[1] ?? "")
        : line.trimStart();
    const match = content.match(/^([a-zA-Z0-9_]+)\s*:\s*(.*)$/);
    if (!match) {
      return;
    }

    const key = match[1] ?? "";
    const value = match[2] ?? "";

    if (index > 0) {
      propertyIndent = line.match(/^(\s*)/)?.[1] ?? propertyIndent;
    }

    if (key === "title") {
      title = parseYamlValue(value);
      titleLineOffset = index;
      return;
    }

    if (key === "completed") {
      completed = parseBoolean(value);
      completedLineOffset = index;
      return;
    }

    if (key === "parallel_group") {
      parallelGroup = parseNumber(value);
    }
  });

  return {
    title,
    completed,
    parallelGroup,
    completedLineOffset,
    titleLineOffset,
    propertyIndent,
  };
};

export const parseYamlTasks = (contents: string): YamlTask[] => {
  const blocks = extractTaskBlocks(contents);

  return blocks
    .map((block) => {
      const parsed = parseTaskBlock(block);
      return {
        title: normalizeTaskTitle(parsed.title),
        completed: parsed.completed,
        parallelGroup: parsed.parallelGroup,
        line: block.startIndex + 1,
        raw: block.lines[0] ?? "",
      };
    })
    .filter((task) => task.title.length > 0);
};

export const completeYamlTask = (contents: string, taskTitle: string): YamlTaskCompletionResult => {
  const normalizedTarget = normalizeTaskTitle(taskTitle);
  const lines = contents.split(/\r?\n/);
  const blocks = extractTaskBlocks(contents);

  for (const block of blocks) {
    const parsed = parseTaskBlock(block);
    if (normalizeTaskTitle(parsed.title) !== normalizedTarget) {
      continue;
    }

    if (parsed.completed) {
      return { status: "already-complete", taskTitle, updated: contents };
    }

    if (parsed.completedLineOffset !== null) {
      const lineIndex = block.startIndex + parsed.completedLineOffset;
      const currentLine = lines[lineIndex] ?? "";
      const match = currentLine.match(/^(\s*completed\s*:\s*)([^#]*)(.*)$/);
      if (match) {
        lines[lineIndex] = `${match[1]}true${match[3] ?? ""}`;
      } else {
        lines[lineIndex] = `${parsed.propertyIndent}completed: true`;
      }

      return { status: "updated", taskTitle, updated: lines.join("\n") };
    }

    const insertAfter = parsed.titleLineOffset ?? 0;
    const insertIndex = block.startIndex + insertAfter + 1;
    lines.splice(insertIndex, 0, `${parsed.propertyIndent}completed: true`);

    return { status: "updated", taskTitle, updated: lines.join("\n") };
  }

  return { status: "not-found", taskTitle, updated: contents };
};
