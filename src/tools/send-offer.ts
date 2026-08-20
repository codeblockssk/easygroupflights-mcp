import type { Env, Tool } from '../types.ts'
import { callPelikanTool } from '../lib/pelikan.ts'
import { email, optionalStr, str } from '../lib/validate.ts'

export const sendFlightOffer: Tool = {
  name: 'send_flight_offer',
  title: 'Email a flight offer',
  requiresPelikan: true,
  description:
    'Email one of the options returned by search_flights to the traveller as a formal offer they '
    + 'can accept. Requires the fare id, both trip ids and the session id exactly as search_flights '
    + 'reported them, plus the traveller\'s email address — ask for it first, and do not invent one. '
    + 'This sends a real email, so confirm the choice with the traveller before calling.',
  inputSchema: {
    type: 'object',
    required: ['fareId', 'thereTripId', 'backTripId', 'sessionId', 'email'],
    properties: {
      fareId: { type: 'string', description: 'fare_id from the search result.' },
      thereTripId: { type: 'string', description: 'there_trip_id from the search result.' },
      backTripId: { type: 'string', description: 'back_trip_id from the search result. "0" for a one-way fare.' },
      sessionId: { type: 'string', description: 'session_id from the same search. Ids are only valid within their session.' },
      email: { type: 'string', description: 'Where to send the offer.' },
      name: { type: 'string', description: 'Traveller\'s name, used to address the email.' },
      message: { type: 'string', description: 'A sentence or two of context for the traveller, e.g. why this option was chosen.' },
      adults: { type: 'integer', minimum: 1, description: 'Adults on the offer. Defaults to 1.' },
      children: { type: 'integer', minimum: 0, description: 'Children on the offer.' },
      infants: { type: 'integer', minimum: 0, description: 'Lap infants on the offer.' },
    },
  },

  async run(args: Record<string, unknown>, env: Env) {
    const address = email(args)
    const name = optionalStr(args, 'name') ?? 'Traveller'

    return callPelikanTool('sendoffer', {
      flight_id: str(args, 'fareId', 'the fare id', 'Use fare_id from a search_flights result.'),
      there_trip_id: str(args, 'thereTripId', 'the outbound trip id', 'Use there_trip_id from a search_flights result.'),
      back_trip_id: str(args, 'backTripId', 'the return trip id', 'Use back_trip_id from a search_flights result, or "0" for a one-way fare.'),
      session_id: str(args, 'sessionId', 'the search session id', 'Use the session id from the search_flights call that produced these ids — they are only valid within it.'),
      request_from_client: name,
      intro_addressing_customer: name,
      intro_email_customer: address,
      intro_text: optionalStr(args, 'message') ?? 'Here is the flight option we discussed.',
      // The offer arrives from easygroupflights, so the footer has to say so.
      footer_agent_name: 'easygroupflights.com',
      footer_agent_email: 'info@easygroupflights.com',
      footer_agent_phone: '+44 1244 568183',
      number_of_adults: Number(args.adults ?? 1),
      number_of_children: Number(args.children ?? 0),
      number_of_infants: Number(args.infants ?? 0),
    }, env).then(reply => `Offer sent to ${address}.\n\n${reply}`)
  },
}
