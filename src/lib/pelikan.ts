// A thin MCP client that forwards a tool call to the Pelikan MCP server, which
// already knows how to price ordinary tickets. Below the group threshold we
// have nothing to add, so we ask it rather than reimplementing its search.
import type { Env } from '../types.ts'
import { ToolError } from '../types.ts'

const PROTOCOL_VERSION = '2025-06-18'
const CLIENT_INFO = { name: 'easygroupflights-mcp', version: '1.0.1' }

/**
 * Streamable HTTP allows either a plain JSON body or an SSE stream carrying the
 * same message, and FastMCP picks the stream. Both have to be understood.
 */
async function readMessage(response: Response) {
  const body = await response.text()
  if (!body)
    return null

  if (!response.headers.get('content-type')?.includes('text/event-stream'))
    return JSON.parse(body)

  // Take the last `data:` payload that parses — that is the reply to our call.
  let message = null
  for (const line of body.split('\n')) {
    if (!line.startsWith('data:'))
      continue
    try {
      message = JSON.parse(line.slice(5).trim())
    }
    catch {}
  }
  return message
}

/**
 * The upstream sits behind a load balancer that pins a session to one backend
 * with a SERVERID cookie. The handshake and the call are separate requests, so
 * without carrying that cookie the call can land on a machine that has never
 * heard of the session — it works right up until the moment it doesn't.
 */
function collectCookies(response: Response, existing?: string) {
  const list = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean) as string[]

  const jar = new Map<string, string>()
  for (const pair of (existing ?? '').split('; ').filter(Boolean)) {
    const [name, ...rest] = pair.split('=')
    jar.set(name, rest.join('='))
  }
  for (const header of list) {
    const [name, ...rest] = header.split(';')[0].split('=')
    if (name)
      jar.set(name.trim(), rest.join('='))
  }
  return [...jar].map(([name, value]) => `${name}=${value}`).join('; ')
}

interface Session { id?: string, cookies?: string }

async function post(url: string, message: unknown, session: Session = {}, timeoutMs = 10_000) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
    'MCP-Protocol-Version': PROTOCOL_VERSION,
  }
  if (session.id)
    headers['Mcp-Session-Id'] = session.id
  if (session.cookies)
    headers.Cookie = session.cookies

  let response: Response
  try {
    response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(message), signal: AbortSignal.timeout(Math.max(timeoutMs, 1_000)) })
  }
  catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError'))
      throw new ToolError('The live fare service took too long to answer. Please try again in a moment, or try other dates.')
    // The upstream being down is an operational fact, not something the caller
    // mistyped — say so plainly and point at the path that still works.
    throw new ToolError(
      'The live fare service cannot be reached right now. Please try again shortly. '
      + 'Group enquiries of 10 or more are unaffected — egf_request_group_quote still works.',
    )
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    // Which step failed, and with what session state — never the URL, which is a secret.
    console.warn(`pelikan ${(message as { method?: string }).method} -> ${response.status} session=${Boolean(session.id)} cookies=${(session.cookies ?? '').split('; ').filter(Boolean).map(c => c.split('=')[0]).join(',') || 'none'} body=${detail.slice(0, 120)}`)
    const error = new ToolError(`The flight search service is unavailable (${response.status}).${detail ? ` ${detail.slice(0, 200)}` : ''}`)
    throw Object.assign(error, { status: response.status })
  }

  let reply
  try {
    reply = await readMessage(response)
  }
  catch (error) {
    // The timeout also covers reading the body, which a slow search streams.
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError'))
      throw new ToolError('The live fare service took too long to answer. Please try again in a moment, or try other dates.')
    throw error
  }

  return {
    message: reply,
    session: {
      id: response.headers.get('mcp-session-id') ?? session.id,
      cookies: collectCookies(response, session.cookies),
    } satisfies Session,
  }
}

// The whole exchange has to fit inside the 28 seconds a tool call is allowed.
// The handshake is quick or broken, so it gets a short leash; the tool calls
// share whatever is left, because a live fare search is the slow part.
const BUDGET_MS = 25_000
const HANDSHAKE_MS = 5_000
const INIT_ATTEMPTS = 4

function text(message: any) {
  if (message?.error)
    throw new ToolError(`Flight search failed: ${message.error.message ?? 'unknown error'}`)

  const content = message?.result?.content
  if (!Array.isArray(content) || !content.length)
    throw new ToolError('The flight search returned nothing usable. Please try different dates or airports.')

  return content
    .filter((part: any) => part?.type === 'text')
    .map((part: any) => part.text)
    .join('\n')
    .trim()
}

/**
 * Opens one session on the Pelikan server for several tool calls. The
 * handshake is done once per tool call of ours, not once per upstream call: a
 * search is two upstream calls, and repeating the handshake for each cost two
 * round trips of the time a caller waits.
 */
export async function openPelikan(env: Env) {
  const url = env.PELIKAN_MCP_URL
  if (!url)
    throw new ToolError('Live fare search is not enabled on this server. For parties of 10 or more use egf_request_group_quote, which is fully available.')

  const deadline = Date.now() + BUDGET_MS
  const left = () => deadline - Date.now()

  // About half of all fresh connections were answered 404 with an empty body,
  // on initialize itself — before any session exists, so it is not ours to
  // lose. It looks like one bad backend behind the upstream's load balancer.
  // A first request carries no state and fails in ~100 ms, so asking again
  // until a healthy backend answers is safe and cheap.
  let init: Awaited<ReturnType<typeof post>> | undefined
  for (let attempt = 1; !init; attempt++) {
    try {
      init = await post(url, {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT_INFO },
      }, {}, Math.min(HANDSHAKE_MS, left()))
    }
    catch (error) {
      if ((error as { status?: number }).status !== 404 || attempt >= INIT_ATTEMPTS || left() < HANDSHAKE_MS)
        throw error
    }
  }

  let session = init.session
  await post(url, { jsonrpc: '2.0', method: 'notifications/initialized' }, session, Math.min(HANDSHAKE_MS, left())).catch(() => {})

  let id = 2
  return {
    async call(name: string, args: Record<string, unknown>): Promise<string> {
      // The load balancer may refresh its pinning cookie on any reply.
      const reply = await post(url, { jsonrpc: '2.0', id: id++, method: 'tools/call', params: { name, arguments: args } }, session, left())
      session = reply.session
      return text(reply.message)
    },
  }
}

/** One tool call on the Pelikan server, handshake included. */
export async function callPelikanTool(name: string, args: Record<string, unknown>, env: Env): Promise<string> {
  return (await openPelikan(env)).call(name, args)
}
