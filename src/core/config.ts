import { basename, join } from "node:path";
import { mkdir, stat } from "node:fs/promises";

export type CommandDetection = {
  test: string;
  lint: string;
  build: string;
};

export type ProjectDetection = {
  name: string;
  language: string;
  framework: string;
  description: string;
};

export type ConfigDetection = {
  project: ProjectDetection;
  commands: CommandDetection;
};

export type ConfigInitOptions = {
  cwd?: string;
  force?: boolean;
  confirmOverwrite?: () => Promise<boolean>;
};

export type ConfigInitStatus = "created" | "exists" | "overwritten";

export type ConfigInitResult = {
  status: ConfigInitStatus;
  message: string;
  detected: ConfigDetection;
  paths: {
    ralphyDir: string;
    configPath: string;
    progressPath: string;
  };
};

export type ConfigReadStatus = "loaded" | "missing";

export type ConfigReadResult = {
  status: ConfigReadStatus;
  path: string;
  contents?: string;
};

export type ConfigRuleStatus = "added" | "exists" | "missing";

export type ConfigRuleResult = {
  status: ConfigRuleStatus;
  path: string;
  rule: string;
  contents?: string;
};

type ConfigPaths = {
  ralphyDir: string;
  configPath: string;
  progressPath: string;
};

const yamlEscape = (value: string) => value.replaceAll("\"", "\\\"");

const pathExists = async (path: string) => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

const createConfigYaml = (detected: ConfigDetection) => `# Ralphy Configuration
# https://github.com/michaelshimeles/ralphy

# Project info (auto-detected, edit if needed)
project:
  name: "${yamlEscape(detected.project.name)}"
  language: "${yamlEscape(detected.project.language)}"
  framework: "${yamlEscape(detected.project.framework)}"
  description: "${yamlEscape(detected.project.description)}"  # Add a brief description

# Commands (auto-detected from package.json/pyproject.toml)
commands:
  test: "${yamlEscape(detected.commands.test)}"
  lint: "${yamlEscape(detected.commands.lint)}"
  build: "${yamlEscape(detected.commands.build)}"

# Rules - instructions the AI MUST follow
# These are injected into every prompt
rules: []
  # Examples:
  # - "Always use TypeScript strict mode"
  # - "Follow the error handling pattern in src/utils/errors.ts"
  # - "All API endpoints must have input validation with Zod"
  # - "Use server actions instead of API routes in Next.js"

# Boundaries - files/folders the AI should not modify
boundaries:
  never_touch: []
    # Examples:
    # - "src/legacy/**"
    # - "migrations/**"
    # - "*.lock"
`;

const createProgressFile = () => "# Ralphy Progress Log\n\n";

const getConfigPaths = (cwd: string): ConfigPaths => {
  const ralphyDir = join(cwd, ".ralphy");
  return {
    ralphyDir,
    configPath: join(ralphyDir, "config.yaml"),
    progressPath: join(ralphyDir, "progress.txt"),
  };
};

const detectFrameworks = (dependencies: string[]) => {
  const frameworks: string[] = [];
  const has = (name: string) => dependencies.includes(name);

  if (has("next")) frameworks.push("Next.js");
  if (has("nuxt")) frameworks.push("Nuxt");
  if (has("@remix-run/react")) frameworks.push("Remix");
  if (has("svelte")) frameworks.push("Svelte");
  if (dependencies.some((dep) => dep.startsWith("@nestjs/"))) frameworks.push("NestJS");
  if (has("hono")) frameworks.push("Hono");
  if (has("fastify")) frameworks.push("Fastify");
  if (has("express")) frameworks.push("Express");

  if (frameworks.length === 0) {
    if (has("react")) frameworks.push("React");
    if (has("vue")) frameworks.push("Vue");
  }

  return frameworks.join(", ");
};

const detectFromPackageJson = async (cwd: string): Promise<ConfigDetection | null> => {
  const packagePath = join(cwd, "package.json");
  const packageFile = Bun.file(packagePath);
  if (!(await packageFile.exists())) {
    return null;
  }

  const content = await packageFile.text();
  const parsed = JSON.parse(content) as {
    name?: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    scripts?: Record<string, string>;
  };
  const tsconfigFile = Bun.file(join(cwd, "tsconfig.json"));
  const isTypescript = await tsconfigFile.exists();
  const dependencyNames = Array.from(
    new Set([
      ...Object.keys(parsed.dependencies ?? {}),
      ...Object.keys(parsed.devDependencies ?? {}),
    ]),
  );
  const projectName = parsed.name && parsed.name.trim().length > 0 ? parsed.name : basename(cwd);
  const framework = detectFrameworks(dependencyNames);
  const hasBunLock =
    (await Bun.file(join(cwd, "bun.lockb")).exists()) ||
    (await Bun.file(join(cwd, "bun.lock")).exists());
  const scripts = parsed.scripts ?? {};

  const commands: CommandDetection = {
    test: scripts.test ? (hasBunLock ? "bun test" : "npm test") : "",
    lint: scripts.lint ? "npm run lint" : "",
    build: scripts.build ? "npm run build" : "",
  };

  return {
    project: {
      name: projectName,
      language: isTypescript ? "TypeScript" : "JavaScript",
      framework,
      description: "",
    },
    commands,
  };
};

