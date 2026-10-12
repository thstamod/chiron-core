import { defaultSecLookbackDays, EnvironmentVariable } from './constants.js'

const requiredKeys = [
  EnvironmentVariable.supabaseUrl,
  EnvironmentVariable.supabaseSecretKey,
  EnvironmentVariable.secUserAgent,
] as const

export interface WorkerConfig {
  supabaseUrl: string
  supabaseSecretKey: string
  secUserAgent: string
  secLookbackDays: number
}

export function loadConfig(): WorkerConfig {
  const missing = requiredKeys.filter((key) => !process.env[key]?.trim())

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`)
  }

  const lookback = Number.parseInt(
    process.env[EnvironmentVariable.secLookbackDays] ?? String(defaultSecLookbackDays),
    10,
  )

  if (!Number.isInteger(lookback) || lookback < 1) {
    throw new Error('SEC_LOOKBACK_DAYS must be a positive integer')
  }

  return {
    supabaseUrl: process.env[EnvironmentVariable.supabaseUrl]!,
    supabaseSecretKey: process.env[EnvironmentVariable.supabaseSecretKey]!,
    secUserAgent: process.env[EnvironmentVariable.secUserAgent]!,
    secLookbackDays: lookback,
  }
}
