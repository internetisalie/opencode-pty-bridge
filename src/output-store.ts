const MAX_RETAINED_BYTES = 512 * 1024

function isUtf8ContinuationByte(byte: number): boolean {
  return (byte & 0xc0) === 0x80
}

/**
 * UTF-8 chunks from the PTY are only ever appended and trimmed at chunk
 * boundaries elsewhere, but a single chunk can itself exceed the retention
 * limit, so trimming has to walk forward off an arbitrary byte offset to the
 * next codepoint boundary.
 */
function trimToByteLimit(data: string, maxBytes: number): { data: string; trimmedBytes: number } {
  const buffer = Buffer.from(data, "utf8")
  if (buffer.byteLength <= maxBytes) return { data, trimmedBytes: 0 }

  let cut = buffer.byteLength - maxBytes
  while (cut < buffer.byteLength && isUtf8ContinuationByte(buffer[cut]!)) cut++

  return { data: buffer.subarray(cut).toString("utf8"), trimmedBytes: cut }
}

export type OutputSnapshot = {
  revision: number
  reset: boolean
  data: string
}

/**
 * Bounded, revision-tracked view over a single PTY's raw output. `revision`
 * is the byte offset (in the session's lifetime output stream) after the
 * most recent append, so a client's last-seen revision can be compared
 * directly against `startOffset` to decide whether an incremental read is
 * still possible or the retention window has moved past it.
 */
export class OutputStore {
  private data = ""
  private startOffset = 0
  private totalWritten = 0

  append(chunk: string): void {
    if (!chunk) return
    this.data += chunk
    this.totalWritten += Buffer.byteLength(chunk, "utf8")

    const trimmed = trimToByteLimit(this.data, MAX_RETAINED_BYTES)
    if (trimmed.trimmedBytes > 0) {
      this.data = trimmed.data
      this.startOffset += trimmed.trimmedBytes
    }
  }

  read(after: number | undefined): OutputSnapshot {
    if (after === undefined || after < this.startOffset) {
      return { revision: this.totalWritten, reset: true, data: this.data }
    }

    const sliceStart = after - this.startOffset
    const data = Buffer.from(this.data, "utf8").subarray(sliceStart).toString("utf8")
    return { revision: this.totalWritten, reset: false, data }
  }
}
