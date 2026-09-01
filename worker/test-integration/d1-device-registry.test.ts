import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { D1DeviceRegistry, RegistrationRejectedError } from "@/services/d1-device-registry";

const CREATE_SCHEMA = `CREATE TABLE devices (
  device_key TEXT PRIMARY KEY,
  device_token TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) WITHOUT ROWID`;

describe("D1DeviceRegistry", () => {
  beforeEach(async () => {
    await env.DB.prepare("DROP TABLE IF EXISTS devices").run();
    await env.DB.prepare(CREATE_SCHEMA).run();
  });

  it("generates a new key for an unknown caller-supplied key", async () => {
    const registry = new D1DeviceRegistry(env.DB, () => 100);
    const key = await registry.saveDeviceTokenByKey("untrusted-alias", "token-a", {
      allowNew: true,
      maxDevices: 16,
    });

    expect(key).not.toBe("untrusted-alias");
    expect(key).toHaveLength(22);
    await expect(registry.deviceTokenByKey(key)).resolves.toBe("token-a");
  });

  it("updates an existing key without changing it", async () => {
    const registry = new D1DeviceRegistry(env.DB, () => 100);
    const key = await registry.saveDeviceTokenByKey("", "token-a", {
      allowNew: true,
      maxDevices: 16,
    });

    await expect(
      registry.saveDeviceTokenByKey(key, "token-b", {
        allowNew: false,
        maxDevices: 16,
      }),
    ).resolves.toBe(key);
    await expect(registry.deviceTokenByKey(key)).resolves.toBe("token-b");
  });

  it("rejects new registrations in existing-only mode", async () => {
    const registry = new D1DeviceRegistry(env.DB);
    await expect(
      registry.saveDeviceTokenByKey("", "token", {
        allowNew: false,
        maxDevices: 16,
      }),
    ).rejects.toBeInstanceOf(RegistrationRejectedError);
  });

  it("enforces the device cap atomically", async () => {
    const registry = new D1DeviceRegistry(env.DB);
    await registry.saveDeviceTokenByKey("", "token-a", {
      allowNew: true,
      maxDevices: 1,
    });

    await expect(
      registry.saveDeviceTokenByKey("", "token-b", {
        allowNew: true,
        maxDevices: 1,
      }),
    ).rejects.toThrow("device limit reached: 1");
    await expect(registry.countAll()).resolves.toBe(1);
  });

  it("preserves the key while invalidating the matching token", async () => {
    const registry = new D1DeviceRegistry(env.DB);
    const key = await registry.saveDeviceTokenByKey("", "token-a", {
      allowNew: true,
      maxDevices: 16,
    });

    await expect(registry.deleteDeviceByKey(key, "other-token")).resolves.toBe(false);
    await expect(registry.deviceTokenByKey(key)).resolves.toBe("token-a");
    await expect(registry.deleteDeviceByKey(key, "token-a")).resolves.toBe(true);
    await expect(registry.deviceTokenByKey(key)).rejects.toThrow("device token invalid");
    await expect(registry.countAll()).resolves.toBe(1);
  });

  it("returns the upstream-compatible missing-key error", async () => {
    const registry = new D1DeviceRegistry(env.DB);
    await expect(registry.deviceTokenByKey("missing")).rejects.toThrow(
      "failed to get [missing] device token from database",
    );
  });
});
