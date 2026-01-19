import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { packageVersion } from "../src/shared/version";

const cliPath = join(import.meta.dir, "..", "src", "cli.ts");

const runCli = async (args: string[], options: { cwd?: string } = {}) => {
  const process = Bun.spawn(["bun", cliPath, ...args], {
    cwd: options.cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  return { stdout, stderr, exitCode };
};

test("e2e help output", async () => {
  const result = await runCli(["--help"]);

  expect(result.exitCode).toBe(0);
  expect(result.stderr.trim()).toBe("");
  expect(result.stdout).toContain("ralphy [task...");
});

test("e2e version output", async () => {
  const result = await runCli(["--version"]);

  expect(result.exitCode).toBe(0);
  expect(result.stderr.trim()).toBe("");
  expect(result.stdout.trim()).toBe(packageVersion);
});

test("e2e init creates config files", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "ralphy-e2e-"));

  try {
    const result = await runCli(["--init"], { cwd });

    expect(result.exitCode).toBe(0);
    expect(result.stderr.trim()).toBe("");
    const configFile = Bun.file(join(cwd, ".ralphy", "config.yaml"));
    const progressFile = Bun.file(join(cwd, ".ralphy", "progress.txt"));
    expect(await configFile.exists()).toBe(true);
    expect(await progressFile.exists()).toBe(true);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("e2e single-task dry-run", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "ralphy-e2e-"));

  try {
    const result = await runCli(["ship", "it", "--dry-run"], { cwd });

    expect(result.exitCode).toBe(0);
    expect(result.stderr.trim()).toBe("");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("e2e prd dry-run", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "ralphy-e2e-"));

  try {
    await Bun.write(join(cwd, "PRD.md"), "- [ ] Ship it\n");
    const result = await runCli(["--prd", "PRD.md", "--max-iterations", "1", "--dry-run"], {
      cwd,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr.trim()).toBe("");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
