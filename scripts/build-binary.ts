import { buildBinary } from "../src/core/build";

const entrypoint = process.env.RALPHY_ENTRYPOINT ?? "src/cli.ts";
const outDir = process.env.RALPHY_OUTDIR ?? "dist/bin";
const outfile = process.env.RALPHY_OUTFILE ?? "ralphy-bun";

await buildBinary({ entrypoint, outDir, outfile });
