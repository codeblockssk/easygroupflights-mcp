import type { OfferIds } from '../lib/offer.ts'
import type { Env, Tool } from '../types.ts'
import { CONFIRMATION_TOKEN, issueToken, redeemToken } from '../lib/confirm.ts'
import { IDEMPOTENCY_KEY } from '../lib/idempotency.ts'
import { decodeOffer, encodeOffer } from '../lib/offer.ts'
import { callPelikanTool } from '../lib/pelikan.ts'
import { email, int, optionalStr, str } from '../lib/validate.ts'
import { ToolError } from '../types.ts'
import { fare, savedSearch } from './search-flights.ts'

const ACTION = 'flight_offer'

/** What the token carries: the exact email that will be sent, nothing to look up later. */
interface OfferEmail {
  offerId: string
  ids: OfferIds
  address: string
  name: string
  message: string
  adults: number
  children: number
  infants: number
}

/**
 * Before 2.0 the search printed the four upstream ids and this took them one
 * by one. A client still holding ids from then is answered, not refused.
 */
function legacyIds(args: Record<string, unknown>): OfferIds {
  if (!optionalStr(args, 'fare_id'))
    throw new ToolError('Missing offer_id. Pass the offer_id of the chosen fare from a flight search.')
  return {
    fare: str(args, 'fare_id', 'the fare id'),
    there: str(args, 'there_trip_id', 'the outbound trip id'),
    back: str(args, 'back_trip_id', 'the return trip id'),
    session: str(args, 'session_id', 'the search session id'),
  }
}

export const prepareFlightOffer: Tool = {
  name: 'egf_prepare_flight_offer',
  title: 'Prepare a flight offer email',
  requiresPelikan: true,
  description:
    'Checks an email that would send one fare from a flight search to the traveller as a formal '
    + 'offer, and returns who it goes to and what it offers, with a confirmation_token valid for 15 '
    + 'minutes. Nothing is sent.',
  inputSchema: {
    type: 'object',
    required: ['offer_id', 'email'],
    properties: {
      offer_id: { type: 'string', description: 'offer_id of the chosen fare, exactly as the flight search returned it.' },
      email: { type: 'string', description: 'Where to send the offer.' },
      name: { type: 'string', description: 'Traveller\'s name, used to address the email.' },
      message: { type: 'string', description: 'A sentence or two of context for the traveller, e.g. why this option was chosen.' },
      adults: { type: 'integer', minimum: 1, description: 'Adults on the offer. Defaults to 1.' },
      children: { type: 'integer', minimum: 0, description: 'Children on the offer.' },
      infants: { type: 'integer', minimum: 0, description: 'Lap infants on the offer.' },
    },
  },
  outputSchema: {
    type: 'object',
    required: ['offer_id', 'email', 'name', 'adults', 'children', 'infants', 'confirmation_token', 'expires_at'],
    properties: {
      offer_id: { type: 'string' },
      email: { type: 'string', description: 'Where the offer would go.' },
      name: { type: 'string' },
      adults: { type: 'integer' },
      children: { type: 'integer' },
      infants: { type: 'integer' },
      price: { type: 'number', description: 'Per person, when the search is still held.' },
      carriers: { type: 'array', items: { type: 'string' } },
      departure: { type: 'string', description: 'Local departure, ISO 8601 (YYYY-MM-DDTHH:MM).' },
      confirmation_token: { type: 'string', description: 'Authorises sending exactly this email.' },
      expires_at: { type: 'string', description: 'ISO 8601 date-time after which the token is refused.' },
    },
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },

  async run(args: Record<string, unknown>, env: Env) {
    const given = optionalStr(args, 'offer_id')
    const ids = given ? decodeOffer(given) : legacyIds(args)
    const request: OfferEmail = {
      offerId: given ?? encodeOffer(ids),
      ids: { fare: ids.fare, there: ids.there, back: ids.back, session: ids.session },
      address: email(args),
      name: optionalStr(args, 'name') ?? 'Traveller',
      message: optionalStr(args, 'message') ?? 'Here is the flight option we discussed.',
      adults: Math.max(int(args, 'adults', 1), 1),
      children: int(args, 'children'),
      infants: int(args, 'infants'),
    }

    // The summary names the fare when the search is still cached; the email
    // goes out either way, since the upstream holds the fare, not us.
    const search = await savedSearch(ids.session)
    const flight = search?.flights.find(f => String(f.fare_id) === ids.fare && String(f.there_trip_id) === ids.there)
    const details = flight ? fare(flight, 0, ids.session, search!.issued) : {}

    const { token, expiresAt } = await issueToken(ACTION, request, env)
    const party = `${request.adults} adult${request.adults === 1 ? '' : 's'}${request.children ? `, ${request.children} children` : ''}${request.infants ? `, ${request.infants} infants` : ''}`

    return {
      text: [
        'Ready to email this offer. Not sent yet.',
        '',
        `  To        ${request.name} <${request.address}>`,
        `  Fare      ${details.price !== undefined ? `${details.price} ${env.FARE_CURRENCY ?? 'EUR'} per person, ` : ''}${(details.carriers as string[] | undefined)?.join(', ') ?? request.offerId}`,
        details.departure ? `  Departs   ${details.departure}` : '',
        `  Party     ${party}`,
        `  Message   ${request.message}`,
        '',
        `Show this to the user. Once they confirm, send it with confirmation_token ${token} (valid until ${expiresAt}).`,
      ].filter(Boolean).join('\n'),
      structured: {
        offer_id: request.offerId,
        email: request.address,
        name: request.name,
        adults: request.adults,
        children: request.children,
        infants: request.infants,
        ...(details.price !== undefined ? { price: details.price } : {}),
        ...(details.carriers ? { carriers: details.carriers } : {}),
        ...(details.departure ? { departure: details.departure } : {}),
        confirmation_token: token,
        expires_at: expiresAt,
      },
    }
  },
}

