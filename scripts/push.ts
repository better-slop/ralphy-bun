const pollMsRaw = Number.parseInt(process.env.PUSH_POLL_MS ?? "", 10);
const pollMs = Number.isFinite(pollMsRaw) && pollMsRaw > 0 ? pollMsRaw : 2000;
const remote = process.env.PUSH_REMOTE ?? "origin";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const exec = async (cmd: Promise<{ stdout: Uint8Array; stderr: Uint8Array; exitCode: number }>) => {
  const output = await cmd;
  if (output.exitCode !== 0) {
    const message = output.stderr.toString() || output.stdout.toString();
    throw new Error(message.trim() || "Command failed");
  }
  return output.stdout.toString().trim();
};

const getHead = () => exec(Bun.$`git rev-parse HEAD`);
const getBranch = () => exec(Bun.$`git rev-parse --abbrev-ref HEAD`);

const getUpstream = async () => {
  const output = await Bun.$`git rev-parse --abbrev-ref --symbolic-full-name @{u}`;
  if (output.exitCode !== 0) {
    return null;
  }
  return output.stdout.toString().trim();
};

const push = async () => {
  const upstream = await getUpstream();
  if (upstream) {
    await exec(Bun.$`git push`);
    return;
  }
  const branch = await getBranch();
  await exec(Bun.$`git push ${remote} ${branch}`);
};

let running = true;
const stop = () => {
  running = false;
};

process.on("SIGINT", stop);
process.on("SIGTERM", stop);

const main = async () => {
  const branch = await getBranch();
  let lastHead = await getHead();
  console.log(`Watching ${branch} for new commits...`);

  while (running) {
    await sleep(pollMs);
    const head = await getHead();
    if (head === lastHead) {
      continue;
    }

    try {
      await push();
      lastHead = head;
      console.log(`Pushed ${head}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Push failed: ${message}`);
    }
  }
};

await main();
