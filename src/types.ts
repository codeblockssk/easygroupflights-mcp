export interface Env {
  /** Where the human-facing site lives; used in tool output and on the landing page. */
  SITE_URL: string
  /**
   * Secret. Group-request intake; leads land in the CRM and an agent quotes them
   * by hand. A secret rather than a var only so this repo can be public.
   */
  AUTOPILOT_URL?: string
  /** Party size at which a booking stops being individual seats and becomes a group. */
  GROUP_MIN_PASSENGERS: string
  /**
   * Ghost Content API keys for the English and Polish blogs, used to serve the
   * published studies as resources. Read-only and public by design — Ghost
   * prints them into every blog page for its search widget.
   */
  GHOST_CONTENT_KEY_EN?: string
  GHOST_CONTENT_KEY_PL?: string
  /**
   * Currency the fare service quotes in. It returns bare numbers with no
   * currency of their own, so this says what they mean.
   */
  FARE_CURRENCY?: string
  /** Secret. Signs the confirmation tokens that two-step writes act on. */
  CONFIRM_SECRET?: string
  /**
   * Secret. The Tripdesk gateway's service token. A request carrying it is the
   * gateway's call; one without it is a direct caller. Not a gate: the server
   * is public, so both are served, under different rate limits.
   */
  GATEWAY_TOKEN?: string
  /** Rate limits (Workers rate-limiting bindings): per address for direct callers, one shared budget for the gateway. */
  DIRECT_LIMIT?: RateLimit
  GATEWAY_LIMIT?: RateLimit
  /** Secret. Sent as X-API-Key to AUTOPILOT_URL. */
  AUTOPILOT_API_KEY?: string
  /**
   * Secret. Streamable-HTTP endpoint of the Pelikan MCP server, which prices
   * parties below the group threshold. Unset simply disables those tools rather
   * than breaking the server.
   */
  PELIKAN_MCP_URL?: string
}

export interface RateLimit {
  limit: (options: { key: string }) => Promise<{ success: boolean }>
}

/** Who is calling. Only the gateway's calls are tagged by the gateway itself. */
export interface CallContext {
  gateway: boolean
}

/** A JSON Schema object, as MCP requires for every tool's inputSchema. */
export type JsonSchema = Record<string, unknown>

/**
 * Every hint is set explicitly, even where it matches the spec's default. A
 * client that has to infer `destructiveHint` from a missing field assumes the
 * worst, and asks the user to approve a read as if it could delete something.
 */
export interface ToolAnnotations {
  readOnlyHint: boolean
  destructiveHint: boolean
  idempotentHint: boolean
  openWorldHint: boolean
}

/**
 * What a tool hands back: prose for the model to read, and the same facts as
 * data matching the tool's `outputSchema`, for a client that wants to render or
 * act on them without parsing sentences.
 */
export interface ToolOutput {
  text: string
  structured: Record<string, unknown>
}

export interface Tool {
  name: string
  /**
   * Names the tool answered to before it was prefixed. Callable, never listed,
   * so a client that remembers the old name still reaches it.
   */
  aliases?: string[]
  title: string
  description: string
  inputSchema: JsonSchema
  outputSchema: JsonSchema
  annotations: ToolAnnotations
  /** Tools that need a Pelikan endpoint are hidden while it is unconfigured. */
  requiresPelikan?: boolean
  /**
   * Writes that take an `idempotency_key`: a repeated call with the same key
   * and the same arguments returns the first result instead of acting twice.
   */
  idempotent?: boolean
  run: (args: Record<string, unknown>, env: Env, context: CallContext) => Promise<ToolOutput>
}

/** Thrown for anything the caller can fix by calling again with better input. */
export class ToolError extends Error {}
