import { packageVersion } from "../shared/version";
import type { ErrorResponse, HealthResponse, VersionResponse } from "../shared/types";

type ServerOptions = {
  port?: number;
  hostname?: string;
};

const jsonResponse = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });

const handleRequest = (request: Request) => {
  const { pathname } = new URL(request.url);

  if (request.method === "GET" && pathname === "/v1/health") {
    const payload: HealthResponse = { status: "ok", version: packageVersion };
    return jsonResponse(payload);
  }

  if (request.method === "GET" && pathname === "/v1/version") {
    const payload: VersionResponse = { version: packageVersion };
    return jsonResponse(payload);
  }

  const payload: ErrorResponse = { error: "Not Found" };
  return jsonResponse(payload, 404);
};

export const createServer = (options: ServerOptions = {}) =>
  Bun.serve({
    port: options.port,
    hostname: options.hostname,
    fetch: handleRequest,
  });
