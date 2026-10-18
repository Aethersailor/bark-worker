import { readFile } from "node:fs/promises";

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
process.stdout.write(privateKey);
