import type { Env, Tool } from '../types.ts'
import { getOffer } from './get-offer.ts'
import { prepareGroupQuote, requestGroupQuote } from './group-quote.ts'
import { searchFlights } from './search-flights.ts'
import { prepareFlightOffer, sendFlightOffer } from './send-offer.ts'
import { getServiceInfo } from './service-info.ts'

// Each write is a pair: a read-only prepare that returns a confirmation token,
// and the write that acts only on it.
const ALL: Tool[] = [getServiceInfo, prepareGroupQuote, requestGroupQuote, searchFlights, getOffer, prepareFlightOffer, sendFlightOffer]

/**
 * Tools that depend on the Pelikan endpoint are withheld while it is
 * unconfigured. Advertising a tool that cannot run is worse than not having it:
 * the model picks it, fails, and has no better move left.
 */
export function toolsFor(env: Env): Tool[] {
  return ALL.filter(tool => !tool.requiresPelikan || Boolean(env.PELIKAN_MCP_URL))
}

export { ALL as allTools }
