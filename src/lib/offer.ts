// One opaque handle per fare, in place of the four ids the fare service needs
// to find it again (fare, outbound trip, return trip, search session). Those
// are the upstream's internals: a model that sees them is invited to copy,
// reorder or invent them, and a result that shows a session id leaks one.
//
// The handle carries everything later calls need — the ids, what the search
// showed and the booking link — compressed, rather than pointing at a cache
// entry. The cache is per data centre, and a gateway's follow-up call can land
// in a different one from its search; a handle that needs no lookup works
// wherever it lands. It also carries when it was issued: the fare behind it is
// a live price, so the handle is refused once its search is half an hour old.
//
// Because it carries a booking link and a price that are shown back as ours,
// it is signed: a forged handle could otherwise make the server present any
// link as the place to book.
import type { Env } from '../types.ts'
import { ToolError } from '../types.ts'
import { signature } from './confirm.ts'

export interface OfferIds { fare: string, there: string, back: string, session: string }

/** What the search showed for the fare, in the shape the tools return it. */
export interface OfferDetails {
  price?: number
  carriers: string[]
  stops_out?: number
  stops_back?: number
  departure?: string
  return?: string
  flight_numbers: string[]
}

export interface Offer {
  ids: OfferIds
  issued?: number
  details?: OfferDetails
  link?: string
}

/** Seconds an offer_id stays usable. */
export const OFFER_TTL = 1_800

export function validUntil(issued: number) {
  return new Date((issued + OFFER_TTL) * 1000).toISOString()
}

function toBase64Url(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes)
    binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text: string) {
  return Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream) {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream))
  return new Uint8Array(await out.arrayBuffer())
}

export async function encodeOffer({ ids, details, link }: Omit<Offer, 'issued'>, env: Env, issued = Math.floor(Date.now() / 1000)) {
  const packed = JSON.stringify([ids.fare, ids.there, ids.back, ids.session, issued, details ?? null, link ?? null])
  const body = toBase64Url(await pipe(new TextEncoder().encode(packed), new CompressionStream('deflate-raw')))
  return `of_${body}.${await signature(body, env)}`
}

async function unpack(offer: string): Promise<unknown[] | null> {
  let bytes: Uint8Array
  try {
    bytes = fromBase64Url(offer.replace(/^of_/, ''))
  }
  catch {
    return null
  }
  // 2.0.0 handles were plain JSON arrays; later ones are compressed.
  for (const read of [async () => bytes, async () => pipe(bytes, new DecompressionStream('deflate-raw'))]) {
    try {
      const parts = JSON.parse(new TextDecoder().decode(await read()))
      if (Array.isArray(parts))
        return parts
    }
    catch {}
  }
  return null
}

export async function decodeOffer(offer: string, env: Env): Promise<Offer> {
  const [body, mac] = offer.replace(/^of_/, '').split('.')
  const signed = Boolean(mac) && mac === await signature(body, env)
  if (mac && !signed)
    throw new ToolError('That offer_id is not one a flight search returned. Pass offer_id exactly as the search gave it, or search again.')

  const parts = await unpack(body)
  if (!parts || parts.length < 4 || !parts.slice(0, 4).every(id => typeof id === 'string' && id))
    throw new ToolError('That offer_id is not one a flight search returned. Pass offer_id exactly as the search gave it, or search again.')

  const [fare, there, back, session, issued, details, link] = parts as [string, string, string, string, number?, OfferDetails?, string?]
  if (typeof issued === 'number' && issued + OFFER_TTL < Date.now() / 1000)
    throw new ToolError('That offer has expired: fares are live, so an offer_id lasts 30 minutes. Search again for current prices.')

  // An unsigned handle is 2.0.0's: ids only. Whatever else it claims to carry
  // is ignored, because nothing vouches for it.
  if (!signed)
    return { ids: { fare, there, back, session } }

  return {
    ids: { fare, there, back, session },
    ...(typeof issued === 'number' ? { issued } : {}),
    ...(details ? { details } : {}),
    ...(typeof link === 'string' ? { link } : {}),
  }
}

/**
 * The fare service writes a missing affiliate id as the Python literal
 * `a_aid=None`. It credits nothing, so it is dropped rather than passed on.
 */
export function cleanLink(link: string) {
  const url = new URL(link)
  if (['None', 'null', ''].includes(url.searchParams.get('a_aid') ?? 'x'))
    url.searchParams.delete('a_aid')
  return url.toString()
}
