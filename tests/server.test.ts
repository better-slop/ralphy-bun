import { test, expect } from "bun:test";
import { createServer } from "../src/server";
import { packageVersion } from "../src/shared/version";

type ServerHandle = {
  server: ReturnType<typeof createServer>;
  baseUrl: string;
};

const startServer = (): ServerHandle => {
  const server = createServer({ hostname: "127.0.0.1", port: 0 });
  return {
    server,
    baseUrl: `http://${server.hostname}:${server.port}`,
  };
};

test("GET /v1/health returns ok with version", async () => {
  const { server, baseUrl } = startServer();

  try {
    const response = await fetch(`${baseUrl}/v1/health`);
    expect(response.status).toBe(200);
    const payload = await response.json();
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
    const payload = await response.json();
    expect(payload).toEqual({
      version: packageVersion,
    });
  } finally {
    await server.stop();
  }
});

test("unknown routes return 404", async () => {
  const { server, baseUrl } = startServer();

  try {
    const response = await fetch(`${baseUrl}/v1/nope`);
    expect(response.status).toBe(404);
    const payload = await response.json();
    expect(payload).toEqual({ error: "Not Found" });
  } finally {
    await server.stop();
  }
});
