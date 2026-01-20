import { expect, test } from "bun:test";
import { parseArgs, runCli } from "../src/cli";

test("parses core flags", () => {
  const parsed = parseArgs([
    "--init",
    "--config",
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
    "--fast",
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

  expect(parsed.init).toBe(true);
  expect(parsed.config).toBe(true);
  expect(parsed.dryRun).toBe(true);
  expect(parsed.maxIterations).toBe(3);
  expect(parsed.maxRetries).toBe(2);
  expect(parsed.retryDelay).toBe(5);
  expect(parsed.addRule).toBe("Keep it tight");
  expect(parsed.skipTests).toBe(true);
  expect(parsed.skipLint).toBe(true);
  expect(parsed.fast).toBe(true);
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

type FetchCall = {
  url: string;
  init?: RequestInit;
};

type FetchResponse = {
  status?: number;
  body?: unknown;
};

type Fetcher = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

const createFakeFetch = (responses: Record<string, FetchResponse>) => {
  const calls: FetchCall[] = [];
  const fetcher: Fetcher = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    calls.push({ url, init });
    const response = responses[url] ?? responses["*"] ?? {};
    const status = response.status ?? 200;
    const body = response.body ?? { ok: true };
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  };

  return { fetcher, calls };
};

const createFakeServer = () => {
  const stopCalls: string[] = [];
  const server = {
    hostname: "127.0.0.1",
    port: 4321,
    stop: async () => {
      stopCalls.push("stop");
    },
  };
  return { server, stopCalls };
};

test("dispatches dry-run to prd endpoint", async () => {
  const { server, stopCalls } = createFakeServer();
  const baseUrl = `http://${server.hostname}:${server.port}`;
  const { fetcher, calls } = createFakeFetch({
    [`${baseUrl}/v1/health`]: { body: { status: "ok" } },
    [`${baseUrl}/v1/run/prd`]: { body: { result: "dry-run" } },
  });

  const result = await runCli(["--dry-run"], {
    createServer: () => server,
    fetcher,
  });

  expect(result).not.toBeNull();
  expect(calls).toHaveLength(2);
  expect(calls[0]?.url).toBe(`${baseUrl}/v1/health`);
  expect(calls[1]?.url).toBe(`${baseUrl}/v1/run/prd`);
  expect(calls[1]?.init?.method).toBe("POST");
  expect(calls[1]?.init?.body).toBe(
    JSON.stringify({ prd: "PRD.md", dryRun: true, autoCommit: true }),
  );
  expect(stopCalls).toHaveLength(1);
});

test("dispatches positional tasks to single-run endpoint", async () => {
  const { server, stopCalls } = createFakeServer();
  const baseUrl = `http://${server.hostname}:${server.port}`;
  const { fetcher, calls } = createFakeFetch({
    [`${baseUrl}/v1/health`]: { body: { status: "ok" } },
    [`${baseUrl}/v1/run/single`]: { body: { result: "done" } },
  });

  const result = await runCli(["ship", "it"], {
    createServer: () => server,
    fetcher,
  });

  expect(result).not.toBeNull();
  expect(result?.payload).toEqual({ result: "done" });
  expect(calls).toHaveLength(2);
  expect(calls[0]?.url).toBe(`${baseUrl}/v1/health`);
  expect(calls[1]?.url).toBe(`${baseUrl}/v1/run/single`);
  expect(calls[1]?.init?.method).toBe("POST");
  expect(calls[1]?.init?.body).toBe(JSON.stringify({ task: "ship it", autoCommit: true }));
  expect(stopCalls).toHaveLength(1);
});

test("dispatches dry-run task to single-run endpoint", async () => {
  const { server, stopCalls } = createFakeServer();
  const baseUrl = `http://${server.hostname}:${server.port}`;
  const { fetcher, calls } = createFakeFetch({
    [`${baseUrl}/v1/health`]: { body: { status: "ok" } },
    [`${baseUrl}/v1/run/single`]: { body: { result: "prompt" } },
  });

  const result = await runCli(["ship", "it", "--dry-run"], {
    createServer: () => server,
    fetcher,
  });

  expect(result).not.toBeNull();
  expect(calls).toHaveLength(2);
  expect(calls[0]?.url).toBe(`${baseUrl}/v1/health`);
  expect(calls[1]?.url).toBe(`${baseUrl}/v1/run/single`);
  expect(calls[1]?.init?.method).toBe("POST");
  expect(calls[1]?.init?.body).toBe(
    JSON.stringify({ task: "ship it", dryRun: true, autoCommit: true }),
  );
  expect(stopCalls).toHaveLength(1);
});

test("dispatches prd run when no task is provided", async () => {
  const { server, stopCalls } = createFakeServer();
  const baseUrl = `http://${server.hostname}:${server.port}`;
  const { fetcher, calls } = createFakeFetch({
    [`${baseUrl}/v1/health`]: { body: { status: "ok" } },
    [`${baseUrl}/v1/run/prd`]: { body: { result: "queued" } },
  });

  const result = await runCli(["--prd", "PRD.md", "--yaml", "tasks.yaml"], {
    createServer: () => server,
    fetcher,
  });

  expect(result).not.toBeNull();
  expect(result?.payload).toEqual({ result: "queued" });
  expect(calls).toHaveLength(2);
  expect(calls[0]?.url).toBe(`${baseUrl}/v1/health`);
  expect(calls[1]?.url).toBe(`${baseUrl}/v1/run/prd`);
  expect(calls[1]?.init?.method).toBe("POST");
  expect(calls[1]?.init?.body).toBe(
    JSON.stringify({ prd: "PRD.md", yaml: "tasks.yaml", autoCommit: true }),
  );
  expect(stopCalls).toHaveLength(1);
});

test("dispatches default prd when no args", async () => {
  const { server, stopCalls } = createFakeServer();
  const baseUrl = `http://${server.hostname}:${server.port}`;
  const { fetcher, calls } = createFakeFetch({
    [`${baseUrl}/v1/health`]: { body: { status: "ok" } },
    [`${baseUrl}/v1/run/prd`]: { body: { result: "queued" } },
  });

  const result = await runCli([], {
    createServer: () => server,
    fetcher,
  });

  expect(result).not.toBeNull();
  expect(calls).toHaveLength(2);
  expect(calls[0]?.url).toBe(`${baseUrl}/v1/health`);
  expect(calls[1]?.url).toBe(`${baseUrl}/v1/run/prd`);
  expect(calls[1]?.init?.method).toBe("POST");
  expect(calls[1]?.init?.body).toBe(JSON.stringify({ prd: "PRD.md", autoCommit: true }));
  expect(stopCalls).toHaveLength(1);
});

test("dispatches fast flags for single runs", async () => {
  const { server, stopCalls } = createFakeServer();
  const baseUrl = `http://${server.hostname}:${server.port}`;
  const { fetcher, calls } = createFakeFetch({
    [`${baseUrl}/v1/health`]: { body: { status: "ok" } },
    [`${baseUrl}/v1/run/single`]: { body: { result: "done" } },
  });

  const result = await runCli(["ship", "it", "--fast"], {
    createServer: () => server,
    fetcher,
  });

  expect(result).not.toBeNull();
  expect(calls).toHaveLength(2);
  expect(calls[1]?.url).toBe(`${baseUrl}/v1/run/single`);
  expect(calls[1]?.init?.body).toBe(
    JSON.stringify({ task: "ship it", skipTests: true, skipLint: true, autoCommit: true }),
  );
  expect(stopCalls).toHaveLength(1);
});

test("dispatches fast flags for prd runs", async () => {
  const { server, stopCalls } = createFakeServer();
  const baseUrl = `http://${server.hostname}:${server.port}`;
  const { fetcher, calls } = createFakeFetch({
    [`${baseUrl}/v1/health`]: { body: { status: "ok" } },
    [`${baseUrl}/v1/run/prd`]: { body: { result: "queued" } },
  });

  const result = await runCli(["--fast"], {
    createServer: () => server,
    fetcher,
  });

  expect(result).not.toBeNull();
  expect(calls).toHaveLength(2);
  expect(calls[1]?.url).toBe(`${baseUrl}/v1/run/prd`);
  expect(calls[1]?.init?.body).toBe(
    JSON.stringify({ prd: "PRD.md", skipTests: true, skipLint: true, autoCommit: true }),
  );
  expect(stopCalls).toHaveLength(1);
});

test("dispatches init to config init endpoint", async () => {
  const { server, stopCalls } = createFakeServer();
  const baseUrl = `http://${server.hostname}:${server.port}`;
  const { fetcher, calls } = createFakeFetch({
    [`${baseUrl}/v1/config/init`]: { body: { status: "created" } },
  });

  const result = await runCli(["--init"], {
    createServer: () => server,
    fetcher,
  });

  expect(result).not.toBeNull();
  expect(result?.payload).toEqual({ status: "created" });
  expect(calls).toHaveLength(2);
  expect(calls[0]?.url).toBe(`${baseUrl}/v1/health`);
  expect(calls[1]?.url).toBe(`${baseUrl}/v1/config/init`);
  expect(calls[1]?.init?.method).toBe("POST");
  expect(stopCalls).toHaveLength(1);
});

test("dispatches config to config endpoint", async () => {
  const { server, stopCalls } = createFakeServer();
  const baseUrl = `http://${server.hostname}:${server.port}`;
  const { fetcher, calls } = createFakeFetch({
    [`${baseUrl}/v1/health`]: { body: { status: "ok" } },
    [`${baseUrl}/v1/config`]: { body: { status: "loaded" } },
  });

  const result = await runCli(["--config"], {
    createServer: () => server,
    fetcher,
  });

  expect(result).not.toBeNull();
  expect(result?.payload).toEqual({ status: "loaded" });
  expect(calls).toHaveLength(2);
  expect(calls[0]?.url).toBe(`${baseUrl}/v1/health`);
  expect(calls[1]?.url).toBe(`${baseUrl}/v1/config`);
  expect(calls[1]?.init?.method).toBe("GET");
  expect(stopCalls).toHaveLength(1);
});

test("dispatches add-rule to config rules endpoint", async () => {
  const { server, stopCalls } = createFakeServer();
  const baseUrl = `http://${server.hostname}:${server.port}`;
  const { fetcher, calls } = createFakeFetch({
    [`${baseUrl}/v1/health`]: { body: { status: "ok" } },
    [`${baseUrl}/v1/config/rules`]: { body: { status: "added" } },
  });

  const result = await runCli(["--add-rule", "Keep it tight"], {
    createServer: () => server,
    fetcher,
  });

  expect(result).not.toBeNull();
  expect(result?.payload).toEqual({ status: "added" });
  expect(calls).toHaveLength(2);
  expect(calls[0]?.url).toBe(`${baseUrl}/v1/health`);
  expect(calls[1]?.url).toBe(`${baseUrl}/v1/config/rules`);
  expect(calls[1]?.init?.method).toBe("POST");
  expect(calls[1]?.init?.body).toBe(JSON.stringify({ rule: "Keep it tight" }));
  expect(stopCalls).toHaveLength(1);
});
