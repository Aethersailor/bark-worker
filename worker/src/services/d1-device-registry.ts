import { generateDeviceKey } from "@/services/device-key";
import type { DeviceRegistry } from "@/types";

const MAX_GENERATION_ATTEMPTS = 8;

interface CountRow {
  count: number;
}

interface TokenRow {
  device_token: string;
}

export class RegistrationRejectedError extends Error {}

export class D1DeviceRegistry implements DeviceRegistry {
  constructor(
    private readonly db: D1Database,
    private readonly now: () => number = () => Math.floor(Date.now() / 1000),
  ) {}

  async countAll(): Promise<number> {
    const row = await this.db.prepare("SELECT COUNT(*) AS count FROM devices").first<CountRow>();
    return Number(row?.count ?? 0);
  }

  async deviceTokenByKey(key: string): Promise<string> {
    const row = await this.db
      .prepare("SELECT device_token FROM devices WHERE device_key = ?1")
      .bind(key)
      .first<TokenRow>();

    if (!row) {
      throw new Error(`failed to get [${key}] device token from database`);
    }
    if (row.device_token.length === 0) {
      throw new Error("device token invalid");
    }
    return row.device_token;
  }

  async saveDeviceTokenByKey(
    key: string,
    token: string,
    policy: { allowNew: boolean; maxDevices: number },
  ): Promise<string> {
    const timestamp = this.now();

    if (key.length > 0) {
      const update = await this.db
        .prepare("UPDATE devices SET device_token = ?1, updated_at = ?2 WHERE device_key = ?3")
        .bind(token, timestamp, key)
        .run();
      if (update.meta.changes > 0) {
        return key;
      }
    }

    if (!policy.allowNew) {
      throw new RegistrationRejectedError("new device registration is disabled");
    }

    for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt++) {
      const generatedKey = generateDeviceKey();
      const insert = await this.db
        .prepare(
          `INSERT INTO devices (device_key, device_token, created_at, updated_at)
           SELECT ?1, ?2, ?3, ?3
           WHERE (SELECT COUNT(*) FROM devices) < ?4
           ON CONFLICT(device_key) DO NOTHING`,
        )
        .bind(generatedKey, token, timestamp, policy.maxDevices)
        .run();

      if (insert.meta.changes > 0) {
        return generatedKey;
      }

      if ((await this.countAll()) >= policy.maxDevices) {
        throw new RegistrationRejectedError(`device limit reached: ${policy.maxDevices}`);
      }
    }

    throw new Error("failed to generate a unique device key");
  }

  async deleteDeviceByKey(key: string, expectedToken?: string): Promise<boolean> {
    const statement =
      expectedToken === undefined
        ? this.db
            .prepare("UPDATE devices SET device_token = '', updated_at = ?1 WHERE device_key = ?2")
            .bind(this.now(), key)
        : this.db
            .prepare(
              "UPDATE devices SET device_token = '', updated_at = ?1 WHERE device_key = ?2 AND device_token = ?3",
            )
            .bind(this.now(), key, expectedToken);

    const result = await statement.run();
    return result.meta.changes > 0;
  }
}
