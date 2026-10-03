import { expect, test } from 'bun:test'
import { createV2Bridge } from '../src/v2.ts'

test('v2 bridge lists native PTYs and returns a resettable read-only snapshot', async () => {
  const requests: string[] = []
  const fetcher = async (input: string | Request | URL) => {
    const path = new URL(String(input)).pathname
    requests.push(path)
    if (path === '/api/session') return Response.json({ data: [{ id: 'ses_one' }], cursor: {} })
    if (path === '/api/experimental/session/ses_one/terminal') {
      return Response.json({ data: [{
        id: 'pty_one', sessionID: 'ses_one', title: 'Writer watch', command: 'supervisor',
        args: ['attach'], cwd: '/workspace', status: 'running', pid: 42,
      }] })
    }
    if (path === '/api/experimental/persistent-pty/pty_one/snapshot') {
      return Response.json({ data: { info: { id: 'pty_one' }, text: 'ready\nnext row\r\nlast row' } })
    }
    throw new Error(`Unexpected ${path}`)
  }
  const bridge = createV2Bridge({ serverUrl: 'http://127.0.0.1:4097', fetch: fetcher })
  const capability = await bridge(new Request('http://bridge/'))
  expect(await capability.json()).toMatchObject({ id: 'opencode-pty-bridge' })
  const list = await bridge(new Request('http://bridge/sessions'))
  const snapshot = await list.json()
  expect(snapshot).toMatchObject({
    sessions: [{
      id: 'pty_one', parentSessionId: 'ses_one', status: 'running', createdAt: expect.any(String),
    }],
  })
  const output = await bridge(new Request('http://bridge/sessions/pty_one/output'))
  expect(await output.json()).toMatchObject({ schemaVersion: 1, reset: true, data: 'ready\r\nnext row\r\nlast row' })
  expect(requests).toContain('/api/experimental/session/ses_one/terminal')
})

test('a backend failure is not presented as an empty PTY list', async () => {
  const bridge = createV2Bridge({
    serverUrl: 'http://127.0.0.1:4097',
    fetch: async () => new Response('unavailable', { status: 503 }),
  })
  const result = await bridge(new Request('http://bridge/sessions'))
  expect(result.status).toBe(503)
})

const terminal = (sessionID: string) => ({
  id: `pty_${sessionID}`, sessionID, title: 'Idle shell', command: 'sh',
  args: [], cwd: '/workspace', status: 'running', pid: 42,
})

test('a scoped list makes one native request and never enumerates sessions', async () => {
  const requests: string[] = []
  const bridge = createV2Bridge({
    serverUrl: 'http://127.0.0.1:4097',
    fetch: async (input) => {
      const path = new URL(String(input)).pathname
      requests.push(path)
      if (path !== '/api/experimental/session/ses_one/terminal') throw new Error('Unexpected global scan')
      return Response.json({ data: [terminal('ses_one')] })
    },
  })
  const result = await bridge(new Request('http://bridge/sessions?parentSessionId=ses_one'))
  expect(result.status).toBe(200)
  expect(await result.json()).toMatchObject({ sessions: [{ parentSessionId: 'ses_one' }] })
  expect(requests).toEqual(['/api/experimental/session/ses_one/terminal'])
})

test('scoped disappearance does not reset creation metadata for another session', async () => {
  let empty = false
  const bridge = createV2Bridge({
    serverUrl: 'http://127.0.0.1:4097',
    fetch: async (input) => {
      const id = new URL(String(input)).pathname.split('/').at(-2)!
      return Response.json({ data: empty && id === 'ses_two' ? [] : [terminal(id)] })
    },
  })
  const list = async (id: string) => {
    const response = await bridge(new Request(`http://bridge/sessions?parentSessionId=${id}`))
    const body = await response.text()
    return /"createdAt":"([^"]+)"/.exec(body)?.[1]
  }
  const one = await list('ses_one')
  const two = await list('ses_two')
  expect(one).toEqual(expect.any(String))
  expect(two).toEqual(expect.any(String))
  await Bun.sleep(5)
  empty = true
  expect(await list('ses_two')).toBeUndefined()
  expect(await list('ses_one')).toEqual(one)
  empty = false
  expect(await list('ses_two')).not.toBe(two)
})

test('scoped failure stays a failure, and an empty filter does not trigger a global scan', async () => {
  let calls = 0
  const bridge = createV2Bridge({
    serverUrl: 'http://127.0.0.1:4097',
    fetch: async () => { calls++; return new Response(null, { status: 503 }) },
  })
  expect((await bridge(new Request('http://bridge/sessions?parentSessionId=ses_one'))).status).toBe(503)
  expect((await bridge(new Request('http://bridge/sessions?parentSessionId='))).status).toBe(400)
  expect(calls).toBe(1)
})

test('unscoped callers still receive every page of sessions', async () => {
  const bridge = createV2Bridge({
    serverUrl: 'http://127.0.0.1:4097',
    fetch: async (input) => {
      const url = new URL(String(input))
      if (url.pathname === '/api/session') {
        return Response.json(url.searchParams.has('cursor')
          ? { data: [{ id: 'ses_two' }], cursor: {} }
          : { data: [{ id: 'ses_one' }], cursor: { next: 'page-two' } })
      }
      return Response.json({ data: [terminal(url.pathname.split('/').at(-2)!)] })
    },
  })
  const result = await bridge(new Request('http://bridge/sessions'))
  expect(await result.json()).toMatchObject({ sessions: [{ id: 'pty_ses_one' }, { id: 'pty_ses_two' }] })
})
