# easygroupflights MCP

A [Model Context Protocol](https://modelcontextprotocol.io) server for
[easygroupflights.com](https://easygroupflights.com) — IATA-accredited group air
travel, with negotiated fares from 500+ airlines.

It lets an AI assistant do what the website does: work out whether a trip is a
group booking, gather what an agent needs to price it, and put the enquiry in
front of a human — or, for a party too small to be a group, find ordinary
bookable fares.

## Why a group needs a different tool

A group fare is negotiated directly with the airline. It is not sold through any
public booking engine, so no search API can return a price for one. What this
server does instead is submit a complete, structured enquiry and tell the
traveller honestly what happens next: a specialist replies by email in about two
hours, up to 24 for complex routings.

The dividing line is **10 seated travellers**. Lap infants under two don't
occupy a seat and don't count.

## Tools

| Tool | What it does |
| --- | --- |
| `egf_get_service_info` | How group booking works, what the threshold is, what a quote costs and how long it takes. Submits nothing. |
| `egf_prepare_group_quote` | 10+ travellers. Checks the brief and returns exactly what would be sent, with a confirmation token. Sends nothing. |
| `egf_request_group_quote` | Sends a prepared brief to a group specialist. Takes only the token. Returns a confirmation, not a price. |
| `egf_search_flights` | 9 or fewer. Live fares with carriers and stops, each with an `offer_id`. |
| `egf_get_offer` | One fare by `offer_id`: price, flights, a booking link and `valid_until`. |
| `egf_prepare_flight_offer` | Shows the offer email that would be sent, with a confirmation token. Sends nothing. |
| `egf_send_flight_offer` | Emails a prepared offer to the traveller. Takes only the token. |

The four fare tools are withheld from `tools/list` unless `PELIKAN_MCP_URL` is set — an
advertised tool that cannot run is worse than one that isn't there.

`egf_get_service_info` ends with each market's human contacts — website, email,
phone and WhatsApp — so an agent can hand a user to a person.

Every tool:

- sets all four annotations (`readOnlyHint`, `destructiveHint`,
  `idempotentHint`, `openWorldHint`) explicitly. Only the two that send
  something are writes, and none is destructive.
- declares an `outputSchema` and returns `structuredContent` alongside the text.
- takes snake_case inputs.

Writes come in pairs, because not every client asks the user before a write.
The prepare tool returns the summary and a `confirmation_token`, which is
signed with `CONFIRM_SECRET` and valid for 15 minutes. The write takes only
that token, so it cannot send anything the summary did not show.

Both writes accept an optional `idempotency_key`. Without one, the token
itself is the key, so a prepared write is carried out at most once. Keys are
kept for 24 hours, per Cloudflare data centre.

Callers presenting `GATEWAY_TOKEN` as a bearer token are the Tripdesk gateway:

- They get their own rate limit of 1,200 a minute; everyone else gets 60 a
  minute per address.
- Their booking links are left untagged. Direct callers' links get
  `utm_source=mcp`.

Every tool call answers within 28 seconds.

`egf_search_flights` pages with `limit` (default 10, at most 20) and `cursor`.
Each fare carries one opaque `offer_id`, valid for 30 minutes. It is all
`egf_get_offer` and `egf_prepare_flight_offer` need. Search results carry no
booking links, and no session or trip ids.

### Upgrading from 1.x

2.0 renamed the tools with the `egf_` prefix and the inputs to snake_case.
Most of what worked in 1.x still does:

- The old names (`request_group_quote`, …) are still answered, though no longer
  listed.
- camelCase arguments (`departureDate`, `fareId`, …) are read as their
  snake_case names.
- `egf_prepare_flight_offer` still takes the four separate ids a 1.x search
  printed.
- A 1.x one-step write is refused, with a message naming the prepare tool to
  call first.

## Privacy

What the server receives, where it goes and how long it is kept: [easygroupflights.com/mcp-privacy/](https://easygroupflights.com/mcp-privacy/). The controller is pelicantravel.com s.r.o.; privacy questions go to dpo@pelikan.sk.

## Prompts

Guided briefs. In Claude Desktop and claude.ai they are under + → Connectors →
Add from Easygroupflights; in Claude Code they are `/mcp__easygroupflights__<name>`.
Each one walks the user through what the desk needs, plus the questions only that kind of trip raises,
and submits only once the user confirms.

| Prompt | For |
| --- | --- |
| `school-trip` | Schools and universities: pupils and staff separately, ages for supervision ratios, consent forms still coming in |
| `wedding-guests` | Destination weddings: guests from several cities, latest arrival, who pays |
| `sports-team` | Clubs and squads: first-match time, equipment, fixture risk |
| `company-offsite` | Offsites, incentives, conferences: the fixed week, cabin mix, one invoice |
| `pilgrimage` | Parishes and faith groups: how participants pay, accessibility |

Every prompt takes an optional `market` (`en`, `pl`, `at`) plus whatever is
already known: `origin`, `destination`, `dates`, `travellers`.

## Resources

Material an agent can quote rather than recall, each served as markdown under
its public URL — so a cited resource is already a link a reader can follow.

- **Guides**: every content page of the three market sites (16 each, in English,
  Polish and German), read from the `/mcp-resources.json` each site publishes.
- **Studies**: the published EGF Data Desk studies, in English and Polish, read
  from each blog's Ghost Content API. Tables stay tables.

Both are fetched on demand and cached for an hour, so new content reaches agents
without redeploying the server.

## Use it

```bash
claude mcp add --transport http easygroupflights https://mcp.easygroupflights.com/mcp
```

In Claude Desktop or claude.ai: Settings → Connectors → Add custom connector, and
paste `https://mcp.easygroupflights.com/mcp`.

Or in any other MCP client's config:

```json
{
  "mcpServers": {
    "easygroupflights": {
      "type": "http",
      "url": "https://mcp.easygroupflights.com/mcp"
    }
  }
}
```

Transport is streamable HTTP. The server is stateless — it issues no session id
and needs no Durable Objects, because every tool call is self-contained.

## Configuration

Public values live in `wrangler.toml`:

| Variable | Meaning |
| --- | --- |
| `SITE_URL` | Human-facing site, shown in tool output and on the landing page |
| `GROUP_MIN_PASSENGERS` | Party size at which a booking becomes a group. Default 10 |
| `FARE_CURRENCY` | Currency the fare service quotes in. Default EUR |

Three secrets, set with `wrangler secret put`:

| Secret | Meaning |
| --- | --- |
| `AUTOPILOT_URL` | Group-enquiry intake. Infrastructure rather than a credential; a secret only because this repo is public |
| `AUTOPILOT_API_KEY` | Sent as `X-API-Key` to the intake. Without either of these `egf_request_group_quote` refuses rather than failing silently |
| `PELIKAN_MCP_URL` | Streamable-HTTP endpoint of the Pelikan MCP server, which prices sub-group parties. Optional — its tools stay hidden while unset |

## Licence

MIT. See [LICENSE](./LICENSE).

Enquiries are attributed to the bare market domain. Autopilot only processes a
source it recognises, so nothing may be appended to it.

## Develop

```bash
npm install
npm run dev        # wrangler dev on :8787
npm test           # unit tests, no network
npm run typecheck
npm run deploy     # wrangler deploy
```

Put local secrets in `.dev.vars` (gitignored). Leaving `AUTOPILOT_API_KEY` unset
is the safe way to exercise `egf_request_group_quote` end to end: it validates
everything and stops at the intake boundary without creating a real lead.

Drive it by hand with:

```bash
curl -s localhost:8787/mcp -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

`GET /` serves a human-readable page, `/health` a status probe, and
`/.well-known/mcp.json` a manifest for directories.

## Markets

One site per market; the market decides both which brand handles the enquiry and
which domain the lead is attributed to.

| `market` | Site | Language |
| --- | --- | --- |
| `en` | easygroupflights.com | English |
| `pl` | grupoweloty.pl | Polish |
| `at` | gruppenfluege.at | German |
