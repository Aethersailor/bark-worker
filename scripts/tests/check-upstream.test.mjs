import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const script = fileURLToPath(new URL("../check-upstream.mjs", import.meta.url));
const original = "a".repeat(40);
const reviewed = "b".repeat(40);
const newer = "c".repeat(40);
const mockFetch = `
  const scenario = JSON.parse(process.env.UPSTREAM_TEST_SCENARIO);
  globalThis.fetch = async (url) => {
    if (scenario.failure) return { ok: false, status: 403 };
    if (url === 'https://api.github.com/repos/Finb/bark-server/commits/master') {
      if (scenario.forbidLatest) throw new Error('must not resolve master');
      return { ok: true, text: async () => JSON.stringify({ sha: scenario.latest }) };
    }
    const prefix = 'https://raw.githubusercontent.com/Finb/bark-server/';
    if (!url.startsWith(prefix)) throw new Error('unexpected upstream URL: ' + url);
    const [commit, ...segments] = url.slice(prefix.length).split('/');
    const path = segments.join('/');
    const contents = {
      'database/database.go': 'type Database interface {\\n  CountAll()\\n}\\n',
      'apns/apns.go': 'const PayloadMaximum = 4096',
      'apns/apns_certs.go': 'const apnsPrivateKey = ' + String.fromCharCode(96) + 'fixture-only' + String.fromCharCode(96),
    };
    let content = contents[path] ?? '// unchanged fixture';
    if (path === 'docs/MCP.md') content += commit;
    if (path === 'route_mcp.go' && scenario.semantic && commit !== '${original}') content += commit;
    return { ok: true, text: async () => content };
  };
`;

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "bark-upstream-test-"));
  const resolved = realpathSync(directory);
  t.after(() => {
    assert.equal(realpathSync(directory), resolved);
    assert.equal(dirname(resolved), realpathSync(tmpdir()));
    rmSync(directory, { recursive: true });
  });
  const lock = join(directory, "lock.json");
  const output = join(directory, "output.txt");
  const preload = join(directory, "mock-fetch.mjs");
  writeFileSync(preload, mockFetch);
  function run(args = [], scenario = {}) {
    writeFileSync(output, "");
    const result = spawnSync(
      process.execPath,
      ["--import", pathToFileURL(preload).href, script, "--lock", lock, ...args],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          GITHUB_TOKEN: "",
          GITHUB_OUTPUT: output,
          UPSTREAM_TEST_SCENARIO: JSON.stringify({ latest: original, ...scenario }),
        },
        timeout: 15_000,
      },
    );
    assert.ifError(result.error);
    return { ...result, output: readFileSync(output, "utf8") };
  }
  const initial = run(["--write"]);
  assert.equal(initial.status, 0, initial.stderr);
  return { lock, run, read: () => readFileSync(lock, "utf8") };
}

test("unchanged upstream preserves the lock byte for byte", (t) => {
  const { run, read } = fixture(t);
  const before = read();
  const result = run(["--write"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.output, /changed=false\nsafe=true/);
  assert.equal(read(), before);
});

test("documentation-only changes update the lock and verify offline fixtures", (t) => {
  const { run, read } = fixture(t);
  const result = run(["--write"], { latest: reviewed });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.output, /changed=true\nsafe=true/);
  assert.equal(JSON.parse(read()).commit, reviewed);
  assert.equal(run([], { forbidLatest: true }).status, 0);
});

test("unreviewed semantic changes fail without modifying the lock", (t) => {
  const { run, read } = fixture(t);
  const before = read();
  const result = run(["--write"], { latest: reviewed, semantic: true });
  assert.equal(result.status, 2);
  assert.match(result.output, /safe=false/);
  assert.match(result.output, /reason=semantic files changed: route_mcp.go/);
  assert.equal(read(), before);
});

test("acceptance pins only the reviewed SHA and still blocks later semantic changes", (t) => {
  const { run, read } = fixture(t);
  const result = run(["--write", "--accept-commit", reviewed], {
    latest: newer,
    semantic: true,
    forbidLatest: true,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(read()).commit, reviewed);
  assert.equal(run([], { semantic: true, forbidLatest: true }).status, 0);
  const before = read();
  assert.equal(run(["--write"], { latest: newer, semantic: true }).status, 2);
  assert.equal(read(), before);
});

test("acceptance requires write mode and a full SHA", (t) => {
  const { run, read } = fixture(t);
  const before = read();
  for (const args of [
    ["--accept-commit", reviewed],
    ["--write", "--accept-commit", "master"],
    ["--write", "--accept-commit"],
  ]) {
    const result = run(args);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /requires --write and an exact/);
    assert.equal(read(), before);
  }
});

test("API failure remains a failure without safe-update outputs or lock writes", (t) => {
  const { run, read } = fixture(t);
  const before = read();
  const result = run(["--write"], { failure: true });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /upstream request failed: 403/);
  assert.equal(result.output, "");
  assert.equal(read(), before);
});

test("malformed lock files cannot silently bootstrap a new baseline", (t) => {
  const { lock, run, read } = fixture(t);
  writeFileSync(lock, "{broken");
  const result = run(["--write"]);
  assert.equal(result.status, 1);
  assert.equal(result.output, "");
  assert.equal(read(), "{broken");
});
