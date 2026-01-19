const envVersion = process.env.RALPHY_VERSION;

const readPackageVersion = async (path: string | URL) => {
  try {
    const file = Bun.file(path);
    if (!(await file.exists())) {
      return undefined;
    }
    const data: unknown = JSON.parse(await file.text());
    if (typeof data === "object" && data !== null && "version" in data) {
      const version = data.version;
      return typeof version === "string" ? version : undefined;
    }
  } catch {
    return undefined;
  }
  return undefined;
};

const packageVersionFromProject = await readPackageVersion(
  new URL("../../package.json", import.meta.url),
);
const packageVersionFromCwd = await readPackageVersion(
  `${process.cwd()}/package.json`,
);

export const packageVersion =
  envVersion ?? packageVersionFromProject ?? packageVersionFromCwd ?? "0.0.0";
