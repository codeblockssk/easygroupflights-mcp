// easygroupflights runs one site per market. The market decides which brand the
// enquiry is attributed to in the CRM, so it travels with the request rather
// than being inferred later.
//
// `contact` is how an agent hands a user to a person. It mirrors the `contact`
// block in the website's src/i18n/<locale>.ts. This package cannot import that
// file (it is mirrored as a standalone public repo), so the website's audit
// asserts the two are identical and a deploy fails if they drift apart.
export const MARKETS = {
  en: {
    domain: 'easygroupflights.com',
    language: 'English',
    phoneHint: 'UK numbers in +44 form',
    contact: { email: 'info@easygroupflights.com', phone: '+44 1244 568183', whatsapp: '+421 947 797 797' },
  },
  pl: {
    domain: 'grupoweloty.pl',
    language: 'Polish',
    phoneHint: 'Polish numbers in +48 form',
    contact: { email: 'info@grupoweloty.pl', phone: '+421 2 5464 9494', whatsapp: '+48 452 664 056' },
  },
  at: {
    domain: 'gruppenfluege.at',
    language: 'German',
    phoneHint: 'Austrian numbers in +43 form',
    contact: { email: 'info@gruppenfluege.at', phone: '+44 1244 568183', whatsapp: '+421 947 797 797' },
  },
} as const

/** A display number as a wa.me link: digits only, no plus. */
export function whatsappLink(number: string) {
  return `https://wa.me/${number.replace(/\D/g, '')}`
}

export type Market = keyof typeof MARKETS

export const DEFAULT_MARKET: Market = 'en'

export function resolveMarket(value: unknown): Market {
  const key = String(value ?? '').toLowerCase()
  return key in MARKETS ? key as Market : DEFAULT_MARKET
}

/**
 * What the CRM records as the origin of the lead. It has to be the bare domain:
 * Autopilot does not process a source it does not recognise, so a suffix here
 * would cost the enquiry rather than label it.
 */
export function leadSource(market: Market) {
  return MARKETS[market].domain
}
