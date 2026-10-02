import type { GroupRequest } from '../lib/autopilot.ts'
import type { Env, Tool } from '../types.ts'
import { markNote, submitGroupRequest } from '../lib/autopilot.ts'
import { CONFIRMATION_TOKEN, issueToken, redeemToken } from '../lib/confirm.ts'
import { IDEMPOTENCY_KEY } from '../lib/idempotency.ts'
import { MARKETS, resolveMarket } from '../lib/markets.ts'
import { airports, email, int, intList, isoDate, optionalStr, phone } from '../lib/validate.ts'
import { ToolError } from '../types.ts'

const ACTION = 'group_quote'

/**
 * Everything a quote request is checked against, done once, at preparation.
 * What comes out is exactly what the CRM will receive; the token carries it,
 * so the write step cannot send anything the summary did not show.
 */
function brief(args: Record<string, unknown>, env: Env): GroupRequest {
  const market = resolveMarket(args.market)
  const minimum = Number(env.GROUP_MIN_PASSENGERS) || 10

  const adults = int(args, 'adults')
  const youths = int(args, 'youths')
  const children = int(args, 'children')
  const infants = int(args, 'infants')
  // Infants sit on a lap, so they are not what an airline counts as a group.
  const seated = adults + youths + children

  if (adults < 1)
    throw new ToolError('A group booking needs at least one adult travelling.')

  if (seated < minimum) {
    throw new ToolError(
      `That is ${seated} seated traveller${seated === 1 ? '' : 's'}, and a group fare needs ${minimum}. `
      + 'Use egf_search_flights for ordinary tickets, or call again if the party is larger than stated.',
    )
  }

  const youthsAge = intList(args, 'youths_ages')
  const childrenAge = intList(args, 'children_ages')
  if (youthsAge.length && youthsAge.length !== youths)
    throw new ToolError(`Gave ${youths} youths but ${youthsAge.length} ages. Supply one age per youth, or omit the ages.`)
  if (childrenAge.length && childrenAge.length !== children)
    throw new ToolError(`Gave ${children} children but ${childrenAge.length} ages. Supply one age per child, or omit the ages.`)

  const cityOrigin = airports(args, 'origin', 'the departure airport')
  const cityDestination = airports(args, 'destination', 'the destination airport')
  const departureDate = isoDate(args, 'departure_date', 'The outbound date', true)!
  const returnDate = isoDate(args, 'return_date', 'The return date', false)

  if (returnDate && returnDate < departureDate)
    throw new ToolError(`The return date ${returnDate} falls before the outbound date ${departureDate}.`)

  const cabin = optionalStr(args, 'cabin_class') === 'business' ? 'business' : 'economy'

  // The source field has to stay a bare domain or Autopilot will not process
  // the lead, so the marker that separates an MCP enquiry from a web-form one
  // rides at the front of the note instead.
  const markedNote = markNote(optionalStr(args, 'note'))

  return {
    market,
    email: email(args),
    phoneNumber: phone(args),
    firstName: optionalStr(args, 'first_name'),
    lastName: optionalStr(args, 'last_name'),
    note: markedNote,
    cabinClass: cabin,
    cityOrigin,
    cityDestination,
    // Unless told otherwise the group comes home the way it went out.
    cityOriginBacktrip: returnDate ? (args.return_origin ? airports(args, 'return_origin', 'return origin') : cityDestination) : [],
    cityDestinationBacktrip: returnDate ? (args.return_destination ? airports(args, 'return_destination', 'return destination') : cityOrigin) : [],
    dateDepartureThere: departureDate,
    dateDepartureBack: returnDate,
    passengers: { adults, youths, children, infants, youthsAge, childrenAge },
    daysRange: int(args, 'date_flexibility_days'),
  }
}

const BRIEF_SCHEMA = {
  type: 'object',
  required: ['market', 'domain', 'origin', 'destination', 'departure_date', 'adults', 'youths', 'children', 'infants', 'seats', 'cabin', 'reply_to'],
  properties: {
    market: { type: 'string', enum: ['en', 'pl', 'at'] },
    domain: { type: 'string', description: 'The market whose desk handles the enquiry.' },
    origin: { type: 'array', items: { type: 'string' } },
    destination: { type: 'array', items: { type: 'string' } },
    departure_date: { type: 'string', description: 'ISO 8601 date (YYYY-MM-DD).' },
    return_date: { type: 'string', description: 'ISO 8601 date (YYYY-MM-DD). Absent for one way.' },
    adults: { type: 'integer' },
    youths: { type: 'integer' },
    children: { type: 'integer' },
    infants: { type: 'integer' },
    seats: { type: 'integer', description: 'Seated travellers; lap infants excluded.' },
    cabin: { type: 'string', enum: ['economy', 'business'] },
    reply_to: { type: 'string', description: 'Where the quote will be emailed.' },
  },
} as const

