import type { CallContext, Env, Tool, ToolOutput } from '../types.ts'
import { ToolError } from '../types.ts'
import { canonical, recall, remember, sha256 } from './cache.ts'

const DAY = 86_400

/** The same wording on every write that accepts a key. */
export const IDEMPOTENCY_KEY = {
  type: 'string',
  maxLength: 128,
  description: 'Optional. Any unique string for this request, such as a UUID. Calling again with the same key and the same arguments returns the first result instead of sending again. Kept for 24 hours.',
}

interface Stored { fingerprint: string, output: ToolOutput }

/**
 * Runs a write at most once per key. The key is scoped to the tool, and bound
 * to the arguments it first came with: the same key with different arguments
 * is a client bug, and answering it with the first result would hide one
 * request behind another.
 *
 * Without an explicit key, the confirmation token is the key: one prepared
 * write is carried out once, however often the token is sent back.
 */
export async function runOnce(tool: Tool, args: Record<string, unknown>, env: Env, context: CallContext): Promise<ToolOutput> {
  const explicit = typeof args.idempotency_key === 'string' ? args.idempotency_key.trim() : ''
  const key = explicit || (typeof args.confirmation_token === 'string' ? `token:${args.confirmation_token}` : '')
  if (!tool.idempotent || !key)
    return tool.run(args, env, context)

  const { idempotency_key: _, ...rest } = args
  const fingerprint = await sha256(canonical(rest))
  const slot = `idempotency/${tool.name}/${await sha256(key)}`

  const earlier = await recall<Stored>(slot)
  if (earlier) {
    if (earlier.fingerprint !== fingerprint)
      throw new ToolError('That idempotency_key was already used for a different request. Use a new key for a new request.')
    return earlier.output
  }

  const output = await tool.run(args, env, context)
  await remember(slot, { fingerprint, output } satisfies Stored, DAY)
  return output
}
