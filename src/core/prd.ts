import { join } from "node:path";
import { stat } from "node:fs/promises";
import type {
  PrdRequirement,
  PrdRequirementFailure,
  PrdRequirementsResult,
  RunPrdRequest,
  RunPrdResponse,
} from "../shared/types";

const pathExists = async (path: string) => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

const hasDependencies = (payload: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }) =>
  Object.keys(payload.dependencies ?? {}).length > 0 ||
  Object.keys(payload.devDependencies ?? {}).length > 0;

const resolveTaskSourcePath = (options: RunPrdRequest, cwd: string) => {
  if (options.yaml) {
    return join(cwd, options.yaml);
  }

  return join(cwd, options.prd ?? "PRD.md");
};

const fail = (requirement: PrdRequirement, message: string): PrdRequirementFailure => ({
  requirement,
  message,
});

export const checkPrdRequirements = async (
  options: RunPrdRequest & { cwd?: string },
): Promise<PrdRequirementsResult> => {
  const cwd = options.cwd ?? process.cwd();
  const failures: PrdRequirementFailure[] = [];

  if (!(await pathExists(join(cwd, ".git")))) {
    failures.push(fail("git", `Missing .git directory in ${cwd}`));
  }

  if (!options.github) {
    const taskSourcePath = resolveTaskSourcePath(options, cwd);
    if (!(await pathExists(taskSourcePath))) {
      failures.push(fail("task-source", `Missing task source file: ${taskSourcePath}`));
    }
  }

  const packagePath = join(cwd, "package.json");
  if (await pathExists(packagePath)) {
    const contents = await Bun.file(packagePath).text();
    const parsed = JSON.parse(contents) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    if (hasDependencies(parsed)) {
      const nodeModulesPath = join(cwd, "node_modules");
      if (!(await pathExists(nodeModulesPath))) {
        failures.push(fail("dependencies", `Missing node_modules in ${cwd}`));
      }
    }
  }

  if (failures.length > 0) {
    return { status: "error", failures };
  }

  return { status: "ok" };
};

export const runPrd = async (options: RunPrdRequest & { cwd?: string }): Promise<RunPrdResponse> =>
  checkPrdRequirements(options);
