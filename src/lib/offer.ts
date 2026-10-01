// One opaque handle per fare, in place of the four ids the fare service needs
// to find it again (fare, outbound trip, return trip, search session). Those
// are the upstream's internals: a model that sees them is invited to copy,
// reorder or invent them, and a result that shows a session id leaks one.
//
// The handle carries the ids themselves rather than pointing at a cache entry,
// so sending an offer works whichever data centre the call lands in. It also
// carries when it was issued: the fare behind it is a live price, so the
// handle is refused once the search it came from is half an hour old.
import { ToolError } from '../types.ts'

export interface OfferIds { fare: string, there: string, back: string, session: string }

/** Seconds an offer_id stays usable; the search cache is kept as long. */
export const OFFER_TTL = 1_800

export function validUntil(issued: number) {
  return new Date((issued + OFFER_TTL) * 1000).toISOString()
}

function toBase64Url(text: string) {
  return btoa(String.fromCharCode(...new TextEncoder().encode(text))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text: string) {
  const bytes = Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

export function encodeOffer({ fare, there, back, session }: OfferIds, issued = Math.floor(Date.now() / 1000)) {
  return `of_${toBase64Url(JSON.stringify([fare, there, back, session, issued]))}`
}

export function decodeOffer(offer: string): OfferIds & { issued?: number } {
  let parts: unknown
  try {
    parts = JSON.parse(fromBase64Url(offer.replace(/^of_/, '')))
  }
  catch {}
  // Four ids and no timestamp is a handle from 2.0.0, before offers expired.
  if (Array.isArray(parts) && (parts.length === 4 || parts.length === 5) && parts.slice(0, 4).every(id => typeof id === 'string' && id)) {
    const [fare, there, back, session, issued] = parts as [string, string, string, string, number?]
    if (typeof issued === 'number' && issued + OFFER_TTL < Date.now() / 1000)
      throw new ToolError('That offer has expired: fares are live, so an offer_id lasts 30 minutes. Search again for current prices.')
    return { fare, there, back, session, ...(typeof issued === 'number' ? { issued } : {}) }
  }
  throw new ToolError('That offer_id is not one a flight search returned. Pass offer_id exactly as the search gave it, or search again.')
}
