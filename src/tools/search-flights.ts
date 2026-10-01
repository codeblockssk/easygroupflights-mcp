import type { OfferDetails } from '../lib/offer.ts'
import type { Env, Tool } from '../types.ts'
import { recall, remember, sha256 } from '../lib/cache.ts'
import { cleanLink, encodeOffer, OFFER_TTL } from '../lib/offer.ts'
import { openPelikan } from '../lib/pelikan.ts'
import { airports, int, isoDate, optionalStr } from '../lib/validate.ts'
import { ToolError } from '../types.ts'

// Results are cached per search session so a later page is the same search.
// The cache is per data centre, so a page asked for elsewhere can miss; it is
// then searched again rather than refused, since every offer_id carries its
// own session and stays valid either way.
const PAGE_TTL = OFFER_TTL
const DEFAULT_LIMIT = 10
const MAX_LIMIT = 20

/** `issued` is when the search ran, in seconds: every offer from it expires together, with the cache. */
export interface Saved { route: string, sessionId: string, issued: number, flights: any[] }

async function savedSearch(sessionId: string) {
  return recall<Saved>(`search/${await sha256(sessionId)}`)
}

function encodeCursor(sessionId: string, offset: number, route: string) {
  return btoa(JSON.stringify({ s: sessionId, o: offset, r: route })).replace(/=+$/, '')
}

function decodeCursor(cursor: string): { s: string, o: number, r?: string } {
  try {
    const value = JSON.parse(atob(cursor))
    if (typeof value?.s === 'string' && Number.isInteger(value?.o) && value.o >= 0)
      return value
  }
  catch {}
  throw new ToolError('That cursor is not one this search returned. Pass next_cursor exactly as given, or search again without a cursor.')
}

