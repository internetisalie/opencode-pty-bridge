import { manager } from "@internetisalie/opencode-pty/plugin/pty/manager"
import { OutputStore } from "./output-store.js"

const SCHEMA_VERSION = 1
const OPENCODE_PTY_VERSION = "0.4.1"
const OUTPUT_PATH = /^\/sessions\/([^/]+)\/output$/

export type BridgeState = {
  stores: Map<string, OutputStore>
  sessionsRevision: () => number
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function notFound(): Response {
  return json({ error: "Not found" }, 404)
}

function methodNotAllowed(allow: string[]): Response {
  return new Response(JSON.stringify({ error: "Method not allowed" }), {
    status: 405,
    headers: { "content-type": "application/json", allow: allow.join(", ") },
  })
}

function parseAfter(raw: string | null): number | undefined {
  if (raw === null) return undefined
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0) return undefined
  return value
}

function capability() {
  return {
    id: "opencode-pty-bridge",
    schemaVersion: SCHEMA_VERSION,
    opencodePtyVersion: OPENCODE_PTY_VERSION,
  }
}

function sessionsList(state: BridgeState) {
  return {
    schemaVersion: SCHEMA_VERSION,
    revision: state.sessionsRevision(),
    sessions: manager.list(),
  }
}

function sessionOutput(state: BridgeState, id: string, after: number | undefined): Response {
  if (!manager.get(id)) {
    state.stores.delete(id)
    return notFound()
  }

  let store = state.stores.get(id)
  if (!store) {
    store = new OutputStore()
    const seed = manager.getRawBuffer(id)
    if (seed) store.append(seed.raw)
    state.stores.set(id, store)
  }

  return json({ schemaVersion: SCHEMA_VERSION, ...store.read(after) })
}

export function createFetchHandler(state: BridgeState) {
  return async function fetch(request: Request): Promise<Response> {
    const { pathname, searchParams } = new URL(request.url)

    if (pathname === "/") {
      if (request.method !== "GET") return methodNotAllowed(["GET"])
      return json(capability())
    }

    if (pathname === "/sessions") {
      if (request.method !== "GET") return methodNotAllowed(["GET"])
      return json(sessionsList(state))
    }

    const match = OUTPUT_PATH.exec(pathname)
    if (match) {
      if (request.method !== "GET") return methodNotAllowed(["GET"])
      return sessionOutput(state, decodeURIComponent(match[1]!), parseAfter(searchParams.get("after")))
    }

    return notFound()
  }
}
