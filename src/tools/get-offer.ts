import type { CallContext, Env, Tool } from '../types.ts'
import { decodeOffer, validUntil } from '../lib/offer.ts'
import { ToolError } from '../types.ts'

/**
 * Direct callers' links are tagged so a sale that started in an assistant can
 * be told apart. The gateway's calls are left untagged: it adds its own.
 */
export function tagLink(link: string, context: CallContext) {
  if (context.gateway)
    return link
  const url = new URL(link)
  url.searchParams.set('utm_source', 'mcp')
  return url.toString()
}

export const getOffer: Tool = {
  name: 'egf_get_offer',
  title: 'Get one flight offer',
  requiresPelikan: true,
  description:
    'Returns one fare from a recent flight search, by its offer_id: the per-person price, the '
    + 'flights, a booking link and the time until which the offer_id is valid. Works for 30 '
    + 'minutes after the search.',
  inputSchema: {
    type: 'object',
    required: ['offer_id'],
    properties: {
      offer_id: { type: 'string', description: 'offer_id of a fare, exactly as the flight search returned it.' },
    },
  },
  outputSchema: {
    type: 'object',
    required: ['offer_id', 'currency', 'carriers', 'flight_numbers', 'booking_url', 'valid_until'],
    properties: {
      offer_id: { type: 'string' },
      price: { type: 'number', description: 'Per person, in currency.' },
      currency: { type: 'string', description: 'ISO 4217 code.' },
      carriers: { type: 'array', items: { type: 'string' } },
      stops_out: { type: 'integer' },
      stops_back: { type: 'integer' },
      departure: { type: 'string', description: 'Local departure, ISO 8601 (YYYY-MM-DDTHH:MM).' },
      return: { type: 'string', description: 'Local return departure, ISO 8601 (YYYY-MM-DDTHH:MM).' },
      flight_numbers: { type: 'array', items: { type: 'string' } },
      booking_url: { type: 'string', description: 'Absolute https link where the traveller books this fare.' },
      valid_until: { type: 'string', description: 'ISO 8601 date-time. After it, search again: the price is live.' },
    },
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },

  async run(args: Record<string, unknown>, env: Env, context: CallContext) {
    const offerId = typeof args.offer_id === 'string' ? args.offer_id.trim() : ''
    if (!offerId)
      throw new ToolError('Missing offer_id. Pass the offer_id of a fare from a flight search.')

    // Everything comes from the offer_id itself, so this answers in whichever
    // data centre the call lands, with no second search.
    const offer = await decodeOffer(offerId, env)
    if (!offer.details || offer.issued === undefined)
      throw new ToolError('That offer_id comes from an older search that did not carry its details. Search again for current fares.')
    if (!offer.link)
      throw new ToolError('The fare service gave no booking link for this fare. Choose another, or ask for it to be emailed as an offer.')

    const details = offer.details
    const currency = env.FARE_CURRENCY ?? 'EUR'
    const structured = {
      offer_id: offerId,
      ...details,
      currency,
      booking_url: tagLink(offer.link, context),
      valid_until: validUntil(offer.issued),
    }

    return {
      text: [
        `${details.price ?? 'Price on request'} ${currency} per person — ${details.carriers.join(', ') || 'unknown carrier'}, flights ${details.flight_numbers.join(' / ') || 'n/a'}.`,
        `Departs ${details.departure ?? 'n/a'}${details.return ? `, returns ${details.return}` : ', one way'}.`,
        `Book: ${structured.booking_url}`,
        `This offer is valid until ${structured.valid_until}; after that, search again.`,
      ].join('\n'),
      structured,
    }
  },
}
