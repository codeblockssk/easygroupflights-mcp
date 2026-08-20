import type { Env, Tool } from '../types.ts'
import { markNote, submitGroupRequest } from '../lib/autopilot.ts'
import { MARKETS, resolveMarket } from '../lib/markets.ts'
import { airports, email, int, intList, isoDate, optionalStr, phone } from '../lib/validate.ts'
import { ToolError } from '../types.ts'

export const requestGroupQuote: Tool = {
  name: 'request_group_quote',
  title: 'Request a group flight quote',
  description:
    'Request a quote for a group of 10 or more travellers flying together. Group fares are '
    + 'negotiated directly with airlines and are not sold through public booking engines, so this '
    + 'tool does NOT return a price: it puts a complete enquiry in front of a human agent, who '
    + 'replies by email within about 2 hours (up to 24 hours for complex multi-city trips). '
    + 'Typical saving against booking the same seats individually is 20–40%, the price is locked '
    + 'for the whole group at once, seats are held together, and passenger names can be supplied '
    + 'later. Collect the email address and phone number before calling — the agent needs both to '
    + 'reply. For 9 travellers or fewer, use search_flights instead.',
  inputSchema: {
    type: 'object',
    required: ['origin', 'destination', 'departureDate', 'adults', 'email', 'phone'],
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
      departureDate: { type: 'string', description: 'Outbound date, YYYY-MM-DD.' },
      returnDate: { type: 'string', description: 'Return date, YYYY-MM-DD. Omit for a one-way group booking.' },
      returnOrigin: { type: 'array', items: { type: 'string' }, description: 'Return leg departure airports, if the group flies home from somewhere other than the destination.' },
      returnDestination: { type: 'array', items: { type: 'string' }, description: 'Return leg arrival airports, if travellers go home to a different city.' },
      dateFlexibilityDays: { type: 'integer', minimum: 0, description: 'How many days either side of the given dates the group can move. 0 means fixed dates. Flexibility often buys a better group fare, so ask.' },
      adults: { type: 'integer', minimum: 1, description: 'Travellers aged 16 or over.' },
      youths: { type: 'integer', minimum: 0, description: 'Travellers aged 12–15.' },
      children: { type: 'integer', minimum: 0, description: 'Travellers aged 2–11, each in their own seat.' },
      infants: { type: 'integer', minimum: 0, description: 'Under 2, travelling on an adult lap. They do not occupy a seat and do not count towards the group of 10.' },
      youthsAges: { type: 'array', items: { type: 'integer' }, description: 'Age of each youth, one entry per youth.' },
      childrenAges: { type: 'array', items: { type: 'integer' }, description: 'Age of each child, one entry per child.' },
      cabinClass: { type: 'string', enum: ['economy', 'business'], description: 'Defaults to economy.' },
      email: { type: 'string', description: 'Where the quote is sent. Required.' },
      phone: { type: 'string', description: 'Contact number in international form, e.g. +441244568183. Required — the agent may call to confirm details.' },
      firstName: { type: 'string', description: 'Organiser\'s first name.' },
      lastName: { type: 'string', description: 'Organiser\'s surname.' },
      note: {
        type: 'string',
        description: 'Anything that shapes the fare: what the group is (school trip, wedding, sports team, conference), baggage or equipment needs, budget, who pays, whether names are known yet. Worth asking for — it is what lets the agent quote accurately first time.',
      },
      market: { type: 'string', enum: ['en', 'pl', 'at'], description: 'Which market handles the enquiry: en (easygroupflights.com), pl (grupoweloty.pl) or at (gruppenfluege.at). Defaults to en.' },
    },
  },

  async run(args: Record<string, unknown>, env: Env) {
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
        + 'Use search_flights for ordinary tickets, or call again if the party is larger than stated.',
      )
    }

    const youthsAge = intList(args, 'youthsAges')
    const childrenAge = intList(args, 'childrenAges')
    if (youthsAge.length && youthsAge.length !== youths)
      throw new ToolError(`Gave ${youths} youths but ${youthsAge.length} ages. Supply one age per youth, or omit the ages.`)
    if (childrenAge.length && childrenAge.length !== children)
      throw new ToolError(`Gave ${children} children but ${childrenAge.length} ages. Supply one age per child, or omit the ages.`)

    const cityOrigin = airports(args, 'origin', 'the departure airport')
    const cityDestination = airports(args, 'destination', 'the destination airport')
    const departureDate = isoDate(args, 'departureDate', 'The outbound date', true)!
    const returnDate = isoDate(args, 'returnDate', 'The return date', false)

    if (returnDate && returnDate < departureDate)
      throw new ToolError(`The return date ${returnDate} falls before the outbound date ${departureDate}.`)

    const cabin = optionalStr(args, 'cabinClass') === 'business' ? 'business' : 'economy'

    // The source field has to stay a bare domain or Autopilot will not process
    // the lead, so the marker that separates an MCP enquiry from a web-form one
    // rides at the front of the note instead.
    const markedNote = markNote(optionalStr(args, 'note'))

    await submitGroupRequest({
      market,
      email: email(args),
      phoneNumber: phone(args),
      firstName: optionalStr(args, 'firstName'),
      lastName: optionalStr(args, 'lastName'),
      note: markedNote,
      cabinClass: cabin,
      cityOrigin,
      cityDestination,
      // Unless told otherwise the group comes home the way it went out.
      cityOriginBacktrip: returnDate ? (args.returnOrigin ? airports(args, 'returnOrigin', 'return origin') : cityDestination) : [],
      cityDestinationBacktrip: returnDate ? (args.returnDestination ? airports(args, 'returnDestination', 'return destination') : cityOrigin) : [],
      dateDepartureThere: departureDate,
      dateDepartureBack: returnDate,
      passengers: { adults, youths, children, infants, youthsAge, childrenAge },
      daysRange: int(args, 'dateFlexibilityDays'),
    }, env)

    const route = `${cityOrigin.join('/')} → ${cityDestination.join('/')}`
    const when = returnDate ? `${departureDate} returning ${returnDate}` : `${departureDate}, one way`
    const party = [
      `${adults} adult${adults === 1 ? '' : 's'}`,
      youths ? `${youths} youth${youths === 1 ? '' : 's'}` : '',
      children ? `${children} child${children === 1 ? '' : 'ren'}` : '',
      infants ? `${infants} infant${infants === 1 ? '' : 's'} on lap` : '',
    ].filter(Boolean).join(', ')

    return [
      `Enquiry submitted to ${MARKETS[market].domain}.`,
      '',
      `  Route     ${route}`,
      `  Dates     ${when}`,
      `  Party     ${party} (${seated} seats)`,
      `  Cabin     ${cabin}`,
      `  Reply to  ${email(args)}`,
      '',
      'A group specialist prices it against negotiated airline fares and replies by email in about '
      + '2 hours — up to 24 hours if the routing is complex. Nothing is booked or charged by this '
      + 'step, and the quote carries no obligation.',
    ].join('\n')
  },
}
