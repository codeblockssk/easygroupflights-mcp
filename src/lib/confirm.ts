// Two-step writes. A prepare tool validates a write and returns what will be
// sent, with a short-lived token; the write tool acts only on that token. Not
// every client asks the user before a write, so the server cannot rely on the
// client having shown anything — the token is proof that the exact summary
// was produced, and the model is told to show it before using the token.
//
// The token carries the validated request itself, signed, so the write needs
// no storage and cannot act on anything the summary did not show. It is
// signed, not encrypted: it holds only what the caller just sent.
import type { Env } from '../types.ts'
import { ToolError } from '../types.ts'

const TTL_SECONDS = 15 * 60

/** The same wording on every write that takes a token. */
export const CONFIRMATION_TOKEN = {
  type: 'string',
  description: 'confirmation_token returned when this write was prepared. Valid for 15 minutes.',
}

const encoder = new TextEncoder()

function toBase64Url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text: string) {
  return Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))
}

async function key(env: Env) {
  if (!env.CONFIRM_SECRET)
    throw new ToolError('Sending is not configured on this server. Please contact easygroupflights.com directly.')
  return crypto.subtle.importKey('raw', encoder.encode(env.CONFIRM_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

/** A short HMAC over `text`, for handles a caller must not be able to forge. */
export async function signature(text: string, env: Env) {
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', await key(env), encoder.encode(text)))
  return toBase64Url(mac.slice(0, 16))
}

export async function issueToken(action: string, data: unknown, env: Env) {
  const expires = Math.floor(Date.now() / 1000) + TTL_SECONDS
  const body = toBase64Url(encoder.encode(JSON.stringify({ a: action, d: data, e: expires })))
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', await key(env), encoder.encode(body)))
  return { token: `ct_${body}.${toBase64Url(signature)}`, expiresAt: new Date(expires * 1000).toISOString() }
}

export async function redeemToken<T>(action: string, token: unknown, env: Env): Promise<T> {
  const invalid = new ToolError('That confirmation_token is not valid. Prepare the request again and use the token it returns, unchanged.')
  if (typeof token !== 'string' || !token.startsWith('ct_'))
    throw new ToolError('Missing confirmation_token. Prepare the request first, show the user its summary, and pass the token it returns.')

  const [body, signature] = token.slice(3).split('.')
  if (!body || !signature)
    throw invalid

  let ok = false
  try {
    ok = await crypto.subtle.verify('HMAC', await key(env), fromBase64Url(signature), encoder.encode(body))
  }
  catch (error) {
    if (error instanceof ToolError)
      throw error
  }
  if (!ok)
    throw invalid

  const { a, d, e } = JSON.parse(new TextDecoder().decode(fromBase64Url(body)))
  if (a !== action)
    throw new ToolError('That confirmation_token was prepared for a different action.')
  if (e < Date.now() / 1000)
    throw new ToolError('That confirmation_token has expired. Prepare the request again and confirm it with the user.')
  return d as T
}
