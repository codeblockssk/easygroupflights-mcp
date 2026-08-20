// Submits a group enquiry to the same intake the website's search widget posts
// to. There is deliberately no pricing here: a group fare is negotiated with
// the airline, so the honest output is a confirmed enquiry and a callback, not
// a number.
import type { Env } from '../types.ts'
import type { Market } from './markets.ts'
import { ToolError } from '../types.ts'
import { leadSource } from './markets.ts'

export interface GroupRequest {
  market: Market
  email: string
  phoneNumber: string
  firstName?: string
  lastName?: string
  note?: string
  cabinClass: 'economy' | 'business'
  cityOrigin: string[]
  cityDestination: string[]
  cityOriginBacktrip: string[]
  cityDestinationBacktrip: string[]
  dateDepartureThere: string
  dateDepartureBack?: string
  passengers: {
    adults: number
    youths: number
    children: number
    infants: number
    youthsAge: number[]
    childrenAge: number[]
  }
  daysRange: number
}

/**
 * Autopilot only processes a `source` it recognises, so the marker separating an
 * MCP enquiry from a web-form one has to travel in the note instead. It goes at
 * the front so it survives truncation and sorts together.
 */
export function markNote(note?: string) {
  return note ? `MCP: ${note}` : 'MCP'
}

/** Shapes the request exactly as the widget does, so both land identically. */
export function buildPayload(request: GroupRequest) {
  const { market, ...rest } = request
  return { ...rest, source: leadSource(market) }
}

export async function submitGroupRequest(request: GroupRequest, env: Env) {
  if (!env.AUTOPILOT_URL || !env.AUTOPILOT_API_KEY)
    throw new ToolError('The quote service is not configured on this server. Please contact easygroupflights.com directly.')

  const response = await fetch(env.AUTOPILOT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': env.AUTOPILOT_API_KEY },
    body: JSON.stringify(buildPayload(request)),
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new ToolError(
      `The enquiry could not be submitted (${response.status}). `
      + `Please try again, or write to info@easygroupflights.com.${detail ? ` Detail: ${detail.slice(0, 200)}` : ''}`,
    )
  }

  return response.json().catch(() => ({}))
}
