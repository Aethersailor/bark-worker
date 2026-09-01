import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const lockPath = process.argv[2] ?? "upstream/UPSTREAM.lock.json";
const lock = JSON.parse(await readFile(lockPath, "utf8"));
const response = await fetch(
  `https://raw.githubusercontent.com/${lock.repository}/${lock.commit}/apns/apns_certs.go`,
  { headers: { "User-Agent": "Aethersailor-bark-worker-secret-sync" } },
);
if (!response.ok) {
  throw new Error(`failed to fetch upstream APNs key: ${response.status}`);
}
const source = await response.text();
const privateKey = source.match(/const apnsPrivateKey = `([\s\S]*?)`/)?.[1];
if (!privateKey) {
  throw new Error("unable to extract upstream APNs private key");
}
const digest = createHash("sha256").update(privateKey).digest("hex");
if (digest !== lock.contract?.apns?.privateKeySha256) {
  throw new Error("upstream APNs private key does not match the pinned fingerprint");
}
const outputIndex = process.argv.indexOf("--json-output");
if (outputIndex >= 0) {
  const outputPath = process.argv[outputIndex + 1];
  if (!outputPath) {
    throw new Error("--json-output requires a path");
  }
  await writeFile(outputPath, `${JSON.stringify({ APNS_PRIVATE_KEY: privateKey })}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
} else {
  process.stdout.write(privateKey);
}
