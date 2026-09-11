import assert from "node:assert/strict";
import test from "node:test";

import {
  checksAreGreen,
  commitsAreTrusted,
  filesMatchDependabotScope,
  isTrustedDependabotPullRequest,
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
      { filename: ".github/workflows/ci.yml" },
    ]),
    true,
  );
  assert.equal(
    filesMatchDependabotScope("dependabot/npm_and_yarn/hono-4.13.7", [
      { filename: "worker/src/index.ts" },
    ]),
    false,
  );
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
