import type { Env, Tool } from '../types.ts'
import { callPelikanTool } from '../lib/pelikan.ts'
import { airports, int, isoDate } from '../lib/validate.ts'
import { ToolError } from '../types.ts'

export const searchFlights: Tool = {
  name: 'search_flights',
  title: 'Search flights for a small party',
  requiresPelikan: true,
  description:
    'Search live, bookable fares for a party of 9 travellers or fewer — ordinary tickets sold '
    + 'through public inventory. Returns flight options with prices, carriers, stops and a direct '
    + 'booking link. Prices are quoted per person. For 10 or more travellers this tool is the wrong '
    + 'one: those need a negotiated group fare, so use request_group_quote instead.',
  inputSchema: {
    type: 'object',
    required: ['origin', 'destination', 'departureDate'],
    properties: {
      origin: { type: 'string', description: 'Departure airport, IATA code, e.g. VIE.' },
      destination: { type: 'string', description: 'Arrival airport, IATA code, e.g. BCN.' },
      departureDate: { type: 'string', description: 'Outbound date, YYYY-MM-DD.' },
      returnDate: { type: 'string', description: 'Return date, YYYY-MM-DD. Omit for one way.' },
      passengers: { type: 'integer', minimum: 1, maximum: 9, description: 'How many people are travelling. 10 or more is a group — use request_group_quote.' },
    },
  },

  async run(args: Record<string, unknown>, env: Env) {
    const minimum = Number(env.GROUP_MIN_PASSENGERS) || 10
    const passengers = int(args, 'passengers', 1)

    if (passengers >= minimum) {
      throw new ToolError(
        `${passengers} travellers is a group. Public fares cannot hold that many seats together at one `
        + 'price — use request_group_quote, which reaches an agent who negotiates the fare with the airline.',
      )
    }

    const from = airports(args, 'origin', 'the departure airport')[0]
    const to = airports(args, 'destination', 'the destination airport')[0]
    const departureDate = isoDate(args, 'departureDate', 'The outbound date', true)!
    const returnDate = isoDate(args, 'returnDate', 'The return date', false)

    if (returnDate && returnDate < departureDate)
      throw new ToolError(`The return date ${returnDate} falls before the outbound date ${departureDate}.`)

    // The upstream search is session-scoped: every result id is only meaningful
    // within the session that produced it, so the two calls belong together.
    const sessionId = (await callPelikanTool('getsession', {}, env)).trim()
    if (!sessionId || sessionId.startsWith('ERROR'))
      throw new ToolError('Could not open a search session with the fare service. Please try again shortly.')

    const results = await callPelikanTool('search', {
      from_airport: from,
      to_airport: to,
      date_from: departureDate,
      session_id: sessionId,
      ...(returnDate ? { date_to: returnDate } : {}),
    }, env)

    return [
      `Fares ${from} → ${to}, ${returnDate ? `${departureDate} returning ${returnDate}` : `${departureDate} one way`}`
      + `, ${passengers} traveller${passengers === 1 ? '' : 's'}. Prices are per person.`,
      '',
      format(results, env.FARE_CURRENCY ?? 'EUR'),
      '',
      `Session ${sessionId} — pass it with a fare's ids to send_flight_offer to email that option.`,
    ].join('\n')
  },
}

const MAX_SHOWN = 12

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
 * between — while keeping the ids send_flight_offer needs.
 */
function format(raw: string, currency: string): string {
  let flights: any[]
  try {
    const parsed = JSON.parse(raw)
    flights = (Array.isArray(parsed) ? parsed : [parsed]).map(f => typeof f === 'string' ? JSON.parse(f) : f)
  }
  catch {
    return raw // Never lose the answer to a formatting problem.
  }

  if (!flights.length)
    return 'No fares found for those dates. Try nearby days, or a different airport.'

  const lines = flights.slice(0, MAX_SHOWN).map((f, index) => {
    const carriers = (f.marketing_carriers ?? []).join(', ')
    const legs = f.back_trip_id && f.back_trip_id !== '0'
      ? `out ${when(f.departure_date)} · back ${when(f.return_date)}`
      : `out ${when(f.departure_date)} · one way`
    const routing = f.back_trip_id && f.back_trip_id !== '0'
      ? `${stops(f.stops_there)} out, ${stops(f.stops_back)} back`
      : stops(f.stops_there)

    return [
      `${String(index + 1).padStart(2)}. ${money(f.price, currency)} — ${carriers || 'unknown carrier'}, ${routing}`,
      `    ${legs}`,
      `    flights ${(f.flight_numbers_combined ?? []).join(' / ') || 'n/a'}`,
      `    ids fare=${f.fare_id} there=${f.there_trip_id} back=${f.back_trip_id}`,
      f.reservation_link ? `    book ${f.reservation_link}` : '',
    ].filter(Boolean).join('\n')
  })

  if (flights.length > MAX_SHOWN)
    lines.push(`… and ${flights.length - MAX_SHOWN} more; these are the ${MAX_SHOWN} cheapest returned.`)

  return lines.join('\n\n')
}
