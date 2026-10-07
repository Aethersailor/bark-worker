import { describe, expect, it, vi } from "vitest";

import type { RuntimeEnv } from "@/types";
import { protectRequest } from "@/utils/request-protection";

function runtimeEnv(overrides: Record<string, unknown> = {}): RuntimeEnv {
  return { URL_PREFIX: "/", ...overrides } as unknown as RuntimeEnv;
}

describe("request protection before database or APNs work", () => {
  it("keeps health checks available without a limiter", async () => {
    for (const path of ["/", "/ping", "/healthz"]) {
      expect(
        await protectRequest(new Request(`https://example.com${path}`), runtimeEnv()),
      ).toBeNull();
    }
  });

  it("protects every route that can access persistent data", async () => {
    for (const path of ["/register", "/register/key", "/info", "/mcp", "/push", "/key/body"]) {
      const response = await protectRequest(
        new Request(`https://example.com${path}`),
        runtimeEnv(),
      );
      expect(response?.status).toBe(503);
    }
  });

  it("rejects a depleted allowance and limiter failures", async () => {
    const request = new Request("https://example.com/register", { method: "POST" });
    const denied = await protectRequest(
      request,
      runtimeEnv({
        REQUEST_LIMITER: { limit: vi.fn(async () => ({ success: false })) },
      }),
    );
    expect(denied?.status).toBe(429);
    expect(denied?.headers.get("Retry-After")).toBe("60");
    const failed = await protectRequest(
      request,
      runtimeEnv({
        REQUEST_LIMITER: {
          limit: vi.fn(async () => {
            throw new Error("offline");
          }),
        },
      }),
    );
    expect(failed?.status).toBe(503);
  });

  it("uses the trusted client IP and honors a configured prefix", async () => {
    const limit = vi.fn(async () => ({ success: true }));
    const env = runtimeEnv({ URL_PREFIX: "/api", REQUEST_LIMITER: { limit } });
    expect(await protectRequest(new Request("https://example.com/api/healthz"), env)).toBeNull();
    expect(limit).not.toHaveBeenCalled();
    expect(
      await protectRequest(
        new Request("https://example.com/api/register", {
          headers: { "cf-connecting-ip": "192.0.2.1" },
        }),
        env,
      ),
    ).toBeNull();
    expect(limit).toHaveBeenCalledWith({ key: "bark:192.0.2.1" });
  });
});
