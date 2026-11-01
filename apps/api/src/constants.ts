export const ApiEnvironmentVariable = {
  supabaseUrl: 'SUPABASE_URL',
  supabaseSecretKey: 'SUPABASE_SECRET_KEY',
  port: 'API_PORT',
} as const

export const ApiServerConfig = {
  host: '127.0.0.1',
  defaultPort: 4000,
  graphqlPath: '/graphql',
} as const

export const ApiQueryLimit = {
  defaultRecentEvents: 25,
  minimumRecentEvents: 1,
  maximumRecentEvents: 100,
} as const

export const ApiDatabaseTable = {
  earningsEvents: 'earnings_events',
} as const
