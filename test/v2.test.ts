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
