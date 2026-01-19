import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { checkPrdRequirements } from "../src/core/prd";

const createWorkspace = async () => mkdtemp(join(tmpdir(), "ralphy-prd-"));

const writeJson = async (path: string, value: unknown) => {
  await Bun.write(path, JSON.stringify(value));
};

const hasFailure = (failures: { requirement: string }[], requirement: string) =>
  failures.some((failure) => failure.requirement === requirement);

test("fails when git directory is missing", async () => {
  const cwd = await createWorkspace();

  try {
    const result = await checkPrdRequirements({ cwd });
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(hasFailure(result.failures, "git")).toBe(true);
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("fails when task source is missing", async () => {
  const cwd = await createWorkspace();

  try {
    await mkdir(join(cwd, ".git"), { recursive: true });
    const result = await checkPrdRequirements({ cwd });
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(hasFailure(result.failures, "task-source")).toBe(true);
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("skips task source check for github mode", async () => {
  const cwd = await createWorkspace();

  try {
    await mkdir(join(cwd, ".git"), { recursive: true });
    const result = await checkPrdRequirements({ cwd, github: "org/repo" });
    expect(result).toEqual({ status: "ok" });
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("fails when dependencies are missing", async () => {
  const cwd = await createWorkspace();

  try {
    await mkdir(join(cwd, ".git"), { recursive: true });
    await Bun.write(join(cwd, "PRD.md"), "- [ ] Task");
    await writeJson(join(cwd, "package.json"), { dependencies: { react: "1.0.0" } });
    const result = await checkPrdRequirements({ cwd });
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(hasFailure(result.failures, "dependencies")).toBe(true);
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("passes when requirements are met", async () => {
  const cwd = await createWorkspace();

  try {
    await mkdir(join(cwd, ".git"), { recursive: true });
    await mkdir(join(cwd, "node_modules"), { recursive: true });
    await Bun.write(join(cwd, "PRD.md"), "- [ ] Task");
    await writeJson(join(cwd, "package.json"), { dependencies: { react: "1.0.0" } });
    const result = await checkPrdRequirements({ cwd });
    expect(result).toEqual({ status: "ok" });
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
