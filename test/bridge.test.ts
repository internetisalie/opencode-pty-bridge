import { afterEach, describe, expect, it } from "bun:test"
import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import {
  manager,
  rawOutputCallbacks,
  sessionUpdateCallbacks,
} from "@internetisalie/opencode-pty/plugin/pty/manager"
import plugin from "../src/index.ts"

function buildInput(): PluginInput {
  return {
    client: {} as PluginInput["client"],
    project: {} as PluginInput["project"],
    directory: "/tmp",
    worktree: "/tmp",
    experimental_workspace: { register: () => {} },
    serverUrl: new URL("http://localhost:4096"),
    $: undefined as unknown as PluginInput["$"],
  }
}

async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("waitFor timed out")
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

function fetchOf(hooks: Hooks) {
  const http = hooks.http
  if (!http) throw new Error("bridge did not register an http hook")
  return http.fetch
}

const disposers: Array<() => Promise<void>> = []
const spawnedIds: string[] = []

afterEach(async () => {
  while (disposers.length) await disposers.pop()!()
  while (spawnedIds.length) manager.kill(spawnedIds.pop()!, true)
})

async function createBridge() {
  const hooks = await plugin.server(buildInput())
  disposers.push(() => hooks.dispose?.() ?? Promise.resolve())
  return hooks
}

function spawn(command: string, args: string[]) {
  const info = manager.spawn({ command, args, parentSessionId: "test-parent" })
  spawnedIds.push(info.id)
  return info
}

describe("opencode-pty-bridge", () => {
  it("identifies itself at the root capability endpoint", async () => {
    const hooks = await createBridge()
    const response = await fetchOf(hooks)(new Request("http://bridge.local/"))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      id: "opencode-pty-bridge",
      schemaVersion: 1,
      opencodePtyVersion: "0.4.1",
    })
  })

  it("delegates the normal PTY tools exactly once", async () => {
    const hooks = await createBridge()

    expect(Object.keys(hooks.tool ?? {}).sort()).toEqual(["pty_kill", "pty_list", "pty_read", "pty_spawn", "pty_write"])
  })

  it("lists sessions from the same manager the tools use, including exited ones", async () => {
    const hooks = await createBridge()
    const running = spawn("sh", ["-c", "sleep 5"])
    const exited = spawn("sh", ["-c", "true"])

    await waitFor(() => manager.get(exited.id)?.status === "exited")

    const response = await fetchOf(hooks)(new Request("http://bridge.local/sessions"))
    const body = (await response.json()) as {
      sessions: Array<{ id: string; parentSessionId: string; status: string }>
    }

    const byId = new Map(body.sessions.map((session) => [session.id, session]))
    expect(byId.get(running.id)).toMatchObject({
      parentSessionId: "test-parent",
      status: "running",
    })
    expect(byId.get(exited.id)).toMatchObject({
      parentSessionId: "test-parent",
      status: "exited",
    })

    manager.kill(running.id, true)
  })

  it("supports a full snapshot followed by an incremental read", async () => {
    const hooks = await createBridge()
    const session = spawn("sh", ["-c", "printf part1; sleep 0.3; printf part2"])
    const fetch = fetchOf(hooks)

    await waitFor(() => (manager.getRawBuffer(session.id)?.raw ?? "").includes("part1"))
    const snapshot = await fetch(new Request(`http://bridge.local/sessions/${session.id}/output`))
    const first = (await snapshot.json()) as { revision: number; reset: boolean; data: string }
    expect(first.reset).toBe(true)
    expect(first.data).toContain("part1")

    await waitFor(() => (manager.getRawBuffer(session.id)?.raw ?? "").includes("part2"))
    const incremental = await fetch(
      new Request(`http://bridge.local/sessions/${session.id}/output?after=${first.revision}`),
    )
    const second = (await incremental.json()) as { revision: number; reset: boolean; data: string }
    expect(second.reset).toBe(false)
    expect(second.data).toContain("part2")
    expect(second.data).not.toContain("part1")
  })

  it("returns 404 for an unknown PTY", async () => {
    const hooks = await createBridge()
    const response = await fetchOf(hooks)(new Request("http://bridge.local/sessions/does-not-exist/output"))

    expect(response.status).toBe(404)
  })

  it("returns 404 for unknown paths and 405 for unsupported methods", async () => {
    const hooks = await createBridge()
    const fetch = fetchOf(hooks)

    expect((await fetch(new Request("http://bridge.local/nope"))).status).toBe(404)
    expect((await fetch(new Request("http://bridge.local/", { method: "POST" }))).status).toBe(405)
    expect((await fetch(new Request("http://bridge.local/sessions", { method: "DELETE" }))).status).toBe(405)
  })

  it("removes its manager callbacks on disposal", async () => {
    const before = rawOutputCallbacks.length
    const beforeUpdate = sessionUpdateCallbacks.length

    const hooks = await plugin.server(buildInput())
    expect(rawOutputCallbacks.length).toBe(before + 1)
    expect(sessionUpdateCallbacks.length).toBe(beforeUpdate + 1)

    await hooks.dispose?.()
    expect(rawOutputCallbacks.length).toBe(before)
    expect(sessionUpdateCallbacks.length).toBe(beforeUpdate)
  })

  it("does not multiply or leak callbacks across multiple instances", async () => {
    const before = rawOutputCallbacks.length

    const first = await createBridge()
    const second = await createBridge()
    expect(rawOutputCallbacks.length).toBe(before + 2)

    await first.dispose?.()
    expect(rawOutputCallbacks.length).toBe(before + 1)

    await second.dispose?.()
    expect(rawOutputCallbacks.length).toBe(before)
  })
})