function summary(request: GroupRequest) {
  const { adults, youths, children, infants } = request.passengers
  const seated = adults + youths + children
  const returnDate = request.dateDepartureBack
  return {
    lines: [
      `  Route     ${request.cityOrigin.join('/')} → ${request.cityDestination.join('/')}`,
      `  Dates     ${returnDate ? `${request.dateDepartureThere} returning ${returnDate}` : `${request.dateDepartureThere}, one way`}`,
      `  Party     ${[
        `${adults} adult${adults === 1 ? '' : 's'}`,
        youths ? `${youths} youth${youths === 1 ? '' : 's'}` : '',
        children ? `${children} child${children === 1 ? '' : 'ren'}` : '',
        infants ? `${infants} infant${infants === 1 ? '' : 's'} on lap` : '',
      ].filter(Boolean).join(', ')} (${seated} seats)`,
      `  Cabin     ${request.cabinClass}`,
      `  Reply to  ${request.email}, ${request.phoneNumber}`,
    ],
    structured: {
      market: request.market,
      domain: MARKETS[request.market].domain,
      origin: request.cityOrigin,
      destination: request.cityDestination,
      departure_date: request.dateDepartureThere,
      ...(returnDate ? { return_date: returnDate } : {}),
      adults,
      youths,
      children,
      infants,
      seats: seated,
      cabin: request.cabinClass,
      reply_to: request.email,
    },
  }
}

export const prepareGroupQuote: Tool = {
  name: 'egf_prepare_group_quote',
  title: 'Prepare a group flight quote request',
  description:
    'Checks a group flight enquiry for 10 or more seated travellers and returns the exact brief '
    + 'that would go to a human specialist, with a confirmation_token valid for 15 minutes. '
    + 'Nothing is sent.',
  inputSchema: {
    type: 'object',
    required: ['origin', 'destination', 'departure_date', 'adults', 'email', 'phone'],
    properties: {
      origin: {
        type: 'array',
        items: { type: 'string', pattern: '^[A-Za-z]{3}$' },
        description: 'Departure airport as an IATA code, e.g. ["LHR"]. Several codes are allowed when the group converges from more than one city.',
      },
      destination: {
        type: 'array',
        items: { type: 'string', pattern: '^[A-Za-z]{3}$' },
        description: 'Arrival airport as an IATA code, e.g. ["BCN"].',
      },
      departure_date: { type: 'string', description: 'Outbound date, ISO 8601 (YYYY-MM-DD).' },
      return_date: { type: 'string', description: 'Return date, ISO 8601 (YYYY-MM-DD). Omit for a one-way group booking.' },
      return_origin: { type: 'array', items: { type: 'string' }, description: 'Return leg departure airports, if the group flies home from somewhere other than the destination.' },
      return_destination: { type: 'array', items: { type: 'string' }, description: 'Return leg arrival airports, if travellers go home to a different city.' },
      date_flexibility_days: { type: 'integer', minimum: 0, description: 'How many days either side of the given dates the group can move. 0 means fixed dates.' },
      adults: { type: 'integer', minimum: 1, description: 'Travellers aged 16 or over.' },
      youths: { type: 'integer', minimum: 0, description: 'Travellers aged 12–15.' },
      children: { type: 'integer', minimum: 0, description: 'Travellers aged 2–11, each in their own seat.' },
      infants: { type: 'integer', minimum: 0, description: 'Under 2, travelling on an adult lap. They do not occupy a seat and do not count towards the group of 10.' },
      youths_ages: { type: 'array', items: { type: 'integer' }, description: 'Age of each youth, one entry per youth.' },
      children_ages: { type: 'array', items: { type: 'integer' }, description: 'Age of each child, one entry per child.' },
      cabin_class: { type: 'string', enum: ['economy', 'business'], description: 'Defaults to economy.' },
      email: { type: 'string', description: 'Where the quote is sent. Required.' },
      phone: { type: 'string', description: 'Contact number in international form, e.g. +441244568183. Required: a group specialist may phone to confirm details.' },
      first_name: { type: 'string', description: 'Organiser\'s first name.' },
      last_name: { type: 'string', description: 'Organiser\'s surname.' },
      note: {
        type: 'string',
        description: 'Anything that shapes the fare: what the group is (school trip, wedding, sports team, conference), baggage or equipment needs, budget, who pays, whether names are known yet.',
      },
      market: { type: 'string', enum: ['en', 'pl', 'at'], description: 'Which market handles the enquiry: en (easygroupflights.com), pl (grupoweloty.pl) or at (gruppenfluege.at). Defaults to en.' },
    },
  },
  outputSchema: {
    type: 'object',
    required: [...BRIEF_SCHEMA.required, 'confirmation_token', 'expires_at'],
    properties: {
      ...BRIEF_SCHEMA.properties,
      confirmation_token: { type: 'string', description: 'Authorises sending exactly this brief.' },
      expires_at: { type: 'string', description: 'ISO 8601 date-time after which the token is refused.' },
    },
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },

  async run(args: Record<string, unknown>, env: Env) {
    const request = brief(args, env)
    const { token, expiresAt } = await issueToken(ACTION, request, env)
    const { lines, structured } = summary(request)
    return {
      text: [
        `Ready to send to the group desk at ${MARKETS[request.market].domain}. Not sent yet.`,
        '',
        ...lines,
        '',
        `Show this to the user. Once they confirm, send it with confirmation_token ${token} (valid until ${expiresAt}).`,
      ].join('\n'),
      structured: { ...structured, confirmation_token: token, expires_at: expiresAt },
    }
  },
}