const detectFromOtherLanguages = async (cwd: string): Promise<ConfigDetection | null> => {
  const pythonFiles = ["pyproject.toml", "requirements.txt", "setup.py"];
  const goFiles = ["go.mod"];
  const rustFiles = ["Cargo.toml"];

  const findAny = async (files: string[]) => {
    for (const file of files) {
      if (await Bun.file(join(cwd, file)).exists()) {
        return true;
      }
    }
    return false;
  };

  if (await findAny(pythonFiles)) {
    return {
      project: {
        name: basename(cwd),
        language: "Python",
        framework: "",
        description: "",
      },
      commands: {
        test: "pytest",
        lint: "ruff check .",
        build: "",
      },
    };
  }

  if (await findAny(goFiles)) {
    return {
      project: {
        name: basename(cwd),
        language: "Go",
        framework: "",
        description: "",
      },
      commands: {
        test: "go test ./...",
        lint: "golangci-lint run",
        build: "",
      },
    };
  }

  if (await findAny(rustFiles)) {
    return {
      project: {
        name: basename(cwd),
        language: "Rust",
        framework: "",
        description: "",
      },
      commands: {
        test: "cargo test",
        lint: "cargo clippy",
        build: "cargo build",
      },
    };
  }

  return null;
};

const detectProject = async (cwd: string): Promise<ConfigDetection> => {
  const packageDetection = await detectFromPackageJson(cwd);
  if (packageDetection) {
    return packageDetection;
  }

  const otherDetection = await detectFromOtherLanguages(cwd);
  if (otherDetection) {
    return otherDetection;
  }

  return {
    project: {
      name: basename(cwd),
      language: "Unknown",
      framework: "",
      description: "",
    },
    commands: {
      test: "",
      lint: "",
      build: "",
    },
  };
};

export const initRalphyConfig = async (
  options: ConfigInitOptions = {},
): Promise<ConfigInitResult> => {
  const cwd = options.cwd ?? process.cwd();
  const { ralphyDir, configPath, progressPath } = getConfigPaths(cwd);
  const detected = await detectProject(cwd);

  const ralphyDirExists = await pathExists(ralphyDir);
  const shouldOverwrite = options.force
    ? true
    : ralphyDirExists
      ? (await options.confirmOverwrite?.()) ?? false
      : true;

  if (ralphyDirExists && !shouldOverwrite) {
    return {
      status: "exists",
      message: ".ralphy already exists",
      detected,
      paths: { ralphyDir, configPath, progressPath },
    };
  }

  await mkdir(ralphyDir, { recursive: true });
  await Bun.write(configPath, createConfigYaml(detected));
  await Bun.write(progressPath, createProgressFile());

  return {
    status: ralphyDirExists ? "overwritten" : "created",
    message: ralphyDirExists ? "Overwrote .ralphy config" : "Created .ralphy config",
    detected,
    paths: { ralphyDir, configPath, progressPath },
  };
};

export const readRalphyConfig = async (cwd = process.cwd()): Promise<ConfigReadResult> => {
  const { configPath } = getConfigPaths(cwd);
  const file = Bun.file(configPath);

  if (!(await file.exists())) {
    return { status: "missing", path: configPath };
  }

  const contents = await file.text();
  return { status: "loaded", path: configPath, contents };
};

type RulesBlock = {
  rulesIndex: number;
  blockEnd: number;
  indent: string;
};

const findRulesBlock = (lines: string[]): RulesBlock | null => {
  const rulesIndex = lines.findIndex((line) => line.trimStart().startsWith("rules:"));
  if (rulesIndex < 0) {
    return null;
  }

  const indentMatch = lines[rulesIndex]?.match(/^(\s*)/);
  const indent = indentMatch?.[1] ?? "";

  for (let i = rulesIndex + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    if (line.startsWith(" ") || line.startsWith("\t")) {
      continue;
    }
    if (trimmed.includes(":")) {
      return { rulesIndex, blockEnd: i, indent };
    }
  }

  return { rulesIndex, blockEnd: lines.length, indent };
};

const normalizeRule = (value: string) =>
  value.trim().replace(/^(["'])/, "").replace(/(["'])$/, "");

export const addConfigRule = async (
  rule: string,
  cwd = process.cwd(),
): Promise<ConfigRuleResult> => {
  const { configPath } = getConfigPaths(cwd);
  const file = Bun.file(configPath);

  if (!(await file.exists())) {
    return { status: "missing", path: configPath, rule };
  }

  const contents = await file.text();
  const lines = contents.split(/\r?\n/);
  const block = findRulesBlock(lines);

  if (!block) {
    return { status: "missing", path: configPath, rule, contents };
  }

  const ruleValue = normalizeRule(rule);
  const ruleLine = `${block.indent}  - "${yamlEscape(ruleValue)}"`;
  const ruleItemIndices: number[] = [];

  for (let i = block.rulesIndex + 1; i < block.blockEnd; i += 1) {
    const line = lines[i] ?? "";
    const match = line.match(/^\s*-\s*(.+)$/);
    if (!match) {
      continue;
    }
    const existing = normalizeRule(match[1] ?? "");
    if (existing === ruleValue) {
      return { status: "exists", path: configPath, rule, contents };
    }
    ruleItemIndices.push(i);
  }

  const rulesLine = lines[block.rulesIndex] ?? "";
  if (rulesLine.includes("[]")) {
    lines[block.rulesIndex] = `${block.indent}rules:`;
  }

  const insertIndex =
    ruleItemIndices.length > 0
      ? (ruleItemIndices[ruleItemIndices.length - 1] ?? block.rulesIndex) + 1
      : block.rulesIndex + 1;
  lines.splice(insertIndex, 0, ruleLine);

  const updated = lines.join("\n");
  await Bun.write(configPath, updated);

  return { status: "added", path: configPath, rule, contents: updated };
};
