import { join } from "node:path";

export type TaskLogStatus = "completed" | "failed";

const formatTimestamp = (value: Date) => {
  const pad = (input: number) => input.toString().padStart(2, "0");
  const year = value.getFullYear();
  const month = pad(value.getMonth() + 1);
  const day = pad(value.getDate());
  const hours = pad(value.getHours());
  const minutes = pad(value.getMinutes());
  return `${year}-${month}-${day} ${hours}:${minutes}`;
};

export const logTaskHistory = async (
  cwd: string,
  task: string,
  status: TaskLogStatus,
): Promise<void> => {
  try {
    const progressPath = join(cwd, ".ralphy", "progress.txt");
    const file = Bun.file(progressPath);
    if (!(await file.exists())) {
      return;
    }
    const icon = status === "failed" ? "✗" : "✓";
    const line = `- [${icon}] ${formatTimestamp(new Date())} - ${task}\n`;
    const current = await file.text();
    await Bun.write(progressPath, `${current}${line}`);
  } catch {
    return;
  }
};
