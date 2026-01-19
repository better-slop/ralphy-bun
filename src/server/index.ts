import { packageVersion } from "../shared/version";
import type { ConfigRulesRequest, ErrorResponse, HealthResponse, VersionResponse } from "../shared/types";
import { addConfigRule, initRalphyConfig, readRalphyConfig } from "../core/config";

type ServerOptions = {
  port?: number;
  hostname?: string;
  cwd?: string;
};

const jsonResponse = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });

const readRequestBody = async (request: Request) => {
  try {
    const body: unknown = await request.json();
    return body;
  } catch {
    return null;
  }
};

const isConfigRulesRequest = (body: unknown): body is ConfigRulesRequest =>
  Boolean(
    body &&
      typeof body === "object" &&
      "rule" in body &&
      typeof (body as { rule: unknown }).rule === "string",
  );

const createHandler = (cwd: string) => async (request: Request) => {
  const { pathname } = new URL(request.url);

  if (request.method === "GET" && pathname === "/v1/health") {
    const payload: HealthResponse = { status: "ok", version: packageVersion };
    return jsonResponse(payload);
  }

  if (request.method === "GET" && pathname === "/v1/version") {
    const payload: VersionResponse = { version: packageVersion };
    return jsonResponse(payload);
  }

  if (request.method === "POST" && pathname === "/v1/config/init") {
    const result = await initRalphyConfig({ cwd });
    return jsonResponse(result);
  }

  if (request.method === "GET" && pathname === "/v1/config") {
    const result = await readRalphyConfig(cwd);
    return jsonResponse(result);
  }

  if (request.method === "POST" && pathname === "/v1/config/rules") {
    const body = await readRequestBody(request);
    if (!isConfigRulesRequest(body) || body.rule.trim().length === 0) {
      const payload: ErrorResponse = { error: "Invalid request" };
      return jsonResponse(payload, 400);
    }

    const result = await addConfigRule(body.rule, cwd);
    return jsonResponse(result);
  }

  const payload: ErrorResponse = { error: "Not Found" };
  return jsonResponse(payload, 404);
};

export const createServer = (options: ServerOptions = {}) => {
  const cwd = options.cwd ?? process.cwd();

  return Bun.serve({
    port: options.port,
    hostname: options.hostname,
    fetch: createHandler(cwd),
  });
};
