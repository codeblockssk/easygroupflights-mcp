import assert from 'node:assert/strict'
import { test } from 'node:test'
import { airports, email, int, isoDate, phone } from '../src/lib/validate.ts'
import { ToolError } from '../src/types.ts'

const rejects = (fn, match) => assert.throws(fn, e => e instanceof ToolError && match.test(e.message))

test('airport codes are normalised, not merely accepted', () => {
  assert.deepEqual(airports({ o: 'lhr' }, 'o', 'origin'), ['LHR'])
  assert.deepEqual(airports({ o: ['lhr', ' bcn '] }, 'o', 'origin'), ['LHR', 'BCN'])
})

test('a city name is refused with the shape that would work', () => {
  rejects(() => airports({ o: 'London' }, 'o', 'origin'), /three letters/)
})

test('an email without a domain is refused', () => {
  rejects(() => email({ email: 'nobody@localhost' }), /not a valid email/)
  assert.equal(email({ email: ' a@b.co ' }), 'a@b.co')
})

test('phone numbers must carry a country code', () => {
  assert.equal(phone({ phone: '+44 1244 568-183' }), '+441244568183')
  rejects(() => phone({ phone: '01244568183' }), /country code/)
})

test('dates must be real, not merely well-shaped', () => {
  assert.equal(isoDate({ d: '2026-10-15' }, 'd', 'Date', true), '2026-10-15')
  rejects(() => isoDate({ d: '15/10/2026' }, 'd', 'Date', true), /YYYY-MM-DD/)
  rejects(() => isoDate({ d: '2026-13-45' }, 'd', 'Date', true), /not a real date/)
})

test('passenger counts reject fractions and negatives', () => {
  assert.equal(int({ n: '12' }, 'n'), 12)
  rejects(() => int({ n: 2.5 }, 'n'), /whole number/)
  rejects(() => int({ n: -3 }, 'n'), /whole number/)
})
