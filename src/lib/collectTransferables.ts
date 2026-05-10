/**
 * Deep-scan a structured-clone-style tree and collect unique `ArrayBuffer` instances
 * for use with `postMessage(..., transferList)`. Skips `SharedArrayBuffer`.
 */
export function collectTransferables(value: unknown): Transferable[] {
  const seen = new Set<ArrayBuffer>();
  const out: ArrayBuffer[] = [];

  function walk(v: unknown): void {
    if (v === null || v === undefined) {
      return;
    }
    if (typeof v !== "object") {
      return;
    }
    if (ArrayBuffer.isView(v)) {
      const buf = v.buffer;
      if (buf instanceof SharedArrayBuffer) {
        return;
      }
      if (!seen.has(buf)) {
        seen.add(buf);
        out.push(buf);
      }
      return;
    }
    if (v instanceof ArrayBuffer) {
      if (!seen.has(v)) {
        seen.add(v);
        out.push(v);
      }
      return;
    }
    if (Array.isArray(v)) {
      for (const item of v) {
        walk(item);
      }
      return;
    }
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) {
      return;
    }
    for (const key of Object.keys(v as object)) {
      walk((v as Record<string, unknown>)[key]);
    }
  }

  walk(value);
  // One logical buffer must appear at most once: Deno/V8 rejects duplicate transfer entries
  // (second reference sees an already-detached ArrayBuffer).
  const deduped = [...new Set(out)];
  return deduped.filter((b) => b.byteLength > 0);
}
