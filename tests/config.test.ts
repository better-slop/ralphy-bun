import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { addConfigRule, initRalphyConfig, readRalphyConfig } from "../src/core/config";

let workingDir = "";

const readFile = async (path: string) => {
  const file = Bun.file(path);
  return (await file.exists()) ? file.text() : "";
};

beforeEach(async () => {
  workingDir = await mkdtemp(join(tmpdir(), "ralphy-config-"));
});

afterEach(async () => {
  if (workingDir) {
    await rm(workingDir, { recursive: true, force: true });
  }
});

test("creates config and progress files for new project", async () => {
  const packageJson = {
    name: "demo-project",
    dependencies: {
      react: "18.0.0",
    },
    scripts: {
      test: "bun test",
      lint: "bun run lint",
      build: "bun run build",
    },
  };

  await Bun.write(join(workingDir, "package.json"), JSON.stringify(packageJson));
  await Bun.write(join(workingDir, "tsconfig.json"), "{}");
  await Bun.write(join(workingDir, "bun.lockb"), "");

  const result = await initRalphyConfig({ cwd: workingDir });
  const configPath = join(workingDir, ".ralphy", "config.yaml");
  const progressPath = join(workingDir, ".ralphy", "progress.txt");

  expect(result.status).toBe("created");
  expect(result.paths.configPath).toBe(configPath);
  expect(result.paths.progressPath).toBe(progressPath);

  const configContents = await readFile(configPath);
  const progressContents = await readFile(progressPath);

  expect(configContents).toContain('name: "demo-project"');
  expect(configContents).toContain('language: "TypeScript"');
  expect(configContents).toContain('framework: "React"');
  expect(configContents).toContain('test: "bun test"');
  expect(configContents).toContain('lint: "npm run lint"');
  expect(configContents).toContain('build: "npm run build"');
  expect(progressContents).toBe("# Ralphy Progress Log\n\n");
});

test("returns exists when overwrite is declined", async () => {
  const ralphyDir = join(workingDir, ".ralphy");
  await Bun.write(join(workingDir, "package.json"), JSON.stringify({ name: "demo" }));
  await mkdir(ralphyDir, { recursive: true });
  await Bun.write(join(ralphyDir, "config.yaml"), "keep me");

  const result = await initRalphyConfig({
    cwd: workingDir,
    confirmOverwrite: async () => false,
  });

  expect(result.status).toBe("exists");
  const configContents = await readFile(join(ralphyDir, "config.yaml"));
  expect(configContents).toBe("keep me");
});

test("overwrites config when confirmed", async () => {
  const ralphyDir = join(workingDir, ".ralphy");
  await Bun.write(join(workingDir, "package.json"), JSON.stringify({ name: "demo" }));
  await mkdir(ralphyDir, { recursive: true });
  await Bun.write(join(ralphyDir, "config.yaml"), "old");

  const result = await initRalphyConfig({
    cwd: workingDir,
    confirmOverwrite: async () => true,
  });

  expect(result.status).toBe("overwritten");
  const configContents = await readFile(join(ralphyDir, "config.yaml"));
  expect(configContents).toContain("# Ralphy Configuration");
});

test("reads config file contents", async () => {
  await Bun.write(join(workingDir, "package.json"), JSON.stringify({ name: "demo" }));
  await initRalphyConfig({ cwd: workingDir });

  const result = await readRalphyConfig(workingDir);

  expect(result.status).toBe("loaded");
  expect(result.contents).toContain("# Ralphy Configuration");
});

test("returns missing when config file is absent", async () => {
  const result = await readRalphyConfig(workingDir);

  expect(result.status).toBe("missing");
  expect(result.contents).toBeUndefined();
});

test("adds config rules and avoids duplicates", async () => {
  await Bun.write(join(workingDir, "package.json"), JSON.stringify({ name: "demo" }));
  await initRalphyConfig({ cwd: workingDir });

  const first = await addConfigRule("Keep it tight", workingDir);
  const second = await addConfigRule("Keep it tight", workingDir);

  expect(first.status).toBe("added");
  expect(first.contents).toContain('- "Keep it tight"');
  expect(second.status).toBe("exists");
});

test("returns missing when rules cannot be updated", async () => {
  const ralphyDir = join(workingDir, ".ralphy");
  await mkdir(ralphyDir, { recursive: true });
  await Bun.write(join(ralphyDir, "config.yaml"), "project:\n  name: demo\n");

  const result = await addConfigRule("New rule", workingDir);

  expect(result.status).toBe("missing");
});