export const requestGroupQuote: Tool = {
  name: 'egf_request_group_quote',
  aliases: ['request_group_quote'],
  title: 'Send a group flight quote request',
  description:
    'Sends a prepared group flight enquiry to a human specialist, who replies by email with a '
    + 'written quote, usually within about 2 hours. Takes only the confirmation_token from preparing '
    + 'it; it returns a confirmation, not a price, and books or charges nothing.',
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
    required: ['status', 'market', 'domain', 'origin', 'destination', 'departure_date', 'adults', 'youths', 'children', 'infants', 'seats', 'cabin', 'reply_to', 'typical_reply_hours', 'max_reply_hours'],
    properties: {
      status: { type: 'string', enum: ['submitted'], description: 'The enquiry reached the specialist desk. Nothing is booked or charged.' },
      market: { type: 'string', enum: ['en', 'pl', 'at'] },
      domain: { type: 'string', description: 'The market whose desk handles the enquiry.' },
      origin: { type: 'array', items: { type: 'string' } },
      destination: { type: 'array', items: { type: 'string' } },
      departure_date: { type: 'string', description: 'ISO 8601 date (YYYY-MM-DD).' },
      return_date: { type: 'string', description: 'ISO 8601 date (YYYY-MM-DD). Absent for one way.' },
      adults: { type: 'integer' },
      youths: { type: 'integer' },
      children: { type: 'integer' },
      infants: { type: 'integer' },
      seats: { type: 'integer', description: 'Seated travellers; lap infants excluded.' },
      cabin: { type: 'string', enum: ['economy', 'business'] },
      reply_to: { type: 'string', description: 'Where the quote will be emailed.' },
      typical_reply_hours: { type: 'integer' },
      max_reply_hours: { type: 'integer' },
    },
  },
  // Not idempotent by itself: a second call is a second enquiry in the CRM.
  // The token (or an idempotency_key) is what makes a retry safe.
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  idempotent: true,

  async run(args: Record<string, unknown>, env: Env) {
    if (args.confirmation_token === undefined && (args.origin || args.adults || args.email)) {
      throw new ToolError(
        'This step only sends a prepared enquiry. Call egf_prepare_group_quote with these details, show '
        + 'the user the summary it returns, then call this again with its confirmation_token.',
      )
    }
    const request = await redeemToken<GroupRequest>(ACTION, args.confirmation_token, env)
    await submitGroupRequest(request, env)
    const { lines, structured } = summary(request)

    return {
      text: [
        `Enquiry submitted to ${MARKETS[request.market].domain}.`,
        '',
        ...lines,
        '',
        'A group specialist prices it against negotiated airline fares and replies by email in about '
        + '2 hours — up to 24 hours if the routing is complex. Nothing is booked or charged by this '
        + 'step, and the quote carries no obligation.',
      ].join('\n'),
      structured: { status: 'submitted', ...structured, typical_reply_hours: 2, max_reply_hours: 24 },
    }
  },
}
