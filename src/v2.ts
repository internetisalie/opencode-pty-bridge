/** Read-only OpenCode v2 adapter for the existing OpenChamber PTY bridge. */

type NativePty = {
  id: string
  sessionID: string
  title: string
  command: string
  args: string[]
  cwd: string
  status: "running" | "exited"
  pid: number
  exitCode?: number
}

type Transport = (input: string | Request | URL, init?: RequestInit) => Promise<Response>

type Options = {
  serverUrl: string
  password?: string
  fetch?: Transport
}

const schemaVersion = 1
const outputPath = /^\/sessions\/(pty_[^/]+)\/output$/

function json(body: unknown, status = 200) {
  return Response.json(body, { status })
}

function server(options: Options) {
  const base = new URL(options.serverUrl)
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.pathname !== '/' || base.search || base.hash) {
    throw new Error('PTY bridge serverUrl must be an HTTP origin without credentials')
  }
  const send = options.fetch ?? fetch
  const headers = new Headers()
  if (options.password) headers.set('authorization', `Basic ${Buffer.from(`opencode:${options.password}`).toString('base64')}`)
  return async <T>(path: string): Promise<T> => {
    const response = await send(new URL(path, base), { headers })
    if (!response.ok) throw new Error(`OpenCode PTY request failed (${response.status})`)
    return (await response.json()) as T
  }
}

export function createV2Bridge(options: Options) {
  const get = server(options)
  const created = new Map<string, { createdAt: string; sessionID: string }>()
  let sessionsRevision = 0
  let sessionsSignature = ''
  const outputs = new Map<string, { revision: number; text: string }>()

  const terminals = async (parentSessionId?: string) => {
    if (parentSessionId !== undefined) {
      const result = await get<{ data: NativePty[] }>(`api/experimental/session/${encodeURIComponent(parentSessionId)}/terminal`)
      return result.data
    }
    const sessions: string[] = []
    let cursor: string | undefined
    for (let page = 0; page < 1000; page++) {
      const query = new URLSearchParams({ limit: '100' })
      if (cursor) query.set('cursor', cursor)
      const result = await get<{ data: { id: string }[]; cursor: { next?: string } }>(`api/session?${query}`)
      sessions.push(...result.data.map((item) => item.id))
      cursor = result.cursor.next
      if (!cursor) break
      if (page === 999) throw new Error('PTY bridge session scan exceeded 1000 pages')
    }
    const found: NativePty[] = []
    for (let offset = 0; offset < sessions.length; offset += 8) {
      const batch = await Promise.all(sessions.slice(offset, offset + 8).map(async (id) => {
        const result = await get<{ data: NativePty[] }>(`api/experimental/session/${encodeURIComponent(id)}/terminal`)
        return result.data
      }))
      found.push(...batch.flat())
    }
    return found
  }

  const list = async (parentSessionId?: string) => {
    const items = await terminals(parentSessionId)
    const signature = JSON.stringify(items)
    if (signature !== sessionsSignature) {
      sessionsSignature = signature
      sessionsRevision++
    }
    const now = new Date().toISOString()
    for (const item of items) if (!created.has(item.id)) created.set(item.id, { createdAt: now, sessionID: item.sessionID })
    const ids = new Set(items.map((item) => item.id))
    for (const [id, entry] of created) {
      if ((parentSessionId === undefined || entry.sessionID === parentSessionId) && !ids.has(id)) created.delete(id)
    }
    return {
      schemaVersion,
      revision: sessionsRevision,
      sessions: items.map((item) => ({
        id: item.id,
        parentSessionId: item.sessionID,
        title: item.title,
        command: item.command,
        args: item.args,
        workdir: item.cwd,
        status: item.status,
        notifyOnExit: false,
        timedOut: false,
        ...(item.exitCode === undefined ? {} : { exitCode: item.exitCode }),
        pid: item.pid,
        createdAt: created.get(item.id)?.createdAt,
        lineCount: 0,
      })),
    }
  }

  return async function handle(request: Request): Promise<Response> {
    if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405)
    const url = new URL(request.url)
    try {
      if (url.pathname === '/') return json({ id: 'opencode-pty-bridge', schemaVersion, opencodePtyVersion: '0.5.0' })
      if (url.pathname === '/sessions') {
        const parentSessionId = url.searchParams.get('parentSessionId')
        if (parentSessionId !== null && !parentSessionId.trim()) return json({ error: 'parentSessionId must not be empty' }, 400)
        return json(await list(parentSessionId ?? undefined))
      }
      const match = outputPath.exec(url.pathname)
      if (!match) return json({ error: 'Not found' }, 404)
      const id = match[1]!
      const snapshot = await get<{ data: { info: NativePty; text: string } }>(
        `api/experimental/persistent-pty/${encodeURIComponent(id)}/snapshot`,
      )
      const current = outputs.get(id)
      const revision = current?.text === snapshot.data.text ? current.revision : (current?.revision ?? 0) + 1
      outputs.set(id, { revision, text: snapshot.data.text })
      // Snapshot text contains physical rows separated by LF, rather than raw
      // PTY bytes. Terminal renderers need CR+LF to start each row at column zero.
      const data = snapshot.data.text.replace(/\r?\n/g, '\r\n')
      return json({ schemaVersion, revision, reset: true, data })
    } catch {
      // A failed scan must not masquerade as an authoritative empty list.
      return json({ error: 'PTY bridge backend unavailable' }, 503)
    }
  }
}

const plugin = {
  id: 'opencode-pty-bridge',
  async setup(ctx: {
    options: { serverUrl?: string; serverPassword?: string }
    http: { register: (handler: { fetch: (request: Request) => Promise<Response> }) => Promise<{ dispose: () => Promise<void> }> }
  }) {
    const serverUrl = ctx.options.serverUrl ?? process.env.OPENCODE_PTY_SERVER_URL
    if (!serverUrl) throw new Error('OpenCode v2 PTY bridge requires serverUrl or OPENCODE_PTY_SERVER_URL')
    const handler = createV2Bridge({
      serverUrl,
      password: ctx.options.serverPassword ?? process.env.OPENCODE_SERVER_PASSWORD,
    })
    const registration = await ctx.http.register({ fetch: handler })
    return () => registration.dispose()
  },
}

export default plugin