export const searchFlights: Tool = {
  name: 'egf_search_flights',
  aliases: ['search_flights'],
  title: 'Search flights for a small party',
  requiresPelikan: true,
  description:
    'Searches live public fares for 1 to 9 travellers and returns options with per-person prices, '
    + 'carriers and stops, cheapest first, each with an offer_id valid for 30 minutes. Results come in pages: pass next_cursor '
    + 'back as cursor, with the same route and dates, for more.',
  inputSchema: {
    type: 'object',
    required: ['origin', 'destination', 'departure_date'],
    properties: {
      origin: { type: 'string', description: 'Departure airport, IATA code, e.g. VIE.' },
      destination: { type: 'string', description: 'Arrival airport, IATA code, e.g. BCN.' },
      departure_date: { type: 'string', description: 'Outbound date, ISO 8601 (YYYY-MM-DD).' },
      return_date: { type: 'string', description: 'Return date, ISO 8601 (YYYY-MM-DD). Omit for one way.' },
      passengers: { type: 'integer', minimum: 1, maximum: 9, description: 'How many people are travelling, 1 to 9. Defaults to 1.' },
      limit: { type: 'integer', minimum: 1, maximum: MAX_LIMIT, description: `Fares per page. Defaults to ${DEFAULT_LIMIT}.` },
      cursor: { type: 'string', description: 'next_cursor from the previous page of this search. Omit for the first page.' },
    },
  },
  outputSchema: {
    type: 'object',
    required: ['origin', 'destination', 'departure_date', 'passengers', 'currency', 'total', 'fares'],
    properties: {
      origin: { type: 'string' },
      destination: { type: 'string' },
      departure_date: { type: 'string', description: 'ISO 8601 date (YYYY-MM-DD).' },
      return_date: { type: 'string', description: 'ISO 8601 date (YYYY-MM-DD). Absent for one way.' },
      passengers: { type: 'integer' },
      currency: { type: 'string', description: 'ISO 4217 code every price is in.' },
      total: { type: 'integer', description: 'Fares the search found, across all pages.' },
      next_cursor: { type: 'string', description: 'Pass as cursor for the next page. Absent on the last page.' },
      fares: {
        type: 'array',
        items: {
          type: 'object',
          required: ['rank', 'offer_id', 'carriers', 'flight_numbers'],
          properties: {
            rank: { type: 'integer', description: '1 is the cheapest.' },
            offer_id: { type: 'string', description: 'Identifies this fare when emailing it as an offer. Valid for this search only.' },
            price: { type: 'number', description: 'Per person, in currency.' },
            carriers: { type: 'array', items: { type: 'string' } },
            stops_out: { type: 'integer' },
            stops_back: { type: 'integer' },
            departure: { type: 'string', description: 'Local departure, ISO 8601 (YYYY-MM-DDTHH:MM).' },
            return: { type: 'string', description: 'Local return departure, ISO 8601 (YYYY-MM-DDTHH:MM).' },
            flight_numbers: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
  },
  // Read-only towards the user — it searches, it does not hold or buy — but
  // live: the same call a minute later can return different fares.
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },

  async run(args: Record<string, unknown>, env: Env) {
    const minimum = Number(env.GROUP_MIN_PASSENGERS) || 10
    const passengers = int(args, 'passengers', 1)

    if (passengers >= minimum) {
      throw new ToolError(
        `${passengers} travellers is a group. Public fares cannot hold that many seats together at one `
        + 'price — use egf_request_group_quote, which reaches an agent who negotiates the fare with the airline.',
      )
    }

    const from = airports(args, 'origin', 'the departure airport')[0]
    const to = airports(args, 'destination', 'the destination airport')[0]
    const departureDate = isoDate(args, 'departure_date', 'The outbound date', true)!
    const returnDate = isoDate(args, 'return_date', 'The return date', false)

    if (returnDate && returnDate < departureDate)
      throw new ToolError(`The return date ${returnDate} falls before the outbound date ${departureDate}.`)

    const limit = Math.min(Math.max(int(args, 'limit', DEFAULT_LIMIT), 1), MAX_LIMIT)
    const route = `${from}-${to}-${departureDate}-${returnDate ?? ''}`
    const cursor = optionalStr(args, 'cursor')

    let saved: Saved | null = null
    let offset = 0
    let unparsed = ''
    let researched = false

    if (cursor) {
      const { s, o, r } = decodeCursor(cursor)
      if ((r ?? route) !== route)
        throw new ToolError('That cursor belongs to a different route or dates. Pass the same origin, destination and dates as the first page.')
      offset = o
      saved = await savedSearch(s)
      researched = !saved
    }

    if (!saved) {
      // The upstream search is session-scoped: every result id is only
      // meaningful within the session that produced it, so both calls go
      // through one connection.
      const pelikan = await openPelikan(env)
      const sessionId = (await pelikan.call('getsession', {})).trim()
      if (!sessionId || sessionId.startsWith('ERROR'))
        throw new ToolError('Could not open a search session with the fare service. Please try again shortly.')

      const raw = await pelikan.call('search', {
        from_airport: from,
        to_airport: to,
        date_from: departureDate,
        session_id: sessionId,
        ...(returnDate ? { date_to: returnDate } : {}),
      })

      const flights = parse(raw)
      if (!flights)
        unparsed = raw
      saved = { route, sessionId, issued: Math.floor(Date.now() / 1000), flights: flights ?? [] }
      if (flights?.length)
        await remember(`search/${await sha256(sessionId)}`, saved, PAGE_TTL)
    }
    const search = saved

    const currency = env.FARE_CURRENCY ?? 'EUR'
    const page = search.flights.slice(offset, offset + limit)
    const next = offset + limit < search.flights.length ? encodeCursor(search.sessionId, offset + limit, route) : undefined
    const fares = await Promise.all(page.map((f, i) => fare(f, offset + i + 1, search.sessionId, search.issued, env)))

    const header = `Fares ${from} → ${to}, ${returnDate ? `${departureDate} returning ${returnDate}` : `${departureDate} one way`}`
      + `, ${passengers} traveller${passengers === 1 ? '' : 's'}. Prices are per person.`
    const body = unparsed
      // Never lose the answer to a formatting problem.
      || (search.flights.length
        ? fares.map((f, i) => describe(f, page[i], currency)).join('\n\n')
        : 'No fares found for those dates. Try nearby days, or a different airport.')
    const footer = [
      researched ? 'The earlier search was no longer held here, so this page comes from a fresh one; fares may have moved.' : '',
      next ? `Showing ${offset + 1}–${offset + page.length} of ${search.flights.length}. Pass cursor "${next}" for more.` : '',
      'Each offer_id lasts 30 minutes. egf_get_offer gives a fare\'s booking link; egf_prepare_flight_offer emails it as a formal offer.',
    ].filter(Boolean)

    return {
      text: [header, '', body, '', ...footer].join('\n'),
      structured: {
        origin: from,
        destination: to,
        departure_date: departureDate,
        ...(returnDate ? { return_date: returnDate } : {}),
        passengers,
        currency,
        total: search.flights.length,
        ...(next ? { next_cursor: next } : {}),
        fares,
      },
    }
  },
}

const SYMBOLS: Record<string, string> = { EUR: '€', GBP: '£', USD: '$', CZK: 'Kč', PLN: 'zł' }

/** The fare service returns a bare number, so the currency has to be added here. */
function money(amount: unknown, currency: string) {
  const symbol = SYMBOLS[currency]
  // Symbols that follow the amount, and unknown codes, read better spelled out.
  return symbol && !['Kč', 'zł'].includes(symbol) ? `${symbol}${amount}` : `${amount} ${currency}`
}

/** `[2026, 10, 15, 7, 15]` is how the upstream reports a time. */
function when(parts: unknown) {
  if (!Array.isArray(parts) || parts.length < 3)
    return ''
  const [y, m, d, hh, mm] = parts as number[]
  const date = `${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}.${y}`
  return hh === undefined ? date : `${date} ${String(hh).padStart(2, '0')}:${String(mm ?? 0).padStart(2, '0')}`
}

function stops(count: unknown) {
  return count === 0 ? 'direct' : `${count} stop${count === 1 ? '' : 's'}`
}

/**
 * The upstream returns a list of JSON strings carrying every field it knows.
 * Passed through raw that is thousands of characters of escaped JSON per search,
 * most of it noise, so it is rendered down to what a traveller is choosing
 * between, with one offer_id standing for the ids egf_send_flight_offer needs.
 */
function parse(raw: string): any[] | null {
  try {
    const parsed = JSON.parse(raw)
    return (Array.isArray(parsed) ? parsed : [parsed]).map(f => typeof f === 'string' ? JSON.parse(f) : f)
  }
  catch {
    return null
  }
}

function isReturn(f: any) {
  return Boolean(f.back_trip_id && f.back_trip_id !== '0')
}

/** `[2026, 10, 15, 7, 15]` as `2026-10-15T07:15`. */
function iso(parts: unknown) {
  if (!Array.isArray(parts) || parts.length < 3)
    return undefined
  const [y, m, d, hh, mm] = (parts as number[]).map(n => String(n).padStart(2, '0'))
  return hh === undefined ? `${y}-${m}-${d}` : `${y}-${m}-${d}T${hh}:${mm ?? '00'}`
}

function count(value: unknown) {
  return Number.isInteger(value) ? value as number : undefined
}

/** Only fields the upstream actually gave, so the result always fits outputSchema. */
function details(f: any): OfferDetails {
  const price = Number(f.price)
  const entries = {
    price: Number.isFinite(price) && f.price !== '' && f.price !== null ? price : undefined,
    carriers: (f.marketing_carriers ?? []).map(String),
    stops_out: count(f.stops_there),
    stops_back: isReturn(f) ? count(f.stops_back) : undefined,
    departure: iso(f.departure_date),
    return: isReturn(f) ? iso(f.return_date) : undefined,
    flight_numbers: (f.flight_numbers_combined ?? []).map(String),
  }
  return Object.fromEntries(Object.entries(entries).filter(([, v]) => v !== undefined)) as unknown as OfferDetails
}

async function fare(f: any, rank: number, session: string, issued: number, env: Env): Promise<Record<string, any>> {
  const shown = details(f)
  const link = typeof f.reservation_link === 'string' && f.reservation_link.startsWith('https://') ? cleanLink(f.reservation_link) : undefined
  const ids = { fare: String(f.fare_id ?? ''), there: String(f.there_trip_id ?? ''), back: String(f.back_trip_id ?? '0'), session }
  return { rank, offer_id: await encodeOffer({ ids, details: shown, link }, env, issued), ...shown }
}

function describe(f: Record<string, any>, raw: any, currency: string) {
  const legs = isReturn(raw)
    ? `out ${when(raw.departure_date)} · back ${when(raw.return_date)}`
    : `out ${when(raw.departure_date)} · one way`
  const routing = isReturn(raw)
    ? `${stops(raw.stops_there)} out, ${stops(raw.stops_back)} back`
    : stops(raw.stops_there)

  return [
    `${String(f.rank).padStart(2)}. ${money(raw.price, currency)} — ${f.carriers.join(', ') || 'unknown carrier'}, ${routing}`,
    `    ${legs}`,
    `    flights ${f.flight_numbers.join(' / ') || 'n/a'}`,
    `    offer_id ${f.offer_id}`,
  ].filter(Boolean).join('\n')
}
