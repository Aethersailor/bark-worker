# Upstream policy

The only primary upstream is [`Finb/bark-server`](https://github.com/Finb/bark-server).

The project tracks:

- the exact upstream commit and source file hashes;
- route, database, APNs and MCP source files;
- upstream tests and API documentation.

`Finb/Bark` is not an automatically tracked upstream. Client documentation may still be linked when it is the authoritative source for a user-facing Bark feature such as sounds.

The scheduled workflow updates the upstream record directly. It does not automatically translate upstream Go changes into TypeScript.
