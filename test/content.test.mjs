import assert from 'node:assert/strict'
import { test } from 'node:test'
import { htmlToMarkdown } from '../src/lib/markdown.ts'
import { MARKETS, whatsappLink } from '../src/lib/markets.ts'
import { handleRpc } from '../src/lib/protocol.ts'
import { getPrompt, listPrompts } from '../src/prompts.ts'

const rpc = async (method, params) => (await handleRpc({ jsonrpc: '2.0', id: 1, method, params }, [], { GROUP_MIN_PASSENGERS: '10' })).payload

test('a study table survives as a markdown table, cell for cell', () => {
  const md = htmlToMarkdown('<table><tr><th>For travel</th><th>Up to</th></tr><tr><td>To Europe</td><td><strong>331 days</strong></td></tr></table>')
  assert.equal(md, '| For travel | Up to |\n| --- | --- |\n| To Europe | **331 days** |')
})

test('links keep their target and lose the tracking tag', () => {
  assert.equal(htmlToMarkdown('<p>See <a href="https://x.com/a/?ref=easygroupflights.com">this</a> &amp; that.</p>'), 'See [this](https://x.com/a/) & that.')
})

test('a WhatsApp number becomes a wa.me link of digits only', () => {
  assert.equal(whatsappLink(MARKETS.pl.contact.whatsapp), 'https://wa.me/48452664056')
})

test('initialize advertises tools, resources and prompts', async () => {
  const { result } = await rpc('initialize', { protocolVersion: '2025-06-18' })
  assert.deepEqual(Object.keys(result.capabilities).sort(), ['prompts', 'resources', 'tools'])
  assert.equal(result.serverInfo.version, '2.0.0')
})

test('every prompt is listed with the market argument', () => {
  const names = listPrompts().map(p => p.name)
  assert.deepEqual(names, ['school-trip', 'wedding-guests', 'sports-team', 'company-offsite', 'pilgrimage'])
  for (const p of listPrompts())
    assert.ok(p.arguments.some(a => a.name === 'market'))
})

test('a prompt routes to the market asked for and asks before submitting', () => {
  const text = getPrompt('school-trip', { market: 'pl', travellers: '42' }).messages[0].content.text
  assert.match(text, /grupoweloty\.pl/)
  assert.match(text, /market "pl"/)
  assert.match(text, /travellers: 42/)
  assert.match(text, /egf_prepare_group_quote[\s\S]+Only once I confirm[\s\S]+confirmation_token/)
  assert.match(text, /1 adult per 20 minors/)
})

test('an unknown prompt or resource is an invalid-params error, not a crash', async () => {
  assert.equal((await rpc('prompts/get', { name: 'nope' })).error.code, -32602)
  assert.equal((await rpc('resources/read', { uri: 'https://example.com/x/' })).error.code, -32602)
})

test('two requests that differ only in key order fingerprint the same', async () => {
  const { canonical } = await import('../src/lib/cache.ts')
  assert.equal(canonical({ b: 1, a: [{ y: 2, x: 1 }] }), canonical({ a: [{ x: 1, y: 2 }], b: 1 }))
})
