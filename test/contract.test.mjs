// The tool definitions are republished unchanged by every client and directory
// that lists the server, so their shape is pinned here rather than trusted.
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { test } from 'node:test'
import { handleRpc } from '../src/lib/protocol.ts'
import { allTools } from '../src/tools/index.ts'

const env = { GROUP_MIN_PASSENGERS: '10', CONFIRM_SECRET: 'test-secret' }
const rpc = async (method, params, tools = allTools) => (await handleRpc({ jsonrpc: '2.0', id: 1, method, params }, tools, env)).payload

const HINTS = ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint']
const BANNED = ['$ref', '$defs', 'anyOf', 'oneOf', 'allOf', 'additionalProperties', 'patternProperties', 'format']

function keys(schema, found = []) {
  if (schema && typeof schema === 'object') {
    for (const [k, v] of Object.entries(schema)) {
      found.push(k)
      if (k !== 'properties' || typeof v !== 'object')
        keys(v, found)
      else
        Object.values(v).forEach(p => keys(p, found))
    }
  }
  return found
}

test('every tool sets all four annotations explicitly, as booleans', async () => {
  for (const tool of (await rpc('tools/list')).result.tools)
    assert.deepEqual(HINTS.map(h => typeof tool.annotations?.[h]), HINTS.map(() => 'boolean'), tool.name)
})

test('only the two writes are non-read-only, and nothing is destructive', () => {
  assert.ok(allTools.length < 10)
  const writes = allTools.filter(t => !t.annotations.readOnlyHint).map(t => t.name).sort()
  assert.deepEqual(writes, ['egf_request_group_quote', 'egf_send_flight_offer'])
  assert.ok(allTools.every(t => !t.annotations.destructiveHint))
})

test('every write accepts an idempotency_key', () => {
  for (const tool of allTools.filter(t => !t.annotations.readOnlyHint)) {
    assert.ok(tool.idempotent, tool.name)
    assert.equal(tool.inputSchema.properties.idempotency_key?.type, 'string', tool.name)
  }
})

test('every tool declares an object outputSchema and lists it', async () => {
  for (const tool of (await rpc('tools/list')).result.tools)
    assert.equal(tool.outputSchema?.type, 'object', tool.name)
})

test('descriptions are one to three sentences, name no other tool and quote no saving', () => {
  const names = allTools.map(t => t.name)
  for (const tool of allTools) {
    const sentences = tool.description.split(/(?<=[.!?])\s+(?=[A-Z])/).length
    assert.ok(sentences <= 3, `${tool.name}: ${sentences} sentences`)
    assert.ok(!/%/.test(tool.description), `${tool.name} quotes a percentage`)
    for (const other of names.filter(n => n !== tool.name))
      assert.ok(!tool.description.includes(other), `${tool.name} names ${other}`)
  }
})

test('input schemas stay inside the subset every platform accepts', () => {
  for (const tool of allTools) {
    const used = keys(tool.inputSchema)
    assert.deepEqual(BANNED.filter(k => used.includes(k)), [], tool.name)
  }
})

test('a call returns the prose and a structuredContent that fits its outputSchema', async () => {
  const { result } = await rpc('tools/call', { name: 'egf_get_service_info', arguments: { market: 'pl' } })
  assert.match(result.content[0].text, /grupoweloty\.pl/)
  const schema = allTools.find(t => t.name === 'egf_get_service_info').outputSchema
  for (const field of schema.required)
    assert.ok(field in result.structuredContent, field)
  assert.equal(result.structuredContent.contact.whatsapp_url, 'https://wa.me/48452664056')
  assert.equal(result.structuredContent.website, 'https://grupoweloty.pl')
})

test('a failing tool is an isError result, not a protocol error', async () => {
  const { result } = await rpc('tools/call', { name: 'egf_prepare_group_quote', arguments: { adults: 3 } })
  assert.equal(result.isError, true)
  assert.match(result.content[0].text, /group fare needs 10/)
})

test('2025-11-25 is spoken, and preferred when nothing is asked for', async () => {
  assert.equal((await rpc('initialize', { protocolVersion: '2025-11-25' })).result.protocolVersion, '2025-11-25')
  assert.equal((await rpc('initialize', { protocolVersion: '1999-01-01' })).result.protocolVersion, '2025-11-25')
})

test('names carry the egf_ prefix, a verb, and fit every platform', () => {
  for (const tool of allTools) {
    assert.match(tool.name, /^egf_(?:get|prepare|request|search|send)_[a-z0-9_]+$/)
    assert.ok(tool.name.length < 40, tool.name)
  }
})

