export const SecUrl = {
  submissionsBase: 'https://data.sec.gov/submissions',
  websiteBase: 'https://www.sec.gov',
  archiveDataBase: 'https://www.sec.gov/Archives/edgar/data',
} as const

export const SecForm = {
  currentReport: '8-K',
  currentReportAmendment: '8-K/A',
  quarterlyReport: '10-Q',
  quarterlyReportAmendment: '10-Q/A',
  annualReport: '10-K',
  annualReportAmendment: '10-K/A',
} as const

export const SecItem = {
  resultsOfOperations: '2.02',
} as const

export const SecRequest = {
  submissionsAccept: 'application/json',
  documentAccept: 'text/html,application/xhtml+xml,application/xml,text/plain',
  indexAccept: 'text/html,application/xhtml+xml',
  acceptedEncoding: 'gzip, deflate',
  inlineDocumentParameter: 'doc',
  archivePathPrefix: '/Archives/',
  filingTableRowsSelector: 'table.tableFile tr',
  exhibitTypePattern: /^EX-99\.0?1$/,
  retryAfterHeader: 'retry-after',
} as const

export const SecRequestPolicy = {
  minimumIntervalMs: 200,
  maximumAttempts: 3,
  baseRetryDelayMs: 1_000,
  maximumRetryDelayMs: 10_000,
  retryableStatuses: new Set([408, 429, 500, 502, 503, 504]),
} as const

export const EarningsCategory = {
  release: 'earnings_release',
  periodicReport: 'periodic_report',
  notEarnings: 'not_earnings',
} as const

export const RuleVersion = {
  earningsClassification: 'sec-earnings-v1',
  exhibitDiscovery: 'sec-exhibits-v1',
  eventGrouping: 'sec-event-grouping-v1',
} as const

export const SecDocumentType = {
  primary: 'sec-primary-document',
  earningsExhibit: 'sec-exhibit-99.1',
} as const

export type SecDocumentTypeValue = typeof SecDocumentType[keyof typeof SecDocumentType]

export const WorkerCommand = {
  health: 'health',
  syncFilings: 'sync-filings',
  syncDocuments: 'sync-documents',
  syncEvents: 'sync-events',
} as const

export const JobName = {
  filingsSync: 'sec-filings-sync',
  documentsSync: 'sec-documents-sync',
  eventsSync: 'earnings-events-sync',
} as const

export const JobStatus = {
  running: 'running',
  succeeded: 'succeeded',
  failed: 'failed',
} as const

export type FinishedJobStatus = typeof JobStatus.succeeded | typeof JobStatus.failed

export const EarningsEventStatus = {
  detected: 'detected',
} as const

export const DatabaseTable = {
  companies: 'companies',
  secFilings: 'sec_filings',
  earningsEvents: 'earnings_events',
  documents: 'documents',
  jobRuns: 'job_runs',
} as const

export const WorkerHealthConfig = {
  service: 'chiron-worker',
  phase: 'ingestion',
} as const

export const StorageConfig = {
  secDocumentsBucket: 'sec-documents',
  maximumDocumentBytes: 50 * 1024 * 1024,
  fallbackDocumentName: 'sec-document.txt',
} as const

const millisecondsPerDay = 86_400_000

export const WorkerTiming = {
  millisecondsPerDay,
  secRequestTimeoutMs: 30_000,
  eventGroupingWindowMs: 7 * millisecondsPerDay,
} as const

export const WorkerLimit = {
  errorSummaryCharacters: 1_000,
} as const

export const MimeType = {
  html: 'text/html',
  xml: 'application/xml',
  json: 'application/json',
  plainText: 'text/plain',
} as const

export const EnvironmentVariable = {
  supabaseUrl: 'SUPABASE_URL',
  supabaseSecretKey: 'SUPABASE_SECRET_KEY',
  secUserAgent: 'SEC_USER_AGENT',
  secLookbackDays: 'SEC_LOOKBACK_DAYS',
} as const

export const defaultSecLookbackDays = 730

export const supportedSecForms = new Set<string>(Object.values(SecForm))
export const periodicSecForms = new Set<string>([
  SecForm.quarterlyReport,
  SecForm.quarterlyReportAmendment,
  SecForm.annualReport,
  SecForm.annualReportAmendment,
])
export const earningsReleaseSecForms = new Set<string>([
  SecForm.currentReport,
  SecForm.currentReportAmendment,
])
