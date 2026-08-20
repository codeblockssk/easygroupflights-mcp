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
   * Currency the fare service quotes in. It returns bare numbers with no
   * currency of their own, so this says what they mean.
   */
  FARE_CURRENCY?: string
  /** Secret. Sent as X-API-Key to AUTOPILOT_URL. */
  AUTOPILOT_API_KEY?: string
  /**
   * Secret. Streamable-HTTP endpoint of the Pelikan MCP server, which prices
   * parties below the group threshold. Unset simply disables those tools rather
   * than breaking the server.
   */
  PELIKAN_MCP_URL?: string
}

/** A JSON Schema object, as MCP requires for every tool's inputSchema. */
export type JsonSchema = Record<string, unknown>

export interface Tool {
  name: string
  title: string
  description: string
  inputSchema: JsonSchema
  /** Tools that need a Pelikan endpoint are hidden while it is unconfigured. */
  requiresPelikan?: boolean
  run: (args: Record<string, unknown>, env: Env) => Promise<string>
}

/** Thrown for anything the caller can fix by calling again with better input. */
export class ToolError extends Error {}
