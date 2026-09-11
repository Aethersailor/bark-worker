import { appendFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const API_VERSION = "2022-11-28";
const ACCEPTABLE_CONCLUSIONS = new Set(["success", "neutral", "skipped"]);
const REQUIRED_CHECKS = new Map([
  ["validate", "github-actions"],
  ["analyze (javascript-typescript)", "github-actions"],
  ["analyze (go)", "github-actions"],
  ["CodeQL", "github-advanced-security"],
]);

export function isTrustedDependabotPullRequest(pull, repository, targetBranch) {
  return (
    pull?.state === "open" &&
    pull?.draft === false &&
    pull?.user?.login === "dependabot[bot]" &&
    pull?.user?.type === "Bot" &&
    pull?.head?.repo?.full_name?.toLowerCase() === repository.toLowerCase() &&
    pull?.head?.ref?.startsWith("dependabot/") &&
    pull?.base?.ref === targetBranch
  );
}

export function filesMatchDependabotScope(headRef, files) {
  const names = files.map((file) => file.filename);
  if (names.length === 0) return false;

  if (headRef.startsWith("dependabot/npm_and_yarn/")) {
    return names.every((name) =>
      ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"].includes(name),
    );
  }

  if (headRef.startsWith("dependabot/go_modules/tools/bark-db/")) {
    return names.every(
      (name) => name === "tools/bark-db/go.mod" || name === "tools/bark-db/go.sum",
    );
  }

  if (headRef.startsWith("dependabot/github_actions/")) {
    return names.every((name) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(name));
  }

  return false;
}

export function commitsAreTrusted(commits) {
  return (
    commits.length > 0 &&
    commits.every(
      (commit) =>
        commit?.author?.login === "dependabot[bot]" &&
        commit?.commit?.verification?.verified === true,
    )
  );
}

export function checksAreGreen(checkRuns, statuses = []) {
  const latestByName = new Map();
  for (const check of checkRuns) {
    const previous = latestByName.get(check.name);
    const previousTime = Date.parse(previous?.completed_at || previous?.started_at || 0);
    const currentTime = Date.parse(check.completed_at || check.started_at || 0);
    if (!previous || currentTime >= previousTime) latestByName.set(check.name, check);
  }

  for (const [name, appSlug] of REQUIRED_CHECKS) {
    const check = latestByName.get(name);
    if (
      !check ||
      check.app?.slug !== appSlug ||
      check.status !== "completed" ||
      check.conclusion !== "success"
    ) {
      return false;
    }
  }

  const everyCheckPassed = [...latestByName.values()].every(
    (check) => check.status === "completed" && ACCEPTABLE_CONCLUSIONS.has(check.conclusion),
  );
  const everyStatusPassed = statuses.every((status) => status.state === "success");

  return everyCheckPassed && everyStatusPassed;
}

function githubClient(token) {
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": API_VERSION,
    "User-Agent": "bark-worker-dependabot-auto-merge",
  };

  return async function request(path, options = {}) {
    const method = options.method || "GET";
    const attempts = method === "GET" ? 3 : 1;
    let lastError;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const response = await fetch(`https://api.github.com${path}`, {
          method,
          headers: {
            ...headers,
            ...(options.body ? { "Content-Type": "application/json" } : {}),
          },
          body: options.body ? JSON.stringify(options.body) : undefined,
        });
        const text = await response.text();
        const data = text ? JSON.parse(text) : null;

        if (!response.ok) {
          throw new Error(
            `GitHub API ${method} ${path} returned ${response.status}: ${data?.message || text}`,
          );
        }
        return data;
      } catch (error) {
        lastError = error;
        if (attempt === attempts) throw error;
        await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
      }
    }

    throw lastError;
  };
}

