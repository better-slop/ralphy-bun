import { packageVersion } from "../shared/version";

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
    return jsonResponse({ status: "ok", version: packageVersion });
  }

  if (request.method === "GET" && pathname === "/v1/version") {
    return jsonResponse({ version: packageVersion });
  }

  return jsonResponse({ error: "Not Found" }, 404);
};

export const createServer = (options: ServerOptions = {}) =>
  Bun.serve({
    port: options.port,
    hostname: options.hostname,
    fetch: handleRequest,
  });