test('every input property is snake_case', () => {
  for (const tool of allTools) {
    for (const key of Object.keys(tool.inputSchema.properties))
      assert.match(key, /^[a-z][a-z0-9_]*$/, `${tool.name}.${key}`)
  }
})

test('a pre-2.0 name is still answered, but not listed', async () => {
  const { result } = await rpc('tools/call', { name: 'get_service_info', arguments: {} })
  assert.equal(result.structuredContent.market, 'en')
  const listed = (await rpc('tools/list')).result.tools.map(t => t.name)
  assert.ok(!listed.includes('get_service_info'))
})

test('pre-2.0 camelCase arguments are read as their snake_case names', async () => {
  const { snakeKeys } = await import('../src/lib/protocol.ts')
  assert.deepEqual(snakeKeys({ departureDate: '2026-11-12', youthsAges: [13], fareId: 'x' }), { departure_date: '2026-11-12', youths_ages: [13], fare_id: 'x' })
  assert.deepEqual(snakeKeys({ departureDate: 'old', departure_date: 'new' }), { departure_date: 'new' })
})

test('an offer_id carries the ids, the fare and its link, and nothing readable', async () => {
  const { decodeOffer, encodeOffer } = await import('../src/lib/offer.ts')
  const ids = { fare: '20000', there: '0', back: '0', session: 'fa23b208b6d04a929a57dd7ae7b031c0' }
  const details = { price: 59.9, carriers: ['Vueling'], stops_out: 0, departure: '2026-11-12T20:55', flight_numbers: ['VY1261'] }
  const link = 'https://www.pelikan.sk/sk/let/20000/0//detail/?tabIdentifier=fa23b208b6d04a929a57dd7ae7b031c0'
  const offer = await encodeOffer({ ids, details, link }, env)
  assert.match(offer, /^of_[\w-]+\.[\w-]+$/)
  assert.ok(!offer.includes(ids.session))
  const decoded = await decodeOffer(offer, env)
  assert.deepEqual([decoded.ids, decoded.details, decoded.link], [ids, details, link])
  assert.ok(Math.abs(decoded.issued - Date.now() / 1000) < 5)
  await assert.rejects(decodeOffer('of_nonsense', env), /not one a flight search returned/)
  await assert.rejects(decodeOffer(await encodeOffer({ ids }, env, Math.floor(Date.now() / 1000) - 1801), env), /expired/)
})

test('a 2.0.0 offer_id, plain JSON with four ids, still decodes', async () => {
  const { decodeOffer } = await import('../src/lib/offer.ts')
  const legacy = `of_${Buffer.from(JSON.stringify(['20000', '0', '0', 'sess'])).toString('base64url')}`
  assert.deepEqual((await decodeOffer(legacy, env)).ids, { fare: '20000', there: '0', back: '0', session: 'sess' })
})

test('the a_aid=None the fare service writes is dropped; a real a_aid is kept', async () => {
  const { cleanLink } = await import('../src/lib/offer.ts')
  assert.equal(cleanLink('https://www.pelikan.sk/sk/let/1/0//detail/?tabIdentifier=x&a_aid=None'), 'https://www.pelikan.sk/sk/let/1/0//detail/?tabIdentifier=x')
  assert.equal(cleanLink('https://www.pelikan.sk/x/?a_aid=egf42'), 'https://www.pelikan.sk/x/?a_aid=egf42')
})

test('egf_get_offer answers from the offer_id alone, with no cache and no search', async () => {
  const { encodeOffer } = await import('../src/lib/offer.ts')
  const offer_id = await encodeOffer({
    ids: { fare: '1', there: '0', back: '0', session: 's' },
    details: { price: 10, carriers: ['Ryanair'], flight_numbers: ['FR13'] },
    link: 'https://www.pelikan.sk/sk/let/1/0//detail/?tabIdentifier=s',
  }, env)
  const direct = (await rpc('tools/call', { name: 'egf_get_offer', arguments: { offer_id } })).result
  assert.ok(!direct.isError, direct.content[0].text)
  assert.equal(direct.structuredContent.booking_url, 'https://www.pelikan.sk/sk/let/1/0//detail/?tabIdentifier=s&utm_source=mcp')
  assert.match(direct.structuredContent.valid_until, /^\d{4}-\d\d-\d\dT/)
})

test('no output schema exposes a session or upstream id', () => {
  const text = JSON.stringify(allTools.map(t => t.outputSchema))
  for (const leak of ['session_id', 'fare_id', 'there_trip_id', 'back_trip_id'])
    assert.ok(!text.includes(leak), leak)
})

