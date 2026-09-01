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
const SEMANTIC_FILES = WATCHED_FILES.filter(
  (path) => !path.startsWith("docs/") && path !== "push_test.go",
);

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function requestHeaders() {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "Aethersailor-bark-worker-upstream-check",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  return headers;
}

async function fetchText(url) {
  const response = await fetch(url, { headers: requestHeaders() });
  if (!response.ok) {
    throw new Error(`upstream request failed: ${response.status} ${url}`);
  }
  return response.text();
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

function extractContract(files) {
  const routeFiles = [
    files["route_auth.go"],
    files["route_mcp.go"],
    files["route_misc.go"],
    files["route_push.go"],
    files["route_register.go"],
  ].join("\n");
  const routes = [...routeFiles.matchAll(/router\.(Get|Post|All)\("([^"]+)"/g)]
    .map((match) => `${match[1].toUpperCase()} ${match[2]}`)
    .sort();

  const databaseBody = files["database/database.go"].match(
    /type Database interface \{([\s\S]*?)\n\}/,
  )?.[1];
  if (!databaseBody) {
    throw new Error("unable to extract upstream Database interface");
  }
  const databaseMethods = [...databaseBody.matchAll(/^\s*([A-Z][A-Za-z0-9_]*)\(/gm)]
    .map((match) => match[1])
    .sort();

  const apns = files["apns/apns.go"];
  const stringConstant = (name) => apns.match(new RegExp(`${name}\\s*=\\s*"([^"]+)"`))?.[1] ?? null;
  const payloadMaximum = Number(apns.match(/PayloadMaximum\s*=\s*(\d+)/)?.[1] ?? Number.NaN);
  if (!Number.isFinite(payloadMaximum)) {
    throw new Error("unable to extract upstream APNs payload maximum");
  }

  const privateKey = files["apns/apns_certs.go"].match(/const apnsPrivateKey = `([\s\S]*?)`/)?.[1];
  if (!privateKey) {
    throw new Error("unable to extract upstream APNs private key");
  }

  return {
    apns: {
      keyId: stringConstant("keyID"),
      payloadMaximum,
      privateKeySha256: sha256(privateKey),
      teamId: stringConstant("teamID"),
      topic: stringConstant("topic"),
    },
    databaseMethods,
    routes,
  };
}

function buildLock(commit, files, verifiedAt) {
  const hashes = Object.fromEntries(WATCHED_FILES.map((path) => [path, sha256(files[path])]));
  return {
    schemaVersion: 1,
    repository: REPOSITORY,
    branch: BRANCH,
    commit,
    verifiedAt,
    semanticFiles: SEMANTIC_FILES,
    files: hashes,
    contract: extractContract(files),
  };
}

function semanticChanges(previous, next) {
  return SEMANTIC_FILES.filter((path) => previous.files?.[path] !== next.files[path]);
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

const lockPath = argumentValue("--lock");
if (!lockPath) {
  throw new Error("usage: check-upstream.mjs --lock <path> [--write] [--latest]");
}

let previous = null;
try {
  previous = JSON.parse(await readFile(lockPath, "utf8"));
} catch (error) {
  if (!process.argv.includes("--write")) {
    throw error;
  }
}

const write = process.argv.includes("--write");
const latest = write || process.argv.includes("--latest");
const commit = latest ? await resolveLatestCommit() : previous?.commit;
if (!commit || !/^[0-9a-f]{40}$/.test(commit)) {
  throw new Error("lock file does not contain a valid upstream commit");
}

const files = await fetchFiles(commit);
const next = buildLock(commit, files, new Date().toISOString());

if (!write) {
  const expected = { ...previous, verifiedAt: next.verifiedAt };
  const actual = { ...next };
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    throw new Error("upstream lock does not match the pinned upstream content");
  }
  await appendOutput({ changed: "false", safe: "true", upstream_sha: commit });
  console.log(`upstream lock verified at ${commit}`);
  process.exit(0);
}

if (previous && previous.commit !== next.commit) {
  const changes = semanticChanges(previous, next);
  if (changes.length > 0) {
    await appendOutput({
      changed: "true",
      safe: "false",
      upstream_sha: commit,
      reason: `semantic files changed: ${changes.join(",")}`,
    });
    console.error(`unsafe upstream change at ${commit}: ${changes.join(", ")}`);
    process.exit(2);
  }
}

await writeFile(lockPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
await appendOutput({
  changed: previous?.commit === next.commit ? "false" : "true",
  safe: "true",
  upstream_sha: commit,
});
console.log(`upstream lock written at ${commit}`);
