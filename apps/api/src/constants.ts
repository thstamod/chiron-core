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
  defaultRecords: 25,
  minimumRecords: 1,
  maximumRecords: 100,
} as const

export const ApiDatabaseTable = {
  companies: 'companies',
  documents: 'documents',
  earningsEvents: 'earnings_events',
  financialDerivedMetrics: 'financial_derived_metrics',
  financialMetrics: 'financial_metrics',
  historicalPredictions: 'historical_predictions',
  predictions: 'predictions',
} as const

export const TrustedSourceDocumentUrl = {
  protocol: 'https:',
  hostname: 'www.sec.gov',
  archivePathPrefix: '/Archives/',
} as const
