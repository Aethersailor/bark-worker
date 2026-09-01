# Notices

## Finb/bark-server

`bark-worker` follows the public HTTP and APNs behavior of [`Finb/bark-server`](https://github.com/Finb/bark-server), which is distributed under the MIT License.

The initial compatibility target is commit `3df8990fcbc407a3f5638eea8cedc3289d1a405d`. The exact current target is stored in `upstream/UPSTREAM.lock.json`.

## frankwei98/bark-serverless

The initial TypeScript route, APNs, MCP and contract-test structure was derived from [`frankwei98/bark-serverless`](https://github.com/frankwei98/bark-serverless) at commit `e88044ea0fb3c33fa836471e6f417d0f1d5f3519`, which declares the MIT License.

This repository replaced its KV and Durable Object storage with D1, corrected registration and invalid-token behavior against `Finb/bark-server`, added quota controls, upstream verification, migration tools, CI/CD and deployment verification.

## Independence

This project is independently maintained and is not affiliated with Finb, Apple or Cloudflare. It does not include code from the GPL-3.0 project `cwxiaos/bark-worker`.
