import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const REPOSITORY = "Finb/bark-server";
const BRANCH = "master";
const WATCHED_FILES = [
  "main.go",
  "router.go",
  "route_auth.go",
  "route_mcp.go",
  "route_misc.go",
  "route_push.go",
  "route_register.go",
  "push_test.go",
  "database/database.go",
  "apns/apns.go",
  "apns/apns_certs.go",
  "docs/API_V2.md",
  "docs/MCP.md",
];

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function requestHeaders() {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "Aethersailor-bark-worker-upstream-sync",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  return headers;
}

async function fetchText(url) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    let response;
    try {
      response = await fetch(url, { headers: requestHeaders() });
    } catch (error) {
      lastError = error;
    }

    if (response) {
      if (response.ok) return response.text();
      const error = new Error(`upstream request failed: ${response.status} ${url}`);
      if (response.status !== 429 && response.status < 500) throw error;
      lastError = error;
    }

    if (attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }

  throw new Error(`upstream request failed after 3 attempts: ${url}`, {
    cause: lastError,
  });
}

async function resolveLatestCommit() {
  const body = await fetchText(`https://api.github.com/repos/${REPOSITORY}/commits/${BRANCH}`);
  const parsed = JSON.parse(body);
  if (typeof parsed.sha !== "string" || !/^[0-9a-f]{40}$/.test(parsed.sha)) {
    throw new Error("GitHub returned an invalid upstream commit SHA");
  }
  return parsed.sha;
}

async function fetchFiles(commit) {
  const entries = await Promise.all(
    WATCHED_FILES.map(async (path) => {
      const content = await fetchText(
        `https://raw.githubusercontent.com/${REPOSITORY}/${commit}/${path}`,
      );
      return [path, content];
    }),
  );
  return Object.fromEntries(entries);
}

async function appendOutput(values) {
  if (!process.env.GITHUB_OUTPUT) {
    return;
  }
  const lines = Object.entries(values).map(([key, value]) => `${key}=${value}`);
  await writeFile(process.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`, {
    flag: "a",
  });
}

const lockPath = process.argv[2] ?? "upstream/UPSTREAM.lock.json";
let previous = null;
try {
  previous = JSON.parse(await readFile(lockPath, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") {
    throw error;
  }
}

const commit = await resolveLatestCommit();
if (previous?.schemaVersion === 2 && previous.commit === commit) {
  await appendOutput({ changed: "false" });
  console.log(`upstream lock already current at ${commit}`);
  process.exit(0);
}

const files = await fetchFiles(commit);
const next = {
  schemaVersion: 2,
  repository: REPOSITORY,
  branch: BRANCH,
  commit,
  syncedAt: new Date().toISOString(),
  files: Object.fromEntries(WATCHED_FILES.map((path) => [path, sha256(files[path])])),
};
await writeFile(lockPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
await appendOutput({ changed: "true" });
console.log(`upstream lock written at ${commit}`);
