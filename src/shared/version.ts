const packageJsonUrl = new URL("../../package.json", import.meta.url);
const packageJson = JSON.parse(await Bun.file(packageJsonUrl).text());

export const packageVersion =
  typeof packageJson.version === "string" ? packageJson.version : "0.0.0";
