import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function checksumDevices(devices) {
  const hash = createHash("sha256");
  for (const item of devices) {
    hash.update(item.device_key);
    hash.update(Buffer.from([0]));
    hash.update(item.device_token);
    hash.update("\n");
  }
  return hash.digest("hex");
}

export function parseDeviceExport(contents) {
  const payload = JSON.parse(contents);
  if (payload.schema_version !== 1 || !Array.isArray(payload.devices)) {
    throw new Error("unsupported Bark device export");
  }
  if (payload.count !== payload.devices.length) {
    throw new Error("device export count does not match its device array");
  }

  const seen = new Set();
  const devices = [...payload.devices].sort((left, right) =>
    left.device_key.localeCompare(right.device_key),
  );
  for (const item of devices) {
    if (typeof item.device_key !== "string" || typeof item.device_token !== "string") {
      throw new Error("device export contains a non-string key or token");
    }
    if (item.device_key.length === 0 || seen.has(item.device_key)) {
      throw new Error("device export contains an empty or duplicate key");
    }
    seen.add(item.device_key);
  }
  if (checksumDevices(devices) !== payload.sha256) {
    throw new Error("device export checksum mismatch");
  }

  const timestamp = Math.floor(Date.parse(payload.generated_at) / 1000);
  if (!Number.isFinite(timestamp)) {
    throw new Error("device export contains an invalid generated_at timestamp");
  }
  return { devices, sha256: payload.sha256, timestamp };
}

export function deviceExportToSql(payload) {
  const quote = (value) => `'${value.replaceAll("'", "''")}'`;
  return payload.devices.map(
    (item) =>
      `INSERT INTO devices (device_key, device_token, created_at, updated_at) VALUES (${quote(item.device_key)}, ${quote(item.device_token)}, ${payload.timestamp}, ${payload.timestamp}) ON CONFLICT(device_key) DO UPDATE SET device_token = excluded.device_token, updated_at = excluded.updated_at;`,
  );
}

async function main() {
  const input = process.argv[2];
  const output = process.argv[3];
  if (!input || !output) {
    throw new Error("usage: device-export-to-d1.mjs <devices.json> <new-output.sql>");
  }

  const payload = parseDeviceExport(await readFile(input, "utf8"));
  const statements = deviceExportToSql(payload);
  await writeFile(output, `${statements.join("\n")}\n`, { encoding: "utf8", flag: "wx" });
  console.log(`generated D1 import statements=${statements.length} sha256=${payload.sha256}`);
}

const entrypoint = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (entrypoint === import.meta.url) {
  await main();
}
