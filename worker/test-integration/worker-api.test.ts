import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

const CREATE_SCHEMA = `CREATE TABLE devices (
  device_key TEXT PRIMARY KEY,
  device_token TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) WITHOUT ROWID`;

describe("Worker with a real D1 binding", () => {
  beforeEach(async () => {
    await env.DB.prepare("DROP TABLE IF EXISTS devices").run();
    await env.DB.prepare(CREATE_SCHEMA).run();
  });

  it("registers, checks, and reports a device through the deployed entrypoint", async () => {
    const registration = await exports.default.fetch("https://example.com/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ device_token: "integration-token" }),
    });
    expect(registration.status).toBe(200);
    const body = (await registration.json()) as {
      data: { device_key: string; device_token: string };
    };
    expect(body.data.device_key).toHaveLength(22);
    expect(body.data.device_token).toBe("integration-token");

    const check = await exports.default.fetch(
      `https://example.com/register/${body.data.device_key}`,
    );
    expect(check.status).toBe(200);

    const info = await exports.default.fetch("https://example.com/info");
    expect(info.status).toBe(200);
    await expect(info.json()).resolves.toMatchObject({
      environment: "development",
      upstream: "3df8990fcbc407a3f5638eea8cedc3289d1a405d",
      devices: 1,
    });
  });
});
