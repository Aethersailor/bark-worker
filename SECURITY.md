# Security policy

## Supported versions

Security fixes are applied to the current `main` branch. No older release line is currently maintained.

## Report a vulnerability

Do not open a public Issue for a suspected vulnerability. Use GitHub Private Vulnerability Reporting from the repository Security tab.

Include:

- affected route or component;
- reproduction steps;
- expected and observed behavior;
- possible impact;
- logs with device keys, tokens, credentials and notification content removed.

## Secret handling

Do not commit APNs private keys, Cloudflare API tokens, Basic Auth credentials, MCP session secrets, device keys or device tokens.

The Bark APNs signing key is published by the official upstream for self-hosting compatibility. This repository still handles it as a deployment secret and verifies its pinned upstream fingerprint before upload.
