import { expect, test } from "bun:test";
import { parseArgs } from "../src/cli";

test("parses core flags", () => {
  const parsed = parseArgs([
    "--dry-run",
    "--max-iterations",
    "3",
    "--max-retries",
    "2",
    "--retry-delay",
    "5",
    "--add-rule",
    "Keep it tight",
    "--skip-tests",
    "--skip-lint",
    "--cursor",
    "--parallel",
    "--max-parallel",
    "4",
    "--branch-per-task",
    "--base-branch",
    "main",
    "--create-pr",
    "--draft-pr",
    "--no-commit",
    "--prd",
    "PRD.md",
    "--yaml",
    "tasks.yaml",
    "--github",
    "org/repo",
    "--github-label",
    "ai",
    "--verbose",
  ]);

  expect(parsed.dryRun).toBe(true);
  expect(parsed.maxIterations).toBe(3);
  expect(parsed.maxRetries).toBe(2);
  expect(parsed.retryDelay).toBe(5);
  expect(parsed.addRule).toBe("Keep it tight");
  expect(parsed.skipTests).toBe(true);
  expect(parsed.skipLint).toBe(true);
  expect(parsed.cursor).toBe(true);
  expect(parsed.parallel).toBe(true);
  expect(parsed.maxParallel).toBe(4);
  expect(parsed.branchPerTask).toBe(true);
  expect(parsed.baseBranch).toBe("main");
  expect(parsed.createPr).toBe(true);
  expect(parsed.draftPr).toBe(true);
  expect(parsed.commit).toBe(false);
  expect(parsed.prd).toBe("PRD.md");
  expect(parsed.yaml).toBe("tasks.yaml");
  expect(parsed.github).toBe("org/repo");
  expect(parsed.githubLabel).toBe("ai");
  expect(parsed.verbose).toBe(true);
});

test("captures positional task text", () => {
  const parsed = parseArgs(["ship", "it"]);

  expect(parsed.task).toEqual(["ship", "it"]);
});

test("keeps -v alias for verbose", () => {
  const parsed = parseArgs(["-v"]);

  expect(parsed.verbose).toBe(true);
  expect(parsed.v).toBe(true);
});

test("allows version output without throwing", () => {
  expect(() => parseArgs(["--version"])).not.toThrow();
});

test("allows help output without throwing", () => {
  expect(() => parseArgs(["--help"])).not.toThrow();
});
