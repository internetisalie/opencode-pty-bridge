// @opencode-ai/plugin@1.18.31 on npm predates the plugin HTTP hook; this
// augments its types to match the (currently unreleased) contract in
// ../opencode. Drop this file once a published release includes `http`.
// The otherwise-unused import is required for TypeScript to treat this file
// as a module augmentation rather than a wholesale ambient module redeclaration.
import type {} from "@opencode-ai/plugin"

declare module "@opencode-ai/plugin" {
  interface PluginHttpHandler {
    readonly fetch: (request: Request) => Response | Promise<Response>
  }

  interface Hooks {
    http?: PluginHttpHandler
  }
}
