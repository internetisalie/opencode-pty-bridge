# opencode-pty-bridge

Wraps [`opencode-pty`](https://github.com/shekohex/opencode-pty) and exposes its
sessions read-only over OpenCode's authenticated plugin HTTP routes, so a UI
(e.g. OpenChamber) can observe PTY sessions through the OpenCode server it is
already talking to — no separate listener, port, or callback token.

## Install

```json
{
  "plugin": ["opencode-pty-bridge"]
}
```

Do not also list `opencode-pty` — the bridge registers its tools for you.
Loading both registers duplicate `pty_*` tool IDs.

Requires an OpenCode server with plugin HTTP routes (`opencode >=1.18.31`).

## HTTP API

All routes are served under `/api/plugins/opencode-pty-bridge` and require
normal OpenCode authentication. There is no write surface: spawning, input,
resize, kill, and cleanup remain tool-only.

- `GET /` — capability probe. `404` means the bridge isn't installed.
- `GET /sessions` — current PTY sessions (running and exited).
- `GET /sessions/:id/output?after=<revision>` — raw output, either a full
  snapshot (`reset: true`) or the bytes appended since `after`. Retained
  output is bounded to 512 KiB per session.
