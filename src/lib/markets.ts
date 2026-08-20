// easygroupflights runs one site per market. The market decides which brand the
// enquiry is attributed to in the CRM, so it travels with the request rather
// than being inferred later.
export const MARKETS = {
  en: { domain: 'easygroupflights.com', language: 'English', phoneHint: 'UK numbers in +44 form' },
  pl: { domain: 'grupoweloty.pl', language: 'Polish', phoneHint: 'Polish numbers in +48 form' },
  at: { domain: 'gruppenfluege.at', language: 'German', phoneHint: 'Austrian numbers in +43 form' },
} as const

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
