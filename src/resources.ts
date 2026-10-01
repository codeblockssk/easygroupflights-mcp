import type { Env } from './types.ts'
import { htmlToMarkdown } from './lib/markdown.ts'
import { MARKETS } from './lib/markets.ts'

/**
 * Citable material for agents: each market's guide pages and the published
 * studies, served as MCP resources so an agent can quote them instead of
 * paraphrasing from memory. The URI of every resource is the page's public
 * URL, so a resource that gets cited is already a link a reader can follow.
 *
 * Guides come from the /mcp-resources.json the website build emits for each
 * market — the same markdown as its llms-full.txt. Studies come from the
 * blog's Ghost Content API. Both are fetched on demand and cached for an hour
 * at the edge, so a new page or an edited study reaches agents without a
 * redeploy here.
 */
interface Guide { uri: string, title: string, description: string, markdown: string }

// The three EGF Data Desk studies, by market. Austria has no blog yet, so it
// lists the English studies.
const STUDIES = {
  en: ['egf-group-policy-matrix-2026', 'egf-group-vs-diy-decision-matrix-2026', 'egf-school-group-flight-calendar-2026'],
  pl: ['okna-rezerwacji-grupowych-linii-2026', 'taryfa-grupowa-czy-samodzielnie-matryca-2026', 'kalendarz-lotow-grupowych-dla-szkol-2026'],
} as const

const BLOG = { en: 'https://easygroupflights.com/blog', pl: 'https://grupoweloty.pl/blog' } as const
// The timeout is renewed per request: AbortSignal.timeout starts when it is made.
const CACHE = { cf: { cacheTtl: 3600, cacheEverything: true } } as RequestInit
const cached = (): RequestInit => ({ ...CACHE, signal: AbortSignal.timeout(8_000) })

function contentKey(env: Env, blog: keyof typeof BLOG) {
  return blog === 'pl' ? env.GHOST_CONTENT_KEY_PL : env.GHOST_CONTENT_KEY_EN
}

async function guides(domain: string): Promise<Guide[]> {
  const res = await fetch(`https://${domain}/mcp-resources.json`, cached())
  return res.ok ? res.json() as Promise<Guide[]> : []
}

async function studyIndex(env: Env, blog: keyof typeof BLOG) {
  const key = contentKey(env, blog)
  if (!key)
    return []
  const filter = `slug:[${STUDIES[blog].join(',')}]`
  const res = await fetch(`${BLOG[blog]}/ghost/api/content/posts/?key=${key}&filter=${encodeURIComponent(filter)}&fields=slug,title,custom_excerpt,url&limit=all`, cached())
  if (!res.ok)
    return []
  const { posts } = await res.json() as { posts: { slug: string, title: string, custom_excerpt: string | null }[] }
  return posts.map(p => ({ uri: `${BLOG[blog]}/${p.slug}/`, title: p.title, description: p.custom_excerpt ?? '' }))
}

export async function listResources(env: Env) {
  const lists = await Promise.all([
    ...Object.entries(MARKETS).map(async ([, m]) => (await guides(m.domain)).map(g => ({
      uri: g.uri,
      name: g.uri.replace(/^https:\/\//, '').replace(/\/$/, ''),
      title: g.title,
      description: `${g.description} (${m.language}, ${m.domain})`,
      mimeType: 'text/markdown',
    }))),
    ...(['en', 'pl'] as const).map(async blog => (await studyIndex(env, blog)).map(s => ({
      uri: s.uri,
      name: s.uri.replace(/^https:\/\//, '').replace(/\/$/, ''),
      title: `Study: ${s.title}`,
      description: s.description,
      mimeType: 'text/markdown',
    }))),
  ])
  return lists.flat()
}

export async function readResource(uri: string, env: Env) {
  for (const [blog, base] of Object.entries(BLOG) as [keyof typeof BLOG, string][]) {
    const slug = uri.startsWith(`${base}/`) ? uri.slice(base.length + 1).replace(/\/$/, '') : ''
    if (slug && (STUDIES[blog] as readonly string[]).includes(slug)) {
      const key = contentKey(env, blog)
      const res = await fetch(`${base}/ghost/api/content/posts/slug/${slug}/?key=${key}&formats=html&fields=title,html,url,published_at`, cached())
      if (!res.ok)
        return null
      const { posts: [post] } = await res.json() as { posts: { title: string, html: string, published_at: string }[] }
      return `# ${post.title}\n\n${uri}\n\nPublished ${post.published_at.slice(0, 10)} by the EGF Data Desk.\n\n${htmlToMarkdown(post.html)}`
    }
  }
  const market = Object.values(MARKETS).find(m => uri.startsWith(`https://${m.domain}/`))
  if (!market)
    return null
  const guide = (await guides(market.domain)).find(g => g.uri === uri)
  return guide ? guide.markdown : null
}
