// A stateless MCP server over streamable HTTP.
//
// Stateless is the whole trick here: every tool call is self-contained, so the
// server never issues a session id and any request can be answered by any
// isolate. That removes the need for Durable Objects, which is the usual reason
// an MCP server on Workers gets complicated.
import type { CallContext, Env, Tool } from '../types.ts'
import { getPrompt, listPrompts } from '../prompts.ts'
import { listResources, readResource } from '../resources.ts'
import { ToolError } from '../types.ts'
import { runOnce } from './idempotency.ts'

/**
 * Before 2.0 the inputs were camelCase (departureDate, fareId). A client that
 * still sends them is read as if it had sent departure_date, fare_id; a
 * snake_case key given alongside wins.
 */
export function snakeKeys(args: Record<string, unknown>) {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(args)) {
    const snake = key.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`)
    if (snake === key || !(snake in args))
      out[snake] = value
  }
  return out
}

const SERVER_INFO = { name: 'easygroupflights', version: '2.0.0' }

// Newest first. We answer in the client's version when we speak it, which is
// what the spec asks for, and fall back to our newest when we do not.
const SUPPORTED_PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']

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
    + 'group fare, which no public booking engine can price: egf_prepare_group_quote checks the brief, '
    + 'and egf_request_group_quote sends it to a human agent once the user has confirmed the summary.'
  const small = tools.some(t => t.name === 'egf_search_flights')
    ? `${base} Smaller parties are ordinary tickets: egf_search_flights finds them, egf_get_offer gives `
    + 'one fare\'s booking link, and egf_prepare_flight_offer then egf_send_flight_offer email it as an offer.'
    : `${base} This server does not price smaller parties; send those to https://easygroupflights.com.`
  return `${small} The guides and published studies are available as resources — quote those rather than `
    + 'figures from memory. Prompts such as school-trip and wedding-guests walk the user through a complete brief.'
}

async function handleMessage(message: Request, tools: Tool[], env: Env, context: CallContext) {
  const { id, method, params } = message

  // Notifications carry no id and expect no reply of any kind.
  if (method.startsWith('notifications/'))
    return null

  switch (method) {
    case 'initialize': {
      const asked = params?.protocolVersion
      return result(id, {
        protocolVersion: SUPPORTED_PROTOCOLS.includes(asked) ? asked : SUPPORTED_PROTOCOLS[0],
        capabilities: { tools: { listChanged: false }, resources: { listChanged: false }, prompts: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: instructionsFor(tools),
      })
    }

    case 'ping':
      return result(id, {})

    case 'tools/list':
      return result(id, {
        tools: tools.map(({ name, title, description, inputSchema, outputSchema, annotations }) => ({
          name,
          title,
          description,
          inputSchema,
          outputSchema,
          // The title twice: top level is the current spec, `annotations.title`
          // the older place that the Connectors Directory portal still reads.
          annotations: { title, ...annotations },
        })),
      })

    case 'tools/call': {
      const tool = tools.find(t => t.name === params?.name || t.aliases?.includes(params?.name))
      if (!tool)
        return failure(id, ERROR.methodNotFound, `Unknown tool: ${params?.name}`)

      try {
        const { text, structured } = await withDeadline(runOnce(tool, snakeKeys(params?.arguments ?? {}), env, context))
        // Both: the prose is what a model reads best, the structured copy is
        // what a client validates against outputSchema and renders.
        return result(id, { content: [{ type: 'text', text }], structuredContent: structured })
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

    case 'resources/list':
      return result(id, { resources: await listResources(env) })

    case 'resources/templates/list':
      return result(id, { resourceTemplates: [] })

    case 'resources/read': {
      const uri = String(params?.uri ?? '')
      const text = await readResource(uri, env)
      if (text === null)
        return failure(id, ERROR.invalidParams, `Unknown resource: ${uri}`)
      return result(id, { contents: [{ uri, mimeType: 'text/markdown', text }] })
    }

    case 'prompts/list':
      return result(id, { prompts: listPrompts() })

    case 'prompts/get': {
      const prompt = getPrompt(String(params?.name ?? ''), params?.arguments)
      if (!prompt)
        return failure(id, ERROR.invalidParams, `Unknown prompt: ${params?.name}`)
      return result(id, prompt)
    }

    default:
      return failure(id, ERROR.methodNotFound, `Unknown method: ${method}`)
  }
}

// Callers time out at 30 seconds, the gateway included. Answering with an
// error a little before that beats leaving them with nothing.
const DEADLINE_MS = 28_000

function withDeadline<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ToolError('That took too long to answer. Please try again in a moment.')), DEADLINE_MS)
  })
  return Promise.race([work, late]).finally(() => timer && clearTimeout(timer))
}

/** Handles one POST of the streamable-HTTP transport: a message, or a batch. */
export async function handleRpc(body: unknown, tools: Tool[], env: Env, context: CallContext = { gateway: false }) {
  const batch = Array.isArray(body)
  const messages = (batch ? body : [body]) as Request[]

  if (!messages.length || messages.some(m => typeof m?.method !== 'string'))
    return { status: 400, payload: failure(null, ERROR.invalidRequest, 'Not a JSON-RPC message') }

  const replies = (await Promise.all(messages.map(m => handleMessage(m, tools, env, context)))).filter(Boolean)

  // Nothing but notifications: acknowledge with no content, per the transport.
  if (!replies.length)
    return { status: 202, payload: null }

  return { status: 200, payload: batch ? replies : replies[0] }
}

export { ERROR, SERVER_INFO, SUPPORTED_PROTOCOLS }
