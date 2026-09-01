import assert from "node:assert/strict";
import { test } from "node:test";

import { checksumDevices, deviceExportToSql, parseDeviceExport } from "../device-export-to-d1.mjs";

function fixture() {
  const devices = [
    { device_key: "alpha", device_token: "token'a" },
    { device_key: "beta", device_token: "" },
  ];
  return JSON.stringify({
    schema_version: 1,
    generated_at: "2026-09-01T00:00:00Z",
    count: devices.length,
    sha256: checksumDevices(devices),
    devices,
  });
}

test("validates the export and emits escaped D1 statements", () => {
  const parsed = parseDeviceExport(fixture());
  const statements = deviceExportToSql(parsed);
  assert.equal(statements.length, 2);
  assert.match(statements[0], /'alpha', 'token''a'/);
  assert.match(statements[0], /1788220800/);
  assert.match(statements[1], /ON CONFLICT\(device_key\) DO UPDATE/);
});

test("rejects a checksum mismatch", () => {
  const payload = JSON.parse(fixture());
  payload.sha256 = "0".repeat(64);
  assert.throws(() => parseDeviceExport(JSON.stringify(payload)), /checksum mismatch/);
});

test("rejects duplicate keys", () => {
  const payload = JSON.parse(fixture());
  payload.devices.push(payload.devices[0]);
  payload.count = payload.devices.length;
  payload.sha256 = checksumDevices(payload.devices);
  assert.throws(() => parseDeviceExport(JSON.stringify(payload)), /empty or duplicate key/);
});
