import type { Env } from './types.ts'
import { homepage } from './lib/homepage.ts'
import { handleRpc, SERVER_INFO, SUPPORTED_PROTOCOLS } from './lib/protocol.ts'
import { toolsFor } from './tools/index.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization, Mcp-Session-Id, MCP-Protocol-Version',
  'Access-Control-Expose-Headers': 'Mcp-Session-Id, MCP-Protocol-Version',
  'Access-Control-Max-Age': '86400',
}

function json(body: unknown, status = 200) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (request.method === 'OPTIONS')
      return new Response(null, { status: 204, headers: CORS })

    if (url.pathname === '/mcp') {
      // We never open a server-initiated stream, so there is nothing to GET.
      // The transport allows saying so with 405.
      if (request.method !== 'POST')
        return json({ error: 'Use POST for MCP messages.' }, 405)

      let body: unknown
      try {
        body = await request.json()
      }
      catch {
        return json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400)
      }

      const { status, payload } = await handleRpc(body, toolsFor(env), env)
      return json(payload, status)
    }

    // Lets a directory or a client confirm what this is without speaking MCP.
    if (url.pathname === '/.well-known/mcp.json') {
      return json({
        ...SERVER_INFO,
        description: 'Group flight quotes for parties of 10 or more, from easygroupflights.com.',
        homepage: env.SITE_URL,
        endpoint: `${url.origin}/mcp`,
        transport: 'streamable-http',
        protocolVersions: SUPPORTED_PROTOCOLS,
        tools: toolsFor(env).map(t => ({ name: t.name, title: t.title })),
      })
    }

    // Reports which back ends are wired up. Group quoting fails closed when the
    // intake is unconfigured, which is safe but silent — this makes it visible
    // without submitting an enquiry to find out.
    if (url.pathname === '/health') {
      return json({
        ok: true,
        tools: toolsFor(env).length,
        groupQuote: Boolean(env.AUTOPILOT_URL && env.AUTOPILOT_API_KEY),
        fareSearch: Boolean(env.PELIKAN_MCP_URL),
      })
    }

    if (url.pathname === '/') {
      return new Response(homepage(env, url.origin), {
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' },
      })
    }

    return json({ error: 'Not found' }, 404)
  },
}
