import type { Env } from '../types.ts'
import { allTools } from '../tools/index.ts'

/**
 * A directory listing sends people to the endpoint itself, so the root has to
 * be readable by a human as well as callable by a client.
 */
export function homepage(env: Env, origin: string) {
  const rows = allTools.map(tool => `
      <tr>
        <th scope="row"><code>${tool.name}</code></th>
        <td>${tool.title}</td>
      </tr>`).join('')

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>easygroupflights MCP</title>
<meta name="description" content="Model Context Protocol server for easygroupflights.com — group flight quotes for parties of 10 or more.">
<link rel="canonical" href="${origin}/">
<style>
  :root { color-scheme: light dark; --ink: #14181d; --paper: #fbfaf8; --muted: #5d6570; --rule: #e3e0da; --accent: #0f5d4f; }
  @media (prefers-color-scheme: dark) { :root { --ink: #eceae6; --paper: #14171a; --muted: #99a1ab; --rule: #2a2f35; --accent: #6fd3bd; } }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 4rem 1.5rem; background: var(--paper); color: var(--ink);
         font: 16px/1.65 ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif; }
  main { max-width: 44rem; margin: 0 auto; }
  h1 { font-size: clamp(1.75rem, 4vw, 2.5rem); line-height: 1.15; letter-spacing: -0.02em; margin: 0 0 .5rem; }
  .lede { color: var(--muted); font-size: 1.1rem; margin: 0 0 2.5rem; }
  h2 { font-size: .8rem; text-transform: uppercase; letter-spacing: .1em; color: var(--muted);
       margin: 2.5rem 0 .75rem; font-weight: 600; }
  pre { background: color-mix(in oklab, var(--ink) 6%, transparent); border: 1px solid var(--rule);
        border-radius: .5rem; padding: 1rem; overflow-x: auto; font-size: .875rem; margin: 0; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  table { width: 100%; border-collapse: collapse; font-size: .95rem; }
  th, td { text-align: left; padding: .6rem 0; border-bottom: 1px solid var(--rule); vertical-align: top; }
  th { font-weight: 500; width: 45%; }
  td { color: var(--muted); }
  a { color: var(--accent); }
  footer { margin-top: 3rem; padding-top: 1.5rem; border-top: 1px solid var(--rule); color: var(--muted); font-size: .9rem; }
</style>
</head>
<body>
<main>
  <h1>easygroupflights MCP</h1>
  <p class="lede">Group flight quotes for parties of ten or more, as a Model Context Protocol server.</p>

  <h2>Endpoint</h2>
  <pre><code>${origin}/mcp</code></pre>

  <h2>Claude Code</h2>
  <pre><code>claude mcp add --transport http easygroupflights ${origin}/mcp</code></pre>

  <h2>Any MCP client</h2>
  <pre><code>{
  "mcpServers": {
    "easygroupflights": {
      "type": "http",
      "url": "${origin}/mcp"
    }
  }
}</code></pre>

  <h2>Tools</h2>
  <table>${rows}
  </table>

  <footer>
    A service of <a href="${env.SITE_URL}">easygroupflights.com</a> — IATA-accredited group air travel,
    negotiated fares with 500+ airlines.
  </footer>
</main>
</body>
</html>`
}