async function writeSummary(lines) {
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  await appendFile(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`, "utf8");
}

export async function reconcile({ token, repository, targetBranch = "main", dryRun = false }) {
  const api = githubClient(token);
  const encodedBranch = encodeURIComponent(targetBranch);
  const branch = await api(`/repos/${repository}/git/ref/heads/${encodedBranch}`);
  const currentBaseSha = branch.object.sha;
  const pulls = await api(
    `/repos/${repository}/pulls?state=open&base=${encodedBranch}&per_page=100`,
  );
  const candidates = pulls
    .filter((pull) => isTrustedDependabotPullRequest(pull, repository, targetBranch))
    .sort((left, right) => left.number - right.number);

  const notes = ["## Dependabot auto-merge", "", `Current ${targetBranch}: \`${currentBaseSha}\``];

  for (const candidate of candidates) {
    const number = candidate.number;
    const pull = await api(`/repos/${repository}/pulls/${number}`);
    if (!isTrustedDependabotPullRequest(pull, repository, targetBranch)) continue;
    if (pull.changed_files > 100 || pull.commits > 100) {
      notes.push(`- #${number}: skipped because the change exceeds the review bound.`);
      continue;
    }

    const [files, commits, comparison, checks, combinedStatus] = await Promise.all([
      api(`/repos/${repository}/pulls/${number}/files?per_page=100`),
      api(`/repos/${repository}/pulls/${number}/commits?per_page=100`),
      api(`/repos/${repository}/compare/${currentBaseSha}...${pull.head.sha}`),
      api(`/repos/${repository}/commits/${pull.head.sha}/check-runs?filter=latest&per_page=100`),
      api(`/repos/${repository}/commits/${pull.head.sha}/status?per_page=100`),
    ]);

    if (!filesMatchDependabotScope(pull.head.ref, files)) {
      notes.push(`- #${number}: skipped because files fall outside the dependency allowlist.`);
      continue;
    }
    if (!commitsAreTrusted(commits)) {
      notes.push(`- #${number}: skipped because a commit is not verified Dependabot output.`);
      continue;
    }
    if (comparison.merge_base_commit?.sha !== currentBaseSha) {
      notes.push(
        `- #${number}: waiting for Dependabot to rebase onto the current ${targetBranch}.`,
      );
      continue;
    }
    if (checks.total_count > checks.check_runs.length) {
      notes.push(`- #${number}: skipped because not all check runs fit inside the review bound.`);
      continue;
    }
    if (!checksAreGreen(checks.check_runs, combinedStatus.statuses || [])) {
      notes.push(`- #${number}: waiting for CI and CodeQL to pass on \`${pull.head.sha}\`.`);
      continue;
    }
    if (
      pull.mergeable !== true ||
      pull.mergeable_state !== "clean" ||
      pull.has_blocking_discussions_resolved === false
    ) {
      notes.push(`- #${number}: waiting for GitHub to report a clean merge.`);
      continue;
    }

    if (dryRun) {
      notes.push(`- #${number}: eligible for auto-merge at \`${pull.head.sha}\`.`);
      await writeSummary(notes);
      console.log(`Dependabot PR #${number} is eligible for auto-merge.`);
      return { merged: false, eligiblePullNumber: number };
    }

    const result = await api(`/repos/${repository}/pulls/${number}/merge`, {
      method: "PUT",
      body: {
        sha: pull.head.sha,
        merge_method: "squash",
        commit_title: pull.title,
        commit_message:
          `Dependabot pull request #${number}.\n\n` +
          "Merged automatically after source, signature, scope, current-base, CI, and CodeQL verification.",
      },
    });
    if (!result?.merged || !result.sha) {
      throw new Error(`GitHub did not merge #${number}: ${result?.message || "unknown result"}`);
    }

    await api(`/repos/${repository}/actions/workflows/ci.yml/dispatches`, {
      method: "POST",
      body: { ref: targetBranch },
    });
    notes.push(`- #${number}: merged as \`${result.sha}\`; dispatched CI on ${targetBranch}.`);
    await writeSummary(notes);
    console.log(`Merged Dependabot PR #${number} as ${result.sha}`);
    return { merged: true, pullNumber: number, mergeSha: result.sha };
  }

  if (candidates.length === 0) notes.push("- No trusted Dependabot pull requests are open.");
  await writeSummary(notes);
  console.log("No Dependabot pull request is currently eligible for auto-merge.");
  return { merged: false };
}

async function main() {
  const token = process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  const targetBranch = process.env.TARGET_BRANCH || "main";
  const dryRun = process.env.DRY_RUN === "true";
  if (!token) throw new Error("GITHUB_TOKEN is required");
  if (!repository) throw new Error("GITHUB_REPOSITORY is required");
  await reconcile({ token, repository, targetBranch, dryRun });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  });
}
