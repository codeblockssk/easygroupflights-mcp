// Short-lived memory between otherwise stateless calls: replayed writes and
// later pages of a search. Built on the Workers Cache API rather than KV, so
// there is no namespace to provision — at the price of being per data centre.
// That fits both uses: a client retrying a write, or asking for the next page,
// does so seconds later from the same place, and so lands on the same cache.
//
// Outside a Worker (the test runner) there is no `caches`, and every read is a
// miss, which is the same answer an evicted entry gives.

// The Cache API keys on a URL, and only one on our own zone is kept.
const BASE = 'https://mcp.easygroupflights.com/__cache/'

function store(): Cache | null {
  return typeof caches === 'undefined' ? null : (caches as unknown as { default: Cache }).default
}

export async function remember(key: string, value: unknown, seconds: number) {
  await store()?.put(`${BASE}${key}`, new Response(JSON.stringify(value), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${seconds}` },
  }))
}

export async function recall<T>(key: string): Promise<T | null> {
  const hit = await store()?.match(`${BASE}${key}`)
  return hit ? hit.json() as Promise<T> : null
}

export async function sha256(text: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

/** Key order must not make two identical requests look different. */
export function canonical(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(',')}}`
  }
  return JSON.stringify(value)
}
