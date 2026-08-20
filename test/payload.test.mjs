// The group enquiry has to reach the CRM in exactly the shape the website's
// widget sends, field for field. A silent rename here produces leads that look
// fine to us and are wrong downstream — the same failure mode as the widget's
// market defaults, so it is worth pinning.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildPayload, markNote } from '../src/lib/autopilot.ts'
import { leadSource } from '../src/lib/markets.ts'

// Read off the shipped widget bundle at 1.0.36.
const WIDGET_FIELDS = [
  'phoneNumber',
  'email',
  'firstName',
  'lastName',
  'note',
  'cabinClass',
  'cityOrigin',
  'cityDestination',
  'cityOriginBacktrip',
  'cityDestinationBacktrip',
  'dateDepartureThere',
  'dateDepartureBack',
  'passengers',
  'daysRange',
  'source',
]
const WIDGET_PASSENGER_FIELDS = ['adults', 'youths', 'children', 'infants', 'youthsAge', 'childrenAge']

const request = {
  market: 'pl',
  email: 'organiser@example.com',
  phoneNumber: '+48123456789',
  firstName: 'Anna',
  lastName: 'Nowak',
  note: 'School trip',
  cabinClass: 'economy',
  cityOrigin: ['WAW'],
  cityDestination: ['BCN'],
  cityOriginBacktrip: ['BCN'],
  cityDestinationBacktrip: ['WAW'],
  dateDepartureThere: '2026-10-15',
  dateDepartureBack: '2026-10-22',
  passengers: { adults: 20, youths: 0, children: 4, infants: 0, youthsAge: [], childrenAge: [8, 9, 10, 11] },
  daysRange: 0,
}

test('payload carries every field the widget sends, and no others', () => {
  const payload = buildPayload(request)
  assert.deepEqual(Object.keys(payload).sort(), [...WIDGET_FIELDS].sort())
  assert.deepEqual(Object.keys(payload.passengers).sort(), [...WIDGET_PASSENGER_FIELDS].sort())
})

test('market never leaks into the payload — it only picks the source', () => {
  const payload = buildPayload(request)
  assert.equal('market' in payload, false)
  assert.equal(payload.source, 'grupoweloty.pl')
})

test('source is the bare market domain — Autopilot rejects anything appended', () => {
  assert.equal(leadSource('en'), 'easygroupflights.com')
  assert.equal(leadSource('pl'), 'grupoweloty.pl')
  assert.equal(leadSource('at'), 'gruppenfluege.at')
})

test('the note carries the MCP marker, since the source cannot', () => {
  assert.equal(markNote('Year 10 school trip'), 'MCP: Year 10 school trip')
  assert.equal(markNote(undefined), 'MCP')
  assert.equal(markNote(''), 'MCP')
  assert.ok(markNote('anything').startsWith('MCP'))
})

test('a one-way enquiry still sends both date keys', () => {
  const payload = buildPayload({ ...request, dateDepartureBack: undefined })
  assert.ok('dateDepartureBack' in payload)
  assert.equal(payload.dateDepartureBack, undefined)
})
