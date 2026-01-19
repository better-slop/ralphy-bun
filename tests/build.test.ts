import { expect, test } from "bun:test";
import { buildBinaryCommand } from "../src/core/build";

test("buildBinaryCommand builds bun compile command", () => {
  const args = buildBinaryCommand({
    entrypoint: "src/cli.ts",
    outDir: "dist/bin",
    outfile: "ralphy-bun",
  });

  expect(args).toEqual([
    "bun",
    "build",
    "--compile",
    "--outfile",
    "dist/bin/ralphy-bun",
    "src/cli.ts",
  ]);
});
