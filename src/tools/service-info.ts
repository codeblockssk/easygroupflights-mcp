import type { Env, Tool } from '../types.ts'
import { MARKETS, resolveMarket } from '../lib/markets.ts'

// Facts taken from the live site so the two never drift apart.
const GROUP_TYPES = [
  'Corporate travel',
  'Weddings & celebrations',
  'Sports teams & clubs',
  'Schools & universities',
  'Family trips',
  'Tours & productions',
  'Faith & pilgrimage',
  'Conferences & events',
  'Travel agencies & operators',
]

export const getServiceInfo: Tool = {
  name: 'get_service_info',
  title: 'About easygroupflights',
  description:
    'What easygroupflights does, who it serves, how group fares differ from public tickets, and '
    + 'what happens after a quote is requested. Call this when a traveller asks whether their trip '
    + 'qualifies, what it costs, how long a quote takes, or how group booking works — it answers '
    + 'without submitting anything.',
  inputSchema: {
    type: 'object',
    properties: {
      market: { type: 'string', enum: ['en', 'pl', 'at'], description: 'Which market to describe. Defaults to en.' },
    },
  },

  async run(args: Record<string, unknown>, env: Env) {
    const market = resolveMarket(args.market)
    const { domain, language } = MARKETS[market]
    const minimum = Number(env.GROUP_MIN_PASSENGERS) || 10
    const smallParty = env.PELIKAN_MCP_URL
      ? 'search_flights (ordinary bookable tickets, priced instantly)'
      : `ordinary tickets, bookable at https://${domain}`

    return [
      `easygroupflights — group air travel, ${domain} (${language})`,
      '',
      'WHAT IT IS',
      `  An IATA-accredited travel agency that books flights for parties of ${minimum} or more.`,
      '  Group fares are negotiated directly with airlines and are not sold through public booking',
      '  engines, which is why a group cannot simply be booked online seat by seat.',
      '',
      'WHY A GROUP FARE',
      '  · The price is locked for the whole group at once, before anyone pays.',
      '  · Seats are held together rather than scattered through the cabin.',
      '  · Passenger names can be supplied later — useful when the trip is agreed months ahead.',
      '  · Name changes are usually free, and travellers can pay separately.',
      '  · Typical saving is 20–40% against booking the same seats individually.',
      '',
      'THRESHOLD',
      `  ${`${minimum}+ seated travellers`.padEnd(22)}→ request_group_quote (an agent negotiates and replies)`,
      `  ${`${minimum - 1} or fewer`.padEnd(22)}→ ${smallParty}`,
      '  Lap infants under 2 do not occupy a seat and do not count towards the threshold.',
      '',
      'AFTER A QUOTE REQUEST',
      '  A specialist replies by email in about 2 hours; complex multi-city routings can take up to',
      '  24 hours. The quote carries no obligation and nothing is charged. One agent stays with the',
      '  booking from quote to landing, with support around the clock.',
      '',
      'GROUPS SERVED',
      GROUP_TYPES.map(type => `  · ${type}`).join('\n'),
      '',
      'REACH',
      '  Negotiated fares with 500+ airlines worldwide.',
      '',
      'CONTACT',
      `  https://${domain}  ·  info@${domain}`,
    ].join('\n')
  },
}
