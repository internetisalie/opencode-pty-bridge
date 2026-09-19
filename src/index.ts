import type { PluginModule } from "@opencode-ai/plugin"
import { PTYPlugin } from "@internetisalie/opencode-pty"
import {
  registerRawOutputCallback,
  registerSessionUpdateCallback,
  removeRawOutputCallback,
  removeSessionUpdateCallback,
} from "@internetisalie/opencode-pty/plugin/pty/manager"
import type { PTYSessionInfo } from "@internetisalie/opencode-pty/plugin/pty/types"
import { createFetchHandler, type BridgeState } from "./http.js"
import { OutputStore } from "./output-store.js"

const plugin: PluginModule = {
  id: "opencode-pty-bridge",

  async server(input, _options) {
    const ptyHooks = await PTYPlugin(input)

    const stores = new Map<string, OutputStore>()
    let sessionsRevision = 0

    const onRawOutput = (session: PTYSessionInfo, rawData: string) => {
      let store = stores.get(session.id)
      if (!store) {
        store = new OutputStore()
        stores.set(session.id, store)
      }
      store.append(rawData)
    }

    const onSessionUpdate = (_session: PTYSessionInfo) => {
      sessionsRevision++
    }

    registerRawOutputCallback(onRawOutput)
    registerSessionUpdateCallback(onSessionUpdate)

    const state: BridgeState = { stores, sessionsRevision: () => sessionsRevision }

    return {
      ...ptyHooks,
      http: { fetch: createFetchHandler(state) },
      async dispose() {
        removeRawOutputCallback(onRawOutput)
        removeSessionUpdateCallback(onSessionUpdate)
        await ptyHooks.dispose?.()
      },
    }
  },
}

export default plugin
