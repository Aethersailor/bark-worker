const baseUrl = process.argv[2]?.replace(/\/+$/, "");
const expectedCommit = process.argv[3];
const expectedUpstream = process.argv[4];
if (!baseUrl || !expectedCommit || !expectedUpstream) {
  throw new Error("usage: smoke.mjs <base-url> <worker-commit> <upstream-commit>");
}

const RETRY_DELAYS_MS = [0, 2_000, 3_000, 5_000, 8_000, 10_000, 12_000, 15_000];

async function request(path, expectedStatus, options) {
  let lastError = new Error(`${path} was not requested`);

  for (const delay of RETRY_DELAYS_MS) {
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    let response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        ...options,
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      continue;
    }

    if (response.status === expectedStatus) {
      return response;
    }

    const body = (await response.text()).slice(0, 512).replaceAll(/\s+/g, " ").trim();
    lastError = new Error(
      `${path} returned ${response.status}, expected ${expectedStatus}: ${body}`,
    );
    if (![404, 429, 500, 502, 503, 504].includes(response.status)) {
      throw lastError;
    }
  }

  throw lastError;
}

async function waitForExpectedInfo() {
  let lastError = new Error("/info was not requested");

  for (const delay of RETRY_DELAYS_MS) {
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    const info = await request("/info", 200);
    const body = await info.json();
    if (body.commit === expectedCommit && body.upstream === expectedUpstream) {
      return body;
    }
    lastError = new Error(
      `/info identity commit=${body.commit} upstream=${body.upstream}, expected commit=${expectedCommit} upstream=${expectedUpstream}`,
    );
  }

  throw lastError;
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

const infoBody = await waitForExpectedInfo();
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
