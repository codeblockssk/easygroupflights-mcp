import { MARKETS, resolveMarket } from './lib/markets.ts'

/**
 * Guided briefs for the trips the desk quotes most. Claude Desktop and claude.ai
 * list them under + → Connectors → Add from <server>; Claude Code offers them as
 * /mcp__easygroupflights__<name>. Picking one starts a conversation that collects what the specialist needs before anything is
 * sent, so the enquiry arrives complete rather than as a half-filled form.
 *
 * The prompt text is English: it instructs the model, which then talks to the
 * user in the user's own language. The market argument decides which desk
 * receives the enquiry and which language that desk replies in.
 */
interface Prompt {
  name: string
  title: string
  description: string
  /** What only this kind of trip needs, and why the desk asks. */
  specifics: string[]
}

const PROMPTS: Prompt[] = [
  {
    name: 'school-trip',
    title: 'School trip group quote',
    description: 'Collect a school or university trip brief and request a group flight quote.',
    specifics: [
      'the number of pupils and of staff, separately, and the pupils\' ages: airlines set supervision ratios (American Airlines, for one, publishes at least 1 adult per 20 minors non-stop and 1 per 15 with a connection)',
      'whether consent forms are still coming in — seats can be held and names supplied later',
      'who is invoiced: usually the school, as one invoice',
    ],
  },
  {
    name: 'wedding-guests',
    title: 'Wedding guest flights',
    description: 'Collect a destination wedding brief, including guests from several cities, and request a group quote.',
    specifics: [
      'the wedding date and the city of the venue',
      'which cities the guests fly from, and roughly how many from each',
      'the latest arrival that still makes the first event',
      'who pays: the couple, each guest, or a mix',
      'how firm the guest list is — names can follow later',
    ],
  },
  {
    name: 'sports-team',
    title: 'Sports team travel',
    description: 'Collect a club or squad brief for a tournament or away fixture and request a group quote.',
    specifics: [
      'the first match or weigh-in time, which is the real arrival deadline',
      'players and staff, separately, with ages if it is a youth squad',
      'equipment and extra baggage: bikes, poles, sticks, kit bags',
      'whether the fixture date could still move',
    ],
  },
  {
    name: 'company-offsite',
    title: 'Company offsite or conference',
    description: 'Collect a corporate offsite, incentive or conference brief and request a group quote.',
    specifics: [
      'the fixed week, and which offices or cities staff fly from',
      'cabin mix, if some travel in business',
      'the company to invoice and whether finance needs one invoice',
      'whether names are final or still changing',
    ],
  },
  {
    name: 'pilgrimage',
    title: 'Pilgrimage or parish trip',
    description: 'Collect a pilgrimage or faith-group brief and request a group quote.',
    specifics: [
      'the destination, such as the shrine or city, and the parish or group travelling',
      'how participants pay: each on their own, or one invoice to the parish',
      'any accessibility needs in the group',
      'how firm the list of pilgrims is — names can follow later',
    ],
  },
]

const ARGUMENTS = [
  { name: 'market', description: 'Which desk quotes it: en (easygroupflights.com), pl (grupoweloty.pl) or at (gruppenfluege.at). Defaults to en.', required: false },
  { name: 'origin', description: 'Departure city or airport, if already known.', required: false },
  { name: 'destination', description: 'Destination city or airport, if already known.', required: false },
  { name: 'dates', description: 'Travel dates or month, if already known.', required: false },
  { name: 'travellers', description: 'Roughly how many are going, if already known.', required: false },
]

export function listPrompts() {
  return PROMPTS.map(({ name, title, description }) => ({ name, title, description, arguments: ARGUMENTS }))
}

export function getPrompt(name: string, args: Record<string, string> = {}) {
  const prompt = PROMPTS.find(p => p.name === name)
  if (!prompt)
    return null
  const market = resolveMarket(args.market)
  const { domain } = MARKETS[market]
  const known = (['origin', 'destination', 'dates', 'travellers'] as const)
    .filter(k => args[k])
    .map(k => `${k}: ${args[k]}`)

  const text = [
    `I would like a group flight quote for a ${prompt.title.toLowerCase()}, through ${domain}.`,
    known.length ? `What I know so far — ${known.join('; ')}.` : '',
    '',
    'Before submitting anything, collect the brief the specialist needs:',
    '- departure airport(s) and destination',
    '- outbound and return dates, and how many days either way we could move',
    '- how many travellers: adults, and children or youths with their ages',
    '- my name, email address and phone number, because the specialist replies by email',
    '',
    `For this kind of trip, also ask about:\n${prompt.specifics.map(s => `- ${s}`).join('\n')}`,
    '',
    'Ask only for what is still missing, a few questions at a time, in my language. Put the trip-specific '
    + `answers in the note. When the brief is complete, call egf_prepare_group_quote with market "${market}" and `
    + 'read its summary back to me. Only once I confirm, call egf_request_group_quote with the confirmation_token it '
    + 'returned. If we turn out to be nine or fewer, use egf_search_flights instead.',
  ].filter((line, i, all) => line || all[i - 1]).join('\n')

  return {
    description: prompt.description,
    messages: [{ role: 'user', content: { type: 'text', text } }],
  }
}
