import type { Env } from '../types.ts'
import { listPrompts } from '../prompts.ts'
import { allTools } from '../tools/index.ts'

/**
 * A directory listing sends people to the endpoint itself, so the root has to
 * be readable by a human as well as callable by a client. It leads with what
 * the server is for and how to connect it; the protocol detail comes after.
 */
const WHEN: Record<string, string> = {
  egf_prepare_group_quote: 'Ten or more travellers. Checks the brief and shows what will be sent.',
  egf_request_group_quote: 'Sends the confirmed brief. A specialist replies by email with a written quote.',
  egf_search_flights: 'Nine or fewer. Live, bookable fares with prices, carriers and stops.',
  egf_get_offer: 'One of those fares: the price, the flights and a booking link.',
  egf_prepare_flight_offer: 'Shows the offer email before anything is sent.',
  egf_send_flight_offer: 'Emails that fare as a formal offer, once the traveller confirms.',
  egf_get_service_info: 'How group fares work, the thresholds, and how to reach a person.',
}

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function homepage(env: Env, origin: string) {
  const endpoint = `${origin}/mcp`
  const config = `{
  "mcpServers": {
    "easygroupflights": {
      "type": "http",
      "url": "${endpoint}"
    }
  }
}`
  const tools = allTools.map(tool => `
      <tr><th scope="row">${tool.title}</th><td>${WHEN[tool.name] ?? ''}<br><code>${tool.name}</code></td></tr>`).join('')
  const prompts = listPrompts().map(p => `<li><strong>${p.title}</strong> <code>/${p.name}</code></li>`).join('')
  const block = (id: string, value: string) => `
  <div class="copy"><pre id="${id}"><code>${escape(value)}</code></pre><button type="button" data-copy="${id}" aria-label="Copy">Copy</button></div>`

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>easygroupflights MCP — group flight quotes from your AI assistant</title>
<meta name="description" content="Connect Claude, Cursor or any MCP client and request a group flight quote for 10+ travellers in plain words. Free, no account, open source.">
<link rel="canonical" href="${origin}/">
<style>
  :root { color-scheme: light dark; --ink: #10201f; --paper: #f6f8f7; --card: #fff; --muted: #55625f; --rule: #dde5e3; --accent: #003a41; --accent-ink: #fff; }
  @media (prefers-color-scheme: dark) { :root { --ink: #e7eeec; --paper: #0e1716; --card: #152120; --muted: #9aaba7; --rule: #26332f; --accent: #6fd3bd; --accent-ink: #062320; } }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 3.5rem 1.25rem 4rem; background: var(--paper); color: var(--ink);
         font: 16px/1.65 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 46rem; margin: 0 auto; }
  .kicker { font: 600 .75rem/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .14em; text-transform: uppercase; color: var(--muted); margin: 0 0 1rem; }
  h1 { font-size: clamp(1.9rem, 5vw, 2.75rem); line-height: 1.1; letter-spacing: -0.025em; margin: 0 0 1rem; }
  .lede { color: var(--muted); font-size: 1.125rem; margin: 0 0 1.75rem; max-width: 38rem; }
  .cta { display: inline-block; background: var(--accent); color: var(--accent-ink); text-decoration: none; font-weight: 600; padding: .7rem 1.1rem; border-radius: .6rem; }
  h2 { font-size: 1.25rem; letter-spacing: -0.01em; margin: 3rem 0 .4rem; }
  .sub { color: var(--muted); margin: 0 0 1rem; }
  .label { font: 600 .72rem/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .14em; text-transform: uppercase; color: var(--muted); margin: 1.5rem 0 .5rem; }
  .note { color: var(--muted); font-size: .92rem; margin: -.25rem 0 .5rem; }
  .copy { display: flex; gap: .5rem; align-items: flex-start; }
  pre { flex: 1; min-width: 0; background: var(--card); border: 1px solid var(--rule); border-radius: .6rem; padding: .85rem 1rem; overflow-x: auto; font-size: .85rem; margin: 0; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  button { flex: none; font: inherit; font-size: .85rem; padding: .55rem .8rem; border-radius: .6rem; border: 1px solid var(--rule); background: var(--card); color: var(--ink); cursor: pointer; }
  ol.steps { padding-left: 1.25rem; } ol.steps li { margin: .35rem 0; }
  table { width: 100%; border-collapse: collapse; font-size: .95rem; background: var(--card); border: 1px solid var(--rule); border-radius: .6rem; overflow: hidden; }
  th, td { text-align: left; padding: .75rem 1rem; border-bottom: 1px solid var(--rule); vertical-align: top; }
  tr:last-child th, tr:last-child td { border-bottom: 0; }
  th { font-weight: 600; width: 38%; } td { color: var(--muted); } td code { font-size: .8rem; }
  ul.prompts { list-style: none; padding: 0; display: grid; gap: .5rem; grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr)); }
  ul.prompts li { background: var(--card); border: 1px solid var(--rule); border-radius: .6rem; padding: .7rem .9rem; }
  ul.prompts code { display: block; margin-top: .2rem; color: var(--muted); font-size: .8rem; }
  a { color: var(--accent); }
  footer { margin-top: 3.5rem; padding-top: 1.5rem; border-top: 1px solid var(--rule); color: var(--muted); font-size: .9rem; }
</style>
</head>
<body>
<main>
  <p class="kicker">easygroupflights · Model Context Protocol</p>
  <h1>Group flight quotes, from inside your AI assistant</h1>
  <p class="lede">Connect this server to Claude, Cursor or any MCP client, then ask for a group fare in plain words. A specialist at easygroupflights replies with a written quote for ten or more travellers. Free, no account, no API key.</p>
  <a class="cta" href="#connect">Connect in 30 seconds</a>

  <h2 id="connect">Connect</h2>
  <p class="sub">Pick the app you use.</p>
  <p class="label">Claude Code</p>${block('cc', `claude mcp add --transport http easygroupflights ${endpoint}`)}
  <p class="label">Claude Desktop or claude.ai</p>
  <p class="note">Settings → Connectors → Add custom connector, then paste this address.</p>${block('url', endpoint)}
  <p class="label">Cursor and other MCP clients</p>
  <p class="note">Add this to the client's mcp.json.</p>${block('json', config)}

  <h2>What happens after you ask</h2>
  <ol class="steps">
    <li>Describe the trip: who is going, from where, when and roughly how many.</li>
    <li>The agent asks for anything missing, including an email address and phone number for the reply.</li>
    <li>It sends one complete enquiry to the group desk for your market.</li>
    <li>A specialist negotiates with the airlines and replies by email with a written quote, usually within about two hours. The price is locked for the whole group, seats are held together, and the quote costs nothing.</li>
  </ol>

  <h2>Tools</h2>
  <table>${tools}
  </table>

  <h2>Guided briefs</h2>
  <p class="sub">Each walks the user through the brief the desk needs. In Claude Desktop and claude.ai: + → Connectors → Add from Easygroupflights. In Claude Code: <code>/mcp__easygroupflights__school-trip</code> and so on.</p>
  <ul class="prompts">${prompts}</ul>

  <h2>Resources an agent can cite</h2>
  <p class="sub">The guide pages for all three markets, in English, Polish and German, and the published EGF Data Desk studies, each served as markdown under its public URL. Quote these rather than figures from memory.</p>

  <footer>
    A service of <a href="${env.SITE_URL}">easygroupflights.com</a>, grupoweloty.pl and gruppenfluege.at — IATA-accredited group air travel.
    Open source under the MIT licence: <a href="https://github.com/codeblockssk/easygroupflights-mcp">github.com/codeblockssk/easygroupflights-mcp</a>.
    Listed in the official MCP registry as <code>com.easygroupflights/easygroupflights</code>.
    <a href="${env.SITE_URL}/mcp-privacy/">Privacy notice</a>.
  </footer>
</main>
<script>
  document.querySelectorAll('button[data-copy]').forEach(function (b) {
    b.addEventListener('click', function () {
      var t = document.getElementById(b.dataset.copy).innerText
      if (navigator.clipboard) navigator.clipboard.writeText(t).then(function () { b.textContent = 'Copied'; setTimeout(function () { b.textContent = 'Copy' }, 2000) })
    })
  })
</script>
</body>
</html>`
}
