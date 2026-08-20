// A thin MCP client that forwards a tool call to the Pelikan MCP server, which
// already knows how to price ordinary tickets. Below the group threshold we
// have nothing to add, so we ask it rather than reimplementing its search.
import type { Env } from '../types.ts'
import { ToolError } from '../types.ts'

const PROTOCOL_VERSION = '2025-06-18'
const CLIENT_INFO = { name: 'easygroupflights-mcp', version: '1.0.0' }

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

async function post(url: string, message: unknown, session: Session = {}) {
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
    response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(message) })
  }
  catch {
    // The upstream being down is an operational fact, not something the caller
    // mistyped — say so plainly and point at the path that still works.
    throw new ToolError(
      'The live fare service cannot be reached right now. Please try again shortly. '
      + 'Group enquiries of 10 or more are unaffected — request_group_quote still works.',
    )
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new ToolError(`The flight search service is unavailable (${response.status}).${detail ? ` ${detail.slice(0, 200)}` : ''}`)
  }

  return {
    message: await readMessage(response),
    session: {
      id: response.headers.get('mcp-session-id') ?? session.id,
      cookies: collectCookies(response, session.cookies),
    } satisfies Session,
  }
}

/**
 * Calls one tool on the Pelikan server. The handshake is repeated per call
 * because this worker holds no state between requests; the cost is two extra
 * round trips against a service that is already doing a live fare search.
 */
export async function callPelikanTool(name: string, args: Record<string, unknown>, env: Env): Promise<string> {
  const url = env.PELIKAN_MCP_URL
  if (!url)
    throw new ToolError('Live fare search is not enabled on this server. For parties of 10 or more use request_group_quote, which is fully available.')

  const init = await post(url, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT_INFO },
  })

  const session = init.session
  await post(url, { jsonrpc: '2.0', method: 'notifications/initialized' }, session).catch(() => {})

  const { message } = await post(url, {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: { name, arguments: args },
  }, session)

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
