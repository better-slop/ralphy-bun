import { join } from "node:path";

export type BuildBinaryOptions = {
  entrypoint: string;
  outDir: string;
  outfile: string;
};

const resolveOutfilePath = (options: BuildBinaryOptions) =>
  join(options.outDir, options.outfile);

export const buildBinaryCommand = (options: BuildBinaryOptions) => [
  "bun",
  "build",
  "--compile",
  "--outfile",
  resolveOutfilePath(options),
  options.entrypoint,
];

export const buildBinary = async (options: BuildBinaryOptions) => {
  const outfilePath = resolveOutfilePath(options);
  await Bun.$`mkdir -p ${options.outDir}`;
  await Bun.$`bun build --compile --outfile ${outfilePath} ${options.entrypoint}`;
};
