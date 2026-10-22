import { defaultSecLookbackDays, EnvironmentVariable } from './constants.js'

const requiredDatabaseKeys = [
  EnvironmentVariable.supabaseUrl,
  EnvironmentVariable.supabaseSecretKey,
] as const

export interface DatabaseConfig {
  supabaseUrl: string
  supabaseSecretKey: string
}

export interface SecRequestConfig {
  secUserAgent: string
}

export interface FilingSyncConfig extends SecRequestConfig {
  secLookbackDays: number
}

export function loadDatabaseConfig(): DatabaseConfig {
  const missing = requiredDatabaseKeys.filter((key) => !process.env[key]?.trim())

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`)
  }

  return {
    supabaseUrl: process.env[EnvironmentVariable.supabaseUrl]!,
    supabaseSecretKey: process.env[EnvironmentVariable.supabaseSecretKey]!,
  }
}

export function loadSecRequestConfig(): SecRequestConfig {
  const secUserAgent = process.env[EnvironmentVariable.secUserAgent]?.trim()

  if (!secUserAgent) {
    throw new Error(`Missing required environment variable: ${EnvironmentVariable.secUserAgent}`)
  }

  return { secUserAgent }
}

export function loadFilingSyncConfig(): FilingSyncConfig {
  const secRequestConfig = loadSecRequestConfig()

  const lookback = Number.parseInt(
    process.env[EnvironmentVariable.secLookbackDays] ?? String(defaultSecLookbackDays),
    10,
  )

  if (!Number.isInteger(lookback) || lookback < 1) {
    throw new Error('SEC_LOOKBACK_DAYS must be a positive integer')
  }

  return {
    ...secRequestConfig,
    secLookbackDays: lookback,
  }
}
