import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "../src/server";
import { packageVersion } from "../src/shared/version";

type ServerHandle = {
  server: ReturnType<typeof createServer>;
  baseUrl: string;
};

type ServerOptions = NonNullable<Parameters<typeof createServer>[0]>;

let workingDir = "";

beforeEach(async () => {
  workingDir = await mkdtemp(join(tmpdir(), "ralphy-server-"));
});

afterEach(async () => {
  if (workingDir) {
    await rm(workingDir, { recursive: true, force: true });
  }
});

const startServer = (
  options: {
    runSingleTask?: ServerOptions["runSingleTask"];
    runPrd?: ServerOptions["runPrd"];
  } = {},
): ServerHandle => {
  const server = createServer({
    hostname: "127.0.0.1",
    port: 0,
    cwd: workingDir,
    runSingleTask: options.runSingleTask,
    runPrd: options.runPrd,
  });
  return {
    server,
    baseUrl: `http://${server.hostname}:${server.port}`,
  };
};

const readJson = async <T>(response: Response) => response.json() as Promise<T>;

const configFilesExist = async () => {
  const configFile = Bun.file(join(workingDir, ".ralphy", "config.yaml"));
  const progressFile = Bun.file(join(workingDir, ".ralphy", "progress.txt"));
  return (await configFile.exists()) && (await progressFile.exists());
};

test("GET /v1/health returns ok with version", async () => {
  const { server, baseUrl } = startServer();

  try {
    const response = await fetch(`${baseUrl}/v1/health`);
    expect(response.status).toBe(200);
    const payload = await readJson(response);
    expect(payload).toEqual({
      status: "ok",
      version: packageVersion,
    });
  } finally {
    await server.stop();
  }
});

test("GET /v1/version returns version", async () => {
  const { server, baseUrl } = startServer();

  try {
    const response = await fetch(`${baseUrl}/v1/version`);
    expect(response.status).toBe(200);
    const payload = await readJson(response);
    expect(payload).toEqual({
      version: packageVersion,
    });
  } finally {
    await server.stop();
  }
});

test("POST /v1/config/init creates config files", async () => {
  const { server, baseUrl } = startServer();

  try {
    const response = await fetch(`${baseUrl}/v1/config/init`, { method: "POST" });
    expect(response.status).toBe(200);
    const payload = await readJson<{ status: string }>(response);
    expect(payload.status).toBe("created");
    expect(await configFilesExist()).toBe(true);
  } finally {
    await server.stop();
  }
});

test("GET /v1/config returns missing when no file", async () => {
  const { server, baseUrl } = startServer();

  try {
    const response = await fetch(`${baseUrl}/v1/config`);
    expect(response.status).toBe(200);
    const payload = await readJson<{ status: string }>(response);
    expect(payload.status).toBe("missing");
  } finally {
    await server.stop();
  }
});

test("POST /v1/config/rules validates payload", async () => {
  const { server, baseUrl } = startServer();

  try {
    const response = await fetch(`${baseUrl}/v1/config/rules`, { method: "POST" });
    expect(response.status).toBe(400);
    const payload = await readJson<{ error: string }>(response);
    expect(payload).toEqual({ error: "Invalid request" });
  } finally {
    await server.stop();
  }
});

test("POST /v1/config/rules adds rule", async () => {
  const { server, baseUrl } = startServer();

  try {
    await fetch(`${baseUrl}/v1/config/init`, { method: "POST" });
    const response = await fetch(`${baseUrl}/v1/config/rules`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rule: "Keep it tight" }),
    });

    expect(response.status).toBe(200);
    const payload = await readJson<{ status: string; contents?: string }>(response);
    expect(payload.status).toBe("added");
    expect(payload.contents).toContain("Keep it tight");
  } finally {
    await server.stop();
  }
});

