// A stateless MCP server over streamable HTTP.
//
// Stateless is the whole trick here: every tool call is self-contained, so the
// server never issues a session id and any request can be answered by any
// isolate. That removes the need for Durable Objects, which is the usual reason
// an MCP server on Workers gets complicated.
import type { Env, Tool } from '../types.ts'
import { ToolError } from '../types.ts'

const SERVER_INFO = { name: 'easygroupflights', version: '1.0.0' }

// Newest first. We answer in the client's version when we speak it, which is
// what the spec asks for, and fall back to our newest when we do not.
const SUPPORTED_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05']

interface Request { jsonrpc: '2.0', id?: string | number | null, method: string, params?: any }

const ERROR = { parse: -32700, invalidRequest: -32600, methodNotFound: -32601, invalidParams: -32602, internal: -32603 }

function result(id: Request['id'], value: unknown) {
  return { jsonrpc: '2.0' as const, id, result: value }
}

function failure(id: Request['id'], code: number, message: string) {
  return { jsonrpc: '2.0' as const, id, error: { code, message } }
}

/**
 * The tool list shrinks when the fare service is unconfigured, and instructions
 * that name a withheld tool send the model somewhere it cannot go.
 */
function instructionsFor(tools: Tool[]) {
  const base = 'easygroupflights.com books group air travel. Parties of 10 or more get a negotiated '
    + 'group fare, which no public booking engine can price — use request_group_quote to put the '
    + 'enquiry in front of a human agent.'
  return tools.some(t => t.name === 'search_flights')
    ? `${base} Smaller parties are ordinary tickets: use search_flights.`
    : `${base} This server does not price smaller parties; send those to https://easygroupflights.com.`
}

async function handleMessage(message: Request, tools: Tool[], env: Env) {
  const { id, method, params } = message

  // Notifications carry no id and expect no reply of any kind.
  if (method.startsWith('notifications/'))
    return null

  switch (method) {
    case 'initialize': {
      const asked = params?.protocolVersion
      return result(id, {
        protocolVersion: SUPPORTED_PROTOCOLS.includes(asked) ? asked : SUPPORTED_PROTOCOLS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: instructionsFor(tools),
      })
    }

    case 'ping':
      return result(id, {})

    case 'tools/list':
      return result(id, {
        tools: tools.map(({ name, title, description, inputSchema }) => ({
          name,
          title,
          description,
          inputSchema,
        })),
      })

    case 'tools/call': {
      const tool = tools.find(t => t.name === params?.name)
      if (!tool)
        return failure(id, ERROR.methodNotFound, `Unknown tool: ${params?.name}`)

      try {
        const text = await tool.run(params?.arguments ?? {}, env)
        return result(id, { content: [{ type: 'text', text }] })
      }
      catch (error) {
        // A failing tool reports through an ok result with isError, not a
        // protocol error — that way the model sees the reason and can retry
        // with better arguments instead of the client swallowing it.
        const text = error instanceof ToolError
          ? error.message
          : `Sorry — that request could not be completed. ${error instanceof Error ? error.message : String(error)}`
        return result(id, { content: [{ type: 'text', text }], isError: true })
      }
    }

    default:
      return failure(id, ERROR.methodNotFound, `Unknown method: ${method}`)
  }
}

/** Handles one POST of the streamable-HTTP transport: a message, or a batch. */
export async function handleRpc(body: unknown, tools: Tool[], env: Env) {
  const batch = Array.isArray(body)
  const messages = (batch ? body : [body]) as Request[]

  if (!messages.length || messages.some(m => typeof m?.method !== 'string'))
    return { status: 400, payload: failure(null, ERROR.invalidRequest, 'Not a JSON-RPC message') }

  const replies = (await Promise.all(messages.map(m => handleMessage(m, tools, env)))).filter(Boolean)

  // Nothing but notifications: acknowledge with no content, per the transport.
  if (!replies.length)
    return { status: 202, payload: null }

  return { status: 200, payload: batch ? replies : replies[0] }
}

export { ERROR, SERVER_INFO, SUPPORTED_PROTOCOLS }
