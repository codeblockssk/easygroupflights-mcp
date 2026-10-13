import type { Env, Tool } from '../types.ts'
import { getOffer } from './get-offer.ts'
import { prepareGroupQuote, requestGroupQuote } from './group-quote.ts'
import { searchFlights } from './search-flights.ts'
import { getServiceInfo } from './service-info.ts'

// The one write is a pair: a read-only prepare that returns a confirmation
// token, and the write that acts only on it.
//
// 2.0 also had egf_prepare_flight_offer / egf_send_flight_offer, a pass-through
// of the fare service's agent-facing `sendoffer`. It emailed a branded offer,
// with the caller's own text, to any address — the directory review flagged
// it, and egf_get_offer already hands the traveller the booking link.
const ALL: Tool[] = [getServiceInfo, prepareGroupQuote, requestGroupQuote, searchFlights, getOffer]

/**
 * Tools that depend on the Pelikan endpoint are withheld while it is
 * unconfigured. Advertising a tool that cannot run is worse than not having it:
 * the model picks it, fails, and has no better move left.
 */
export function toolsFor(env: Env): Tool[] {
  return ALL.filter(tool => !tool.requiresPelikan || Boolean(env.PELIKAN_MCP_URL))
}

export { ALL as allTools }