export const sendFlightOffer: Tool = {
  name: 'egf_send_flight_offer',
  aliases: ['send_flight_offer'],
  title: 'Email a flight offer',
  requiresPelikan: true,
  description:
    'Emails a prepared flight offer to the traveller as a formal offer they can accept. Takes only '
    + 'the confirmation_token from preparing it, and sends a real email.',
  inputSchema: {
    type: 'object',
    required: ['confirmation_token'],
    properties: {
      confirmation_token: CONFIRMATION_TOKEN,
      idempotency_key: IDEMPOTENCY_KEY,
    },
  },
  outputSchema: {
    type: 'object',
    required: ['status', 'email', 'offer_id', 'reply'],
    properties: {
      status: { type: 'string', enum: ['sent'] },
      email: { type: 'string', description: 'Where the offer went.' },
      offer_id: { type: 'string' },
      reply: { type: 'string', description: 'The fare service\'s own confirmation.' },
    },
  },
  // Each call is another email in the traveller's inbox, so it is not
  // idempotent by itself; the token (or an idempotency_key) makes a retry a replay.
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  idempotent: true,

  async run(args: Record<string, unknown>, env: Env) {
    if (args.confirmation_token === undefined && (args.offer_id || args.fare_id || args.email)) {
      throw new ToolError(
        'This step only sends a prepared offer. Call egf_prepare_flight_offer with these details, show '
        + 'the user the summary it returns, then call this again with its confirmation_token.',
      )
    }
    const request = await redeemToken<OfferEmail>(ACTION, args.confirmation_token, env)

    const reply = await callPelikanTool('sendoffer', {
      flight_id: request.ids.fare,
      there_trip_id: request.ids.there,
      back_trip_id: request.ids.back,
      session_id: request.ids.session,
      request_from_client: request.name,
      intro_addressing_customer: request.name,
      intro_email_customer: request.address,
      intro_text: request.message,
      // The offer arrives from easygroupflights, so the footer has to say so.
      footer_agent_name: 'easygroupflights.com',
      footer_agent_email: 'info@easygroupflights.com',
      footer_agent_phone: '+44 1244 568183',
      number_of_adults: request.adults,
      number_of_children: request.children,
      number_of_infants: request.infants,
    }, env)

    return {
      text: `Offer sent to ${request.address}.\n\n${reply}`,
      structured: { status: 'sent', email: request.address, offer_id: request.offerId, reply },
    }
  },
}
