const baseUrl = process.argv[2]?.replace(/\/+$/, "");
const expectedCommit = process.argv[3];
const expectedUpstream = process.argv[4];
if (!baseUrl || !expectedCommit || !expectedUpstream) {
  throw new Error("usage: smoke.mjs <base-url> <worker-commit> <upstream-commit>");
}

async function request(path, expectedStatus, options) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status !== expectedStatus) {
    const body = await response.text();
    throw new Error(`${path} returned ${response.status}, expected ${expectedStatus}: ${body}`);
  }
  return response;
}

const health = await request("/healthz", 200);
if ((await health.text()) !== "ok") {
  throw new Error("/healthz did not return ok");
}

const ping = await request("/ping", 200);
const pingBody = await ping.json();
if (pingBody.code !== 200 || pingBody.message !== "pong") {
  throw new Error("/ping returned an incompatible response");
}

const info = await request("/info", 200);
const infoBody = await info.json();
if (infoBody.commit !== expectedCommit) {
  throw new Error(`/info commit=${infoBody.commit}, expected ${expectedCommit}`);
}
if (infoBody.upstream !== expectedUpstream) {
  throw new Error(`/info upstream=${infoBody.upstream}, expected ${expectedUpstream}`);
}
if (typeof infoBody.devices !== "number" || infoBody.devices < 0) {
  throw new Error("/info returned an invalid device count");
}

console.log(
  JSON.stringify({
    baseUrl,
    commit: infoBody.commit,
    environment: infoBody.environment,
    upstream: infoBody.upstream,
    devices: infoBody.devices,
    status: "ok",
  }),
);
