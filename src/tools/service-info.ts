import type { Env, Tool } from '../types.ts'
import { MARKETS, resolveMarket, whatsappLink } from '../lib/markets.ts'

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
  name: 'egf_get_service_info',
  aliases: ['get_service_info'],
  title: 'About easygroupflights',
  description:
    'Describes easygroupflights for one market: who it serves, how group fares differ from public '
    + 'tickets, what happens after a quote is requested, and how to reach a person. Submits nothing.',
  inputSchema: {
    type: 'object',
    properties: {
      market: { type: 'string', enum: ['en', 'pl', 'at'], description: 'Which market to describe. Defaults to en.' },
    },
  },
  outputSchema: {
    type: 'object',
    required: ['market', 'domain', 'website', 'language', 'group_minimum', 'typical_reply_hours', 'max_reply_hours', 'contact'],
    properties: {
      market: { type: 'string', enum: ['en', 'pl', 'at'] },
      domain: { type: 'string' },
      website: { type: 'string', description: 'Absolute https URL of the market\'s site.' },
      language: { type: 'string' },
      group_minimum: { type: 'integer', description: 'Seated travellers needed for a group fare.' },
      typical_reply_hours: { type: 'integer' },
      max_reply_hours: { type: 'integer' },
      contact: {
        type: 'object',
        required: ['email', 'phone', 'whatsapp', 'whatsapp_url'],
        properties: {
          email: { type: 'string' },
          phone: { type: 'string' },
          whatsapp: { type: 'string' },
          whatsapp_url: { type: 'string' },
        },
      },
    },
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },

  async run(args: Record<string, unknown>, env: Env) {
    const market = resolveMarket(args.market)
    const { domain, language, contact } = MARKETS[market]
    const minimum = Number(env.GROUP_MIN_PASSENGERS) || 10
    const smallParty = env.PELIKAN_MCP_URL
      ? 'egf_search_flights (ordinary bookable tickets, priced instantly)'
      : `ordinary tickets, bookable at https://${domain}`

    const text = [
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
      `  ${`${minimum}+ seated travellers`.padEnd(22)}→ egf_request_group_quote (an agent negotiates and replies)`,
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
      'TALK TO A PERSON',
      '  Offer these when the user would rather speak to someone, or wants to follow up a quote.',
      `  Website    https://${domain}`,
      `  Email      ${contact.email}`,
      `  Phone      ${contact.phone}`,
      `  WhatsApp   ${contact.whatsapp}  (${whatsappLink(contact.whatsapp)})`,
    ].join('\n')

    return {
      text,
      structured: {
        market,
        domain,
        website: `https://${domain}`,
        language,
        group_minimum: minimum,
        typical_reply_hours: 2,
        max_reply_hours: 24,
        contact: { ...contact, whatsapp_url: whatsappLink(contact.whatsapp) },
      },
    }
  },
}
