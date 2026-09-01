# Upstream policy

The only primary upstream is [`Finb/bark-server`](https://github.com/Finb/bark-server).

The project tracks:

- HTTP route registration and parameter precedence;
- response status and JSON shape;
- the database interface and invalid-token behavior;
- APNs topic, team ID, key ID, signing key fingerprint and payload limit;
- MCP endpoint and tool behavior;
- upstream tests and API documentation.

`Finb/Bark` is not an automatically tracked upstream. Client documentation may still be linked when it is the authoritative source for a user-facing Bark feature such as sounds.

Automated updates are fail-closed. Changes to semantic files require a compatibility review before deployment.
