// Input checking that fails with a sentence the model can act on. A tool that
// says "invalid input" sends the agent guessing; one that says which field and
// what shape gets a corrected call.
import { ToolError } from '../types.ts'

export function str(args: Record<string, unknown>, key: string, label = key, hint = ''): string {
  const value = args[key]
  if (typeof value !== 'string' || !value.trim())
    throw new ToolError(`Missing ${label}.${hint ? ` ${hint}` : ''}`)
  return value.trim()
}

export function optionalStr(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function int(args: Record<string, unknown>, key: string, fallback = 0): number {
  const value = args[key]
  if (value === undefined || value === null || value === '')
    return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0)
    throw new ToolError(`${key} must be a whole number of passengers, not "${String(value)}".`)
  return parsed
}

export function intList(args: Record<string, unknown>, key: string): number[] {
  const value = args[key]
  if (value === undefined || value === null)
    return []
  const list = Array.isArray(value) ? value : [value]
  return list.map((entry) => {
    const parsed = Number(entry)
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 17)
      throw new ToolError(`${key} must be ages in years, one per traveller. Got "${String(entry)}".`)
    return parsed
  })
}

/** One or more IATA codes; the intake takes a list because a group can feed in from several cities. */
export function airports(args: Record<string, unknown>, key: string, label: string): string[] {
  const value = args[key]
  const list = (Array.isArray(value) ? value : [value]).filter(v => typeof v === 'string' && v.trim())
  if (!list.length)
    throw new ToolError(`Missing ${label}. Give a three-letter IATA airport code, for example LHR or VIE.`)

  return list.map((entry) => {
    const code = String(entry).trim().toUpperCase()
    if (!/^[A-Z]{3}$/.test(code))
      throw new ToolError(`"${entry}" is not an IATA airport code. Use three letters, for example LHR for London Heathrow.`)
    return code
  })
}

export function isoDate(args: Record<string, unknown>, key: string, label: string, required: boolean): string | undefined {
  const value = optionalStr(args, key)
  if (!value) {
    if (required)
      throw new ToolError(`Missing ${label}. Use YYYY-MM-DD.`)
    return undefined
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new ToolError(`${label} must be in YYYY-MM-DD form, not "${value}".`)
  if (Number.isNaN(Date.parse(value)))
    throw new ToolError(`${label} "${value}" is not a real date.`)
  return value
}

export function email(args: Record<string, unknown>, key = 'email'): string {
  const value = str(args, key, 'the traveller\'s email address', 'Ask for it before calling.')
  if (!/^[^\s@]+@[^\s@][^\s.@]*\.[^\s@]{2,}$/.test(value))
    throw new ToolError(`"${value}" is not a valid email address. The quote is sent by email, so it has to be right.`)
  return value
}

/** E.164, because the agent calls back on it and the intake stores it that way. */
export function phone(args: Record<string, unknown>, key = 'phone'): string {
  const value = str(args, key, 'a phone number', 'Ask for it before calling.').replace(/[\s()-]/g, '')
  if (!/^\+[1-9]\d{6,14}$/.test(value))
    throw new ToolError(`"${value}" is not a usable phone number. Include the country code, for example +441244568183.`)
  return value
}
