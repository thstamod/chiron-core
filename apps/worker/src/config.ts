const requiredKeys = ['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'SEC_USER_AGENT'] as const

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

  const lookback = Number.parseInt(process.env.SEC_LOOKBACK_DAYS ?? '730', 10)

  if (!Number.isInteger(lookback) || lookback < 1) {
    throw new Error('SEC_LOOKBACK_DAYS must be a positive integer')
  }

  return {
    supabaseUrl: process.env.SUPABASE_URL!,
    supabaseSecretKey: process.env.SUPABASE_SECRET_KEY!,
    secUserAgent: process.env.SEC_USER_AGENT!,
    secLookbackDays: lookback,
  }
}