test("GET /v1/tasks/next returns next markdown task", async () => {
  const { server, baseUrl } = startServer();
  const prdPath = join(workingDir, "PRD.md");
  await Bun.write(prdPath, "- [ ] First task\n- [x] Done task\n");

  try {
    const response = await fetch(`${baseUrl}/v1/tasks/next?prd=PRD.md`);
    expect(response.status).toBe(200);
    const payload = await readJson(response);
    expect(payload).toEqual({
      status: "ok",
      task: { source: "markdown", text: "First task", line: 1 },
    });
  } finally {
    await server.stop();
  }
});

test("POST /v1/run/single executes single task", async () => {
  const runSingleTask: ServerOptions["runSingleTask"] = async (request) => ({
    status: "ok",
    engine: request.engine ?? "claude",
    attempts: 1,
    response: `Done: ${request.task}`,
    usage: { inputTokens: 1, outputTokens: 2 },
    stdout: "ok",
    stderr: "",
    exitCode: 0,
  });
  const { server, baseUrl } = startServer({ runSingleTask });

  try {
    const response = await fetch(`${baseUrl}/v1/run/single`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ task: "Ship it", engine: "opencode" }),
    });
    expect(response.status).toBe(200);
    const payload = await readJson(response);
    expect(payload).toEqual({
      status: "ok",
      engine: "opencode",
      attempts: 1,
      response: "Done: Ship it",
      usage: { inputTokens: 1, outputTokens: 2 },
      stdout: "ok",
      stderr: "",
      exitCode: 0,
    });
  } finally {
    await server.stop();
  }
});

test("POST /v1/run/prd executes prd flow", async () => {
  const runPrd: ServerOptions["runPrd"] = async (request) => {
    expect(request).toEqual({
      prd: "PRD.md",
      maxIterations: 2,
      maxRetries: 1,
      retryDelay: 3,
      skipTests: true,
      skipLint: true,
      autoCommit: false,
      engine: "opencode",
      cwd: workingDir,
    });
    return {
      status: "ok",
      iterations: 1,
      completed: 1,
      stopped: "no-tasks",
      tasks: [
        {
          task: "Ship it",
          source: "markdown",
          status: "completed",
          attempts: 1,
          response: "Done",
        },
      ],
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  };
  const { server, baseUrl } = startServer({ runPrd });

  try {
    const response = await fetch(`${baseUrl}/v1/run/prd`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prd: "PRD.md",
        maxIterations: 2,
        maxRetries: 1,
        retryDelay: 3,
        skipTests: true,
        skipLint: true,
        autoCommit: false,
        engine: "opencode",
      }),
    });
    expect(response.status).toBe(200);
    const payload = await readJson(response);
    expect(payload).toEqual({
      status: "ok",
      iterations: 1,
      completed: 1,
      stopped: "no-tasks",
      tasks: [
        {
          task: "Ship it",
          source: "markdown",
          status: "completed",
          attempts: 1,
          response: "Done",
        },
      ],
      usage: { inputTokens: 0, outputTokens: 0 },
    });
  } finally {
    await server.stop();
  }
});

test("POST /v1/tasks/complete updates markdown task", async () => {
  const { server, baseUrl } = startServer();
  const prdPath = join(workingDir, "PRD.md");
  await Bun.write(prdPath, "- [ ] First task\n");

  try {
    const response = await fetch(`${baseUrl}/v1/tasks/complete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ task: "First task", prd: "PRD.md" }),
    });
    expect(response.status).toBe(200);
    const payload = await readJson(response);
    expect(payload).toEqual({
      status: "updated",
      source: "markdown",
      task: "First task",
      updated: "- [x] First task\n",
    });
    const updated = await Bun.file(prdPath).text();
    expect(updated).toBe("- [x] First task\n");
  } finally {
    await server.stop();
  }
});

test("unknown routes return 404", async () => {
  const { server, baseUrl } = startServer();

  try {
    const response = await fetch(`${baseUrl}/v1/nope`);
    expect(response.status).toBe(404);
    const payload = await readJson(response);
    expect(payload).toEqual({ error: "Not Found" });
  } finally {
    await server.stop();
  }
});
