import { packageVersion } from "../shared/version";
import type {
  ConfigRulesRequest,
  ErrorResponse,
  HealthResponse,
  RunPrdRequest,
  RunSingleRequest,
  TasksCompleteRequest,
  TasksNextQuery,
  TasksNextResponse,
  VersionResponse,
} from "../shared/types";
import { addConfigRule, initRalphyConfig, readRalphyConfig } from "../core/config";
import { runPrd } from "../core/prd";
import { runSingleTask } from "../core/single";
import { completeTask, getNextTask } from "../core/tasks/source";

type ServerOptions = {
  port?: number;
  hostname?: string;
  cwd?: string;
  runSingleTask?: typeof runSingleTask;
  runPrd?: typeof runPrd;
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

const parseTasksQuery = (request: Request): TasksNextQuery => {
  const { searchParams } = new URL(request.url);
  const getValue = (key: string) => {
    const value = searchParams.get(key);
    return value && value.trim().length > 0 ? value : undefined;
  };

  return {
    prd: getValue("prd"),
    yaml: getValue("yaml"),
    github: getValue("github"),
    githubLabel: getValue("githubLabel"),
  };
};

const isConfigRulesRequest = (body: unknown): body is ConfigRulesRequest =>
  Boolean(
    body &&
      typeof body === "object" &&
      "rule" in body &&
      typeof (body as { rule: unknown }).rule === "string",
  );

const isTasksCompleteRequest = (body: unknown): body is TasksCompleteRequest =>
  Boolean(
    body &&
      typeof body === "object" &&
      "task" in body &&
      typeof (body as { task: unknown }).task === "string",
  );

const isRunSingleRequest = (body: unknown): body is RunSingleRequest =>
  Boolean(
    body &&
      typeof body === "object" &&
      "task" in body &&
      typeof (body as { task: unknown }).task === "string",
  );

const isRunPrdRequest = (body: unknown): body is RunPrdRequest =>
  Boolean(body && typeof body === "object");

const createHandler = (
  cwd: string,
  runner: typeof runSingleTask,
  prdRunner: typeof runPrd,
) => async (request: Request) => {
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

  if (request.method === "GET" && pathname === "/v1/tasks/next") {
    const query = parseTasksQuery(request);
    const result = await getNextTask({
      prd: query.prd,
      yaml: query.yaml,
      github: query.github,
      githubLabel: query.githubLabel,
      cwd,
    });
    const payload: TasksNextResponse = result;
    return jsonResponse(payload);
  }

  if (request.method === "POST" && pathname === "/v1/run/single") {
    const body = await readRequestBody(request);
    if (!isRunSingleRequest(body) || body.task.trim().length === 0) {
      const payload: ErrorResponse = { error: "Invalid request" };
      return jsonResponse(payload, 400);
    }

    const result = await runner({ ...body, cwd });
    return jsonResponse(result);
  }

  if (request.method === "POST" && pathname === "/v1/run/prd") {
    const body = await readRequestBody(request);
    if (!isRunPrdRequest(body)) {
      const payload: ErrorResponse = { error: "Invalid request" };
      return jsonResponse(payload, 400);
    }

      const result = await prdRunner({
        prd: body.prd,
        yaml: body.yaml,
        github: body.github,
        githubLabel: body.githubLabel,
        maxIterations: body.maxIterations,
        maxRetries: body.maxRetries,
        retryDelay: body.retryDelay,
        branchPerTask: body.branchPerTask,
        baseBranch: body.baseBranch,
        skipTests: body.skipTests,
        skipLint: body.skipLint,
        autoCommit: body.autoCommit,
        engine: body.engine,
        cwd,
      });
    return jsonResponse(result);
  }

  if (request.method === "POST" && pathname === "/v1/tasks/complete") {
    const body = await readRequestBody(request);
    if (!isTasksCompleteRequest(body) || body.task.trim().length === 0) {
      const payload: ErrorResponse = { error: "Invalid request" };
      return jsonResponse(payload, 400);
    }

    const result = await completeTask(body.task, {
      prd: body.prd,
      yaml: body.yaml,
      github: body.github,
      githubLabel: body.githubLabel,
      cwd,
    });
    return jsonResponse(result);
  }

  const payload: ErrorResponse = { error: "Not Found" };
  return jsonResponse(payload, 404);
};

export const createServer = (options: ServerOptions = {}) => {
  const cwd = options.cwd ?? process.cwd();
  const runner = options.runSingleTask ?? runSingleTask;
  const prdRunner = options.runPrd ?? runPrd;

  return Bun.serve({
    port: options.port,
    hostname: options.hostname,
    fetch: createHandler(cwd, runner, prdRunner),
  });
};
