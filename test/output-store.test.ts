import { describe, expect, it } from "bun:test"
import { OutputStore } from "../src/output-store.ts"

describe("OutputStore", () => {
  it("returns a full snapshot with reset=true on first read", () => {
    const store = new OutputStore()
    store.append("hello")

    expect(store.read(undefined)).toEqual({ revision: 5, reset: true, data: "hello" })
  })

  it("returns only the new bytes for a known revision", () => {
    const store = new OutputStore()
    store.append("hello")
    const first = store.read(undefined)
    store.append(" world")

    expect(store.read(first.revision)).toEqual({ revision: 11, reset: false, data: " world" })
  })

  it("returns an empty incremental read when already caught up", () => {
    const store = new OutputStore()
    store.append("hello")
    const snapshot = store.read(undefined)

    expect(store.read(snapshot.revision)).toEqual({ revision: 5, reset: false, data: "" })
  })

  it("bounds retained output to 512 KiB", () => {
    const store = new OutputStore()
    store.append("a".repeat(300 * 1024))
    store.append("b".repeat(300 * 1024))

    const snapshot = store.read(undefined)
    expect(Buffer.byteLength(snapshot.data, "utf8")).toBeLessThanOrEqual(512 * 1024)
    expect(snapshot.data.endsWith("b".repeat(100))).toBe(true)
  })

  it("signals reset when the requested revision has been trimmed away", () => {
    const store = new OutputStore()
    store.append("a".repeat(1024))
    const stale = store.read(undefined)
    store.append("b".repeat(600 * 1024))

    const snapshot = store.read(stale.revision)
    expect(snapshot.reset).toBe(true)
    expect(Buffer.byteLength(snapshot.data, "utf8")).toBeLessThanOrEqual(512 * 1024)
  })

  it("preserves UTF-8 boundaries when trimming a multi-byte character", () => {
    const store = new OutputStore()
    const emoji = "\u{1F600}" // 4 bytes in UTF-8
    store.append(emoji.repeat(150000)) // ~600000 bytes, over the 512 KiB limit

    const snapshot = store.read(undefined)
    expect(snapshot.data.includes("�")).toBe(false)
    expect(Buffer.byteLength(snapshot.data, "utf8") % 4).toBe(0)
  })
})
