/** Account-local RAM spool for short gateway outages; no message bodies in diagnostics. */
export function createInboundQueue({
  maxItems = 500, maxBytes = 8 * 1024 * 1024, maxAgeMs = 10 * 60_000,
  now = Date.now, onDrop = () => {},
} = {}) {
  const entries = new Map();
  let bytes = 0;
  let closed = false;
  let draining = null;
  const remove = (key) => { bytes -= entries.get(key).bytes; entries.delete(key); };
  const drop = (key, reason) => {
    remove(key);
    try { onDrop(reason); } catch { /* diagnostics must not block delivery */ }
  };
  const prune = () => {
    const cutoff = now() - maxAgeMs;
    for (const [key, entry] of entries) if (entry.at <= cutoff) drop(key, 'expired');
  };
  return {
    get size() { prune(); return entries.size; },
    enqueue(payload) {
      if (closed) return false;
      prune();
      const id = payload.id || payload.cliMsgId;
      const key = id ? JSON.stringify([payload.threadType, payload.threadId, payload.senderUid, id]) : Symbol();
      if (entries.has(key)) return true;
      const data = JSON.stringify(payload);
      const size = Buffer.byteLength(data);
      if (size > maxBytes) {
        try { onDrop('oversized'); } catch { /* metadata only */ }
        return false;
      }
      while (entries.size >= maxItems || bytes + size > maxBytes) drop(entries.keys().next().value, 'capacity');
      entries.set(key, { data, bytes: size, at: now() });
      bytes += size;
      return true;
    },
    drain(send) {
      if (draining) return draining;
      draining = (async () => {
        while (!closed) {
          prune();
          const [key, entry] = entries.entries().next().value || [];
          if (!entry) break;
          let delivered = false;
          try { delivered = await send(entry.data); } catch { /* keep the head for reconnect */ }
          if (!delivered) break;
          if (entries.get(key) === entry) remove(key);
        }
      })().finally(() => { draining = null; });
      return draining;
    },
    close() { closed = true; entries.clear(); bytes = 0; },
  };
}