const BRIEF = { origin: ['VIE'], destination: ['BCN'], departure_date: '2027-05-10', adults: 12, email: 'organiser@example.com', phone: '+421947797797', market: 'at' }

test('every write takes only a confirmation token and has a read-only prepare step', () => {
  for (const [prepare, write] of [['egf_prepare_group_quote', 'egf_request_group_quote'], ['egf_prepare_flight_offer', 'egf_send_flight_offer']]) {
    const p = allTools.find(t => t.name === prepare)
    const w = allTools.find(t => t.name === write)
    assert.equal(p.annotations.readOnlyHint, true, prepare)
    assert.deepEqual(w.inputSchema.required, ['confirmation_token'], write)
    assert.ok(p.outputSchema.required.includes('confirmation_token'), prepare)
  }
})

test('preparing a quote returns the brief and a token, and sends nothing', async () => {
  const { result } = await rpc('tools/call', { name: 'egf_prepare_group_quote', arguments: BRIEF })
  assert.ok(!result.isError, result.content[0].text)
  assert.equal(result.structuredContent.domain, 'gruppenfluege.at')
  assert.equal(result.structuredContent.seats, 12)
  assert.match(result.structuredContent.confirmation_token, /^ct_/)
  assert.match(result.content[0].text, /Not sent yet/)
})

test('a write refuses raw details, a forged token and another action\'s token', async () => {
  const { redeemToken, issueToken } = await import('../src/lib/confirm.ts')
  const call = async args => (await rpc('tools/call', { name: 'egf_request_group_quote', arguments: args })).result
  assert.match((await call(BRIEF)).content[0].text, /egf_prepare_group_quote/)

  const { token } = await issueToken('group_quote', { x: 1 }, env)
  const [body, sig] = token.split('.')
  const forged = `${body.slice(0, -2)}AA.${sig}`
  await assert.rejects(redeemToken('group_quote', forged, env), /not valid/)
  await assert.rejects(redeemToken('flight_offer', token, env), /different action/)
  await assert.rejects(redeemToken('group_quote', token, { ...env, CONFIRM_SECRET: 'other' }), /not valid/)
  assert.deepEqual(await redeemToken('group_quote', token, env), { x: 1 })
})

test('without a signing secret, nothing can be prepared to send', async () => {
  const { result } = await handleRpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'egf_prepare_group_quote', arguments: BRIEF } }, allTools, { GROUP_MIN_PASSENGERS: '10' }).then(r => r.payload)
  assert.equal(result.isError, true)
  assert.match(result.content[0].text, /not configured/)
})

test('booking links are tagged for direct callers and left alone for the gateway', async () => {
  const { tagLink } = await import('../src/tools/get-offer.ts')
  assert.equal(tagLink('https://www.pelikan.sk/sk/let/1/0/?a=b', { gateway: false }), 'https://www.pelikan.sk/sk/let/1/0/?a=b&utm_source=mcp')
  assert.equal(tagLink('https://www.pelikan.sk/sk/let/1/0/?a=b', { gateway: true }), 'https://www.pelikan.sk/sk/let/1/0/?a=b')
})

test('search results carry offer_ids, not booking links', () => {
  const search = allTools.find(t => t.name === 'egf_search_flights')
  const fare = search.outputSchema.properties.fares.items.properties
  assert.ok('offer_id' in fare)
  assert.ok(!('booking_url' in fare))
  const offer = allTools.find(t => t.name === 'egf_get_offer').outputSchema
  assert.ok(offer.required.includes('booking_url') && offer.required.includes('valid_until'))
  assert.ok(!JSON.stringify(allTools.map(t => t.outputSchema)).includes('handoff'))
})

test('a forged offer_id cannot put its own link in front of the traveller', async () => {
  const { encodeOffer } = await import('../src/lib/offer.ts')
  const offer = { ids: { fare: '1', there: '0', back: '0', session: 's' }, details: { price: 1, carriers: ['X'], flight_numbers: [] }, link: 'https://evil.example/book' }
  const forged = await encodeOffer(offer, { CONFIRM_SECRET: 'attacker' })
  const { result } = await rpc('tools/call', { name: 'egf_get_offer', arguments: { offer_id: forged } })
  assert.equal(result.isError, true)
  const unsigned = forged.split('.')[0]
  const second = (await rpc('tools/call', { name: 'egf_get_offer', arguments: { offer_id: unsigned } })).result
  assert.equal(second.isError, true)
  assert.ok(!second.content[0].text.includes('evil.example'))
})

test('every listed tool repeats its title in annotations, where the directory reads it', async () => {
  for (const tool of (await rpc('tools/list')).result.tools)
    assert.equal(tool.annotations.title, tool.title, tool.name)
})
