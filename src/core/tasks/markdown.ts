export type MarkdownTask = {
  text: string;
  completed: boolean;
  line: number;
  raw: string;
};

export type MarkdownTaskCompletionStatus = "updated" | "not-found" | "already-complete";

export type MarkdownTaskCompletionResult = {
  status: MarkdownTaskCompletionStatus;
  taskText: string;
  updated: string;
};

const taskLinePattern = /^([\t ]*[-*][\t ]+)\[([ xX])\][\t ]+(.*)$/;

const normalizeTaskText = (value: string) => value.trim();

export const parseMarkdownTasks = (contents: string): MarkdownTask[] => {
  const lines = contents.split(/\r?\n/);
  const tasks: MarkdownTask[] = [];

  lines.forEach((line, index) => {
    const match = line.match(taskLinePattern);
    if (!match) {
      return;
    }

    const status = match[2] ?? " ";
    const text = match[3] ?? "";

    tasks.push({
      text: normalizeTaskText(text),
      completed: status.toLowerCase() === "x",
      line: index + 1,
      raw: line,
    });
  });

  return tasks;
};

export const completeMarkdownTask = (
  contents: string,
  taskText: string,
): MarkdownTaskCompletionResult => {
  const normalizedTarget = normalizeTaskText(taskText);
  const lines = contents.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const match = line.match(taskLinePattern);
    if (!match) {
      continue;
    }

    const text = match[3] ?? "";
    if (normalizeTaskText(text) !== normalizedTarget) {
      continue;
    }

    const status = match[2] ?? " ";
    if (status.toLowerCase() === "x") {
      return { status: "already-complete", taskText, updated: contents };
    }

    const prefix = match[1] ?? "- ";
    lines[index] = `${prefix}[x] ${text}`;

    return { status: "updated", taskText, updated: lines.join("\n") };
  }

  return { status: "not-found", taskText, updated: contents };
};
