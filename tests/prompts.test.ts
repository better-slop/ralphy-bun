import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildSingleTaskPrompt } from "../src/core/prompts";

let workingDir = "";

const writeConfig = async (cwd: string, config: string) => {
  const ralphyDir = join(cwd, ".ralphy");
  await Bun.write(join(ralphyDir, "config.yaml"), config);
};

const writeProgress = async (cwd: string) => {
  const ralphyDir = join(cwd, ".ralphy");
  await Bun.write(join(ralphyDir, "progress.txt"), "# Ralphy Progress Log\n\n");
};

beforeEach(async () => {
  workingDir = await mkdtemp(join(tmpdir(), "ralphy-prompts-"));
  await Bun.write(join(workingDir, ".ralphy", ".keep"), "");
});

afterEach(async () => {
  if (workingDir) {
    await rm(workingDir, { recursive: true, force: true });
  }
});

test("builds prompt with config context and rules", async () => {
  const config = `project:\n  name: "Demo"\n  language: "TypeScript"\n  framework: "React"\n  description: "Ship it"\n\nrules:\n  - "Keep it tight"\n  - "No fluff"\n\nboundaries:\n  never_touch:\n    - "src/legacy/**"\n    - "README.md"\n`;

  await writeConfig(workingDir, config);
  await writeProgress(workingDir);

  const prompt = await buildSingleTaskPrompt({
    task: "Ship the feature",
    cwd: workingDir,
  });

  expect(prompt).toContain(`@${join(workingDir, ".ralphy", "progress.txt")}`);
  expect(prompt).toContain("## Project Context");
  expect(prompt).toContain("Project: Demo");
  expect(prompt).toContain("Language: TypeScript");
  expect(prompt).toContain("Framework: React");
  expect(prompt).toContain("Description: Ship it");
  expect(prompt).toContain("## Rules (you MUST follow these)");
  expect(prompt).toContain("Keep it tight");
  expect(prompt).toContain("No fluff");
  expect(prompt).toContain("## Boundaries");
  expect(prompt).toContain("Do NOT modify these files/directories:");
  expect(prompt).toContain("src/legacy/**");
  expect(prompt).toContain("README.md");
  expect(prompt).toContain("## Task\nShip the feature");
  expect(prompt).toContain("Write tests for the feature.");
  expect(prompt).toContain("Run tests and ensure they pass before proceeding.");
  expect(prompt).toContain("Run linting and ensure it passes before proceeding.");
  expect(prompt).toContain("Commit your changes with a descriptive message.");
  expect(prompt).toContain("ONLY WORK ON A SINGLE TASK.");
  expect(prompt).toContain("If ALL tasks in the PRD are complete, output <promise>COMPLETE</promise>.");
});

test("builds deterministic prompt snapshot", async () => {
  const config = `project:\n  name: Demo\n  language: TypeScript\n\nrules:\n  - "Ship fast"\n\nboundaries:\n  never_touch:\n    - "docs/**"\n`;

  await writeConfig(workingDir, config);
  await writeProgress(workingDir);

  const prompt = await buildSingleTaskPrompt({
    task: "Snapshot this",
    cwd: workingDir,
  });

  const normalized = prompt.replaceAll(workingDir, "<cwd>");
  expect(normalized).toMatchSnapshot();
});

test("builds prd prompt with default context", async () => {
  const prompt = await buildSingleTaskPrompt({
    task: "Ship it",
    cwd: workingDir,
    promptMode: "prd",
  });

  expect(prompt).toContain("@PRD.md");
  expect(prompt).toContain("@.ralphy/progress.txt");
  expect(prompt).toContain("Find the highest-priority incomplete task and implement it.");
  expect(prompt).toContain(
    "Update the PRD to mark the task as complete (change '- [ ]' to '- [x]').",
  );
  expect(prompt).toContain("Commit your changes with a descriptive message.");
  expect(prompt).toContain("ONLY WORK ON A SINGLE TASK.");
});

test("omits test, lint, and commit steps when disabled", async () => {
  await writeConfig(workingDir, "project:\n  name: Demo\n");
  await writeProgress(workingDir);

  const progressPath = join(workingDir, ".ralphy", "progress.txt");
  const prompt = await buildSingleTaskPrompt({
    task: "Quick pass",
    cwd: workingDir,
    skipTests: true,
    skipLint: true,
    autoCommit: false,
  });

  expect(prompt).toContain("1. Implement the task described above");
  expect(prompt).toContain(`2. Append your progress to ${progressPath}.`);
  expect(prompt).not.toContain("Write tests for the feature.");
  expect(prompt).not.toContain("Run tests and ensure they pass before proceeding.");
  expect(prompt).not.toContain("Run linting and ensure it passes before proceeding.");
  expect(prompt).not.toContain("Commit your changes with a descriptive message.");
  expect(prompt).not.toContain("Do not proceed if tests fail.");
  expect(prompt).not.toContain("Do not proceed if linting fails.");
});
