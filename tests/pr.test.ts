import { expect, test } from "bun:test";
import { buildPrCreateArgs } from "../src/core/git/pr";

test("buildPrCreateArgs includes optional flags", () => {
  const args = buildPrCreateArgs({
    cwd: "/repo",
    title: "Ralphy: Ship it",
    body: "## Summary\n- Ship it\n",
    baseBranch: "main",
    headBranch: "ralphy/ship-it",
    draft: true,
  });

  expect(args).toEqual([
    "pr",
    "create",
    "--title",
    "Ralphy: Ship it",
    "--body",
    "## Summary\n- Ship it\n",
    "--base",
    "main",
    "--head",
    "ralphy/ship-it",
    "--draft",
  ]);
});

test("buildPrCreateArgs omits optional flags", () => {
  const args = buildPrCreateArgs({
    cwd: "/repo",
    title: "Ralphy: Ship it",
    body: "## Summary\n- Ship it\n",
  });

  expect(args).toEqual(["pr", "create", "--title", "Ralphy: Ship it", "--body", "## Summary\n- Ship it\n"]);
});
