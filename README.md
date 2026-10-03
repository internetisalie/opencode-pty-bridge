# @internetisalie/opencode-pty-bridge

Wraps [`@internetisalie/opencode-pty`](https://github.com/internetisalie/opencode-pty) and exposes its
sessions read-only over OpenCode's authenticated plugin HTTP routes, so a UI
(e.g. OpenChamber) can observe PTY sessions through the OpenCode server it is
already talking to — no separate listener, port, or callback token.

## Install

Configure npm for GitHub Packages:

```ini
@internetisalie:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

Use a `read:packages` token only for the one-shot install:

```bash
NODE_AUTH_TOKEN="$(gh auth token)" \
  opencode-internetisalie plugin @internetisalie/opencode-pty-bridge@0.1.1 --global
```

Do not pass `NODE_AUTH_TOKEN` to a long-running OpenCode process or service;
agent subprocesses inherit the server environment. OpenCode loads the installed
package from its versioned cache without the token. The resulting config entry
is:

```json
{
  "plugin": ["@internetisalie/opencode-pty-bridge@0.1.1"]
}
```

Do not also list `@internetisalie/opencode-pty` - the bridge registers its tools for you.
Loading both registers duplicate `pty_*` tool IDs.

Requires an OpenCode server with plugin HTTP routes (`opencode >=1.18.31`).

## OpenCode v2

The v1 entry point above uses the old `opencode-pty` manager. OpenCode v2 instead
uses native persistent PTYs. Install the `./v2` export alongside the v2 PTY
tool plugin and point both at the same OpenCode server:

```json
{
  "plugins": [
    {
      "package": "/path/to/opencode-pty-bridge-v2",
      "options": { "serverUrl": "http://127.0.0.1:4097" }
    }
  ]
}
```

The package directory must expose the compiled `./v2` entry point from
`server.js`. The adapter uses `OPENCODE_SERVER_PASSWORD` for its read-only
loopback requests, or `serverPassword` in plugin options. It preserves the
existing OpenChamber bridge routes and response schema. V2 output is a rendered
PTY snapshot, returned as a full reset on each poll; it is not the v1 raw byte
stream. A scoped list uses one native session request instead of enumerating
every OpenCode session. V2 does not provide `notifyOnExit` or `timeoutSeconds`, so those fields
are reported as false and absent. A backend failure returns 503 rather than an
empty session list.

## HTTP API

All routes are served under `/api/plugins/opencode-pty-bridge` and require
normal OpenCode authentication. There is no write surface: spawning, input,
resize, kill, and cleanup remain tool-only.

- `GET /` — capability probe. `404` means the bridge isn't installed.
- `GET /sessions` — current PTY sessions (running and exited). The v2 adapter
  accepts `?parentSessionId=<OpenCode session ID>` to request only that session's
  PTYs. An empty filter returns 400; omitting it preserves the global list.
- `GET /sessions/:id/output?after=<revision>` — raw output, either a full
  snapshot (`reset: true`) or the bytes appended since `after`. Retained
  output is bounded to 512 KiB per session.
