/**
 * Ghost post HTML to markdown, enough for an agent to quote a study.
 *
 * Not a general converter. It covers what the published studies contain —
 * headings, paragraphs, lists, block quotes, links, emphasis and tables — and
 * drops everything else as plain text. Tables are the reason it exists: the
 * airline booking-window figures live in them, and flattening a table to
 * prose loses which number belongs to which region.
 */
const ENTITIES: Record<string, string> = { 'amp': '&', 'lt': '<', 'gt': '>', 'quot': '"', 'apos': '\'', 'nbsp': ' ', '#39': '\'' }

function decode(text: string) {
  return text
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&([a-z#0-9]+);/gi, (match, name) => ENTITIES[name.toLowerCase()] ?? match)
}

function inline(html: string) {
  return decode(html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<a\s[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gis, (_, href, text) => `[${text.replace(/<[^>]+>/g, '')}](${href.replace(/[?&]ref=[^&#"]*/, '')})`)
    .replace(/<(strong|b)\b[^>]*>(.*?)<\/\1>/gis, '**$2**')
    .replace(/<(em|i)\b[^>]*>(.*?)<\/\1>/gis, '*$2*')
    .replace(/<code\b[^>]*>(.*?)<\/code>/gis, '`$1`')
    .replace(/<[^>]+>/g, ''))
    .replace(/\s+/g, ' ')
    .trim()
}

function table(html: string) {
  const rows = [...html.matchAll(/<tr\b[^>]*>(.*?)<\/tr>/gis)].map(row =>
    [...row[1].matchAll(/<t[hd]\b[^>]*>(.*?)<\/t[hd]>/gis)].map(cell => inline(cell[1]).replace(/\|/g, '\\|')))
  if (!rows.length)
    return ''
  const width = Math.max(...rows.map(r => r.length))
  const line = (cells: string[]) => `| ${[...cells, ...Array.from({ length: width - cells.length }).fill('')].join(' | ')} |`
  return [line(rows[0]), `|${' --- |'.repeat(width)}`, ...rows.slice(1).map(line)].join('\n')
}

export function htmlToMarkdown(html: string) {
  const out: string[] = []
  const re = /<(h[1-6]|p|ul|ol|blockquote|table|figure|pre)\b[^>]*>(.*?)<\/\1>/gis
  for (const [, tag, body] of html.matchAll(re)) {
    const t = tag.toLowerCase()
    if (t[0] === 'h') {
      out.push(`${'#'.repeat(Math.min(Number(t[1]) + 1, 6))} ${inline(body)}`)
    }
    else if (t === 'ul' || t === 'ol') {
      out.push([...body.matchAll(/<li\b[^>]*>(.*?)<\/li>/gis)].map((li, i) => `${t === 'ol' ? `${i + 1}.` : '-'} ${inline(li[1])}`).join('\n'))
    }
    else if (t === 'blockquote') {
      out.push(`> ${inline(body)}`)
    }
    else if (t === 'table') {
      out.push(table(body))
    }
    else if (t === 'figure') {
      const inner = body.match(/<table\b[^>]*>(.*?)<\/table>/is)
      if (inner)
        out.push(table(inner[1]))
    }
    else if (t === 'pre') {
      out.push(`\`\`\`\n${decode(body.replace(/<[^>]+>/g, ''))}\n\`\`\``)
    }
    else {
      const text = inline(body)
      if (text)
        out.push(text)
    }
  }
  return out.filter(Boolean).join('\n\n')
}
