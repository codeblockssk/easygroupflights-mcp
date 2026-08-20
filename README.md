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
| `get_service_info` | How group booking works, what the threshold is, what a quote costs and how long it takes. Submits nothing. |
| `request_group_quote` | 10+ travellers. Submits a structured enquiry to a group specialist. Returns a confirmation, not a price. |
| `search_flights` | 9 or fewer. Live bookable fares with carriers, stops and a booking link. |
| `send_flight_offer` | Emails one of those fares to the traveller as a formal offer. |

The last two are withheld from `tools/list` unless `PELIKAN_MCP_URL` is set — an
advertised tool that cannot run is worse than one that isn't there.

## Use it

```bash
claude mcp add --transport http easygroupflights https://mcp.easygroupflights.com/mcp
```

Or in any MCP client's config:

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
| `AUTOPILOT_API_KEY` | Sent as `X-API-Key` to the intake. Without either of these `request_group_quote` refuses rather than failing silently |
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
is the safe way to exercise `request_group_quote` end to end: it validates
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
