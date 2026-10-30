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

export const TiingoUrl = {
  dailyPricesBase: 'https://api.tiingo.com/tiingo/daily',
} as const

export const TiingoRequest = {
  authorizationScheme: 'Token',
  authorizationHeader: 'Authorization',
  acceptHeader: 'Accept',
  accept: 'application/json',
  pricesPath: 'prices',
  startDateParameter: 'startDate',
  endDateParameter: 'endDate',
  responseFormatParameter: 'format',
  jsonResponseFormat: 'json',
} as const

export const TiingoRequestPolicy = {
  requestTimeoutMilliseconds: 30_000,
} as const

export const PriceDataProvider = {
  tiingo: 'tiingo',
} as const

export const EarningsCategory = {
  release: 'earnings_release',
  periodicReport: 'periodic_report',
  notEarnings: 'not_earnings',
} as const

export const RuleVersion = {
  earningsClassification: 'sec-earnings-v1',
  exhibitDiscovery: 'sec-exhibits-v1',
  eventGrouping: 'sec-event-grouping-v2',
  eventPersistence: 'earnings-event-persistence-v1',
  documentTextExtraction: 'sec-html-text-v3',
  financialMetricExtraction: 'sec-xbrl-financial-metrics-v1',
  financialDerivedMetrics: 'financial-derived-metrics-v1',
  qualitativeInputSelection: 'earnings-release-input-v1',
  qualitativeEvidencePassages: 'evidence-passages-v1',
  qualitativeSourceCoverage: 'earnings-release-source-coverage-v1',
} as const

export const PromptVersion = {
  baselineQualitativeExtraction: 'baseline-v6',
} as const

export const QualitativeEvidencePassageLimit = {
  maximumCharacters: 1_200,
} as const

export const QualitativeSourceScope = {
  currentEarningsRelease: 'current_earnings_release',
  previousEarningsRelease: 'previous_earnings_release',
  secLegalAndRiskSections: 'sec_legal_and_risk_sections',
  officialRegulatorySources: 'official_regulatory_sources',
  externalNews: 'external_news',
} as const

export type QualitativeSourceScopeValue =
  typeof QualitativeSourceScope[keyof typeof QualitativeSourceScope]

export const QualitativeRiskAbsenceMeaning = {
  unknownNotPositive: 'unknown_not_positive',
} as const

export type QualitativeRiskAbsenceMeaningValue =
  typeof QualitativeRiskAbsenceMeaning[keyof typeof QualitativeRiskAbsenceMeaning]

export const QualitativeExtractionLimit = {
  maximumOutputTokens: 2_000,
} as const

export const QualitativeReviewLimit = {
  maximumReviewerLabelCharacters: 100,
  maximumNotesCharacters: 4_000,
} as const

export const QualitativeProviderStatus = {
  completed: 'completed',
  refused: 'refused',
  incomplete: 'incomplete',
  requestFailed: 'request_failed',
  invalidOutput: 'invalid_output',
} as const

export const QualitativeValidationStatus = {
  valid: 'valid',
  invalid: 'invalid',
} as const

export const QualitativeReviewDecision = {
  accepted: 'accepted',
  corrected: 'corrected',
  rejected: 'rejected',
} as const

export const QualitativeReviewVersion = {
  manual: 'manual-qualitative-review-v1',
} as const

export const QualitativeEffectiveOutputSource = {
  original: 'original',
  correctedReview: 'corrected_review',
} as const

export type QualitativeEffectiveOutputSourceValue =
  typeof QualitativeEffectiveOutputSource[keyof typeof QualitativeEffectiveOutputSource]

export const LanguageModelProvider = {
  openAi: 'openai',
} as const

export const OpenAIConfig = {
  qualitativeResponseFormatName: 'chiron_qualitative_earnings',
  maximumRetries: 0,
  requestTimeoutMilliseconds: 180_000,
  reasoningEffort: 'low',
} as const

export const OpenAIRetryPolicy = {
  retryableHttpStatuses: new Set([408, 409]),
  retryableErrorCodes: new Set(['rate_limit_exceeded', 'slow_down']),
} as const

export const FinancialMetricCode = {
  revenue: 'revenue',
  netIncome: 'net_income',
  earningsPerShareBasic: 'earnings_per_share_basic',
  earningsPerShareDiluted: 'earnings_per_share_diluted',
} as const

export const FinancialDerivedMetricCode = {
  revenueGrowthYearOverYearPercent: 'revenue_growth_year_over_year_percent',
  netMarginPercent: 'net_margin_percent',
  netMarginChangeYearOverYearPercentagePoints:
    'net_margin_change_year_over_year_percentage_points',
} as const

export const FinancialDerivedMetricUnit = {
  percent: 'percent',
  percentagePoints: 'percentage_points',
} as const

export const FinancialCalculationExpression = {
  revenueGrowthYearOverYearPercent:
    '((current_revenue - previous_year_revenue) / previous_year_revenue) * 100',
  netMarginPercent: '(current_net_income / current_revenue) * 100',
  netMarginChangeYearOverYearPercentagePoints:
    'current_net_margin_percent - previous_year_net_margin_percent',
} as const

export const AccountingBasis = {
  gaap: 'gaap',
} as const

export const FinancialUnit = {
  unitedStatesDollar: 'USD',
  share: 'share',
  unitedStatesDollarPerShare: 'USD/share',
} as const

export const XbrlConcept = {
  revenueFromCustomerContracts: 'us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax',
  revenues: 'us-gaap:Revenues',
  salesRevenueNet: 'us-gaap:SalesRevenueNet',
  netIncomeLoss: 'us-gaap:NetIncomeLoss',
  profitLoss: 'us-gaap:ProfitLoss',
  earningsPerShareBasic: 'us-gaap:EarningsPerShareBasic',
  earningsPerShareDiluted: 'us-gaap:EarningsPerShareDiluted',
  documentFiscalYear: 'dei:DocumentFiscalYearFocus',
  documentFiscalPeriod: 'dei:DocumentFiscalPeriodFocus',
} as const

export const XbrlFiscalPeriod = {
  firstQuarter: 'Q1',
  secondQuarter: 'Q2',
  thirdQuarter: 'Q3',
  fourthQuarter: 'Q4',
  fullYear: 'FY',
} as const

export const XbrlSelector = {
  context: 'xbrli\\:context',
  startDate: 'xbrli\\:startdate',
  endDate: 'xbrli\\:enddate',
  explicitMember: 'xbrldi\\:explicitmember',
  typedMember: 'xbrldi\\:typedmember',
  unit: 'xbrli\\:unit',
  measure: 'xbrli\\:measure',
  unitNumerator: 'xbrli\\:unitnumerator',
  unitDenominator: 'xbrli\\:unitdenominator',
  numericFact: 'ix\\:nonfraction',
  nonNumericFact: 'ix\\:nonnumeric',
  hiddenFactContainer: 'ix\\:hidden',
  excludedContent: 'ix\\:exclude',
} as const

export const HtmlSelector = {
  nonReadableContent: 'head,script,style,noscript,template,svg,ix\\:hidden,[hidden],[aria-hidden="true"]',
  table: 'table',
  tableRow: 'tr',
  tableCell: 'th,td',
  lineBreak: 'br',
  block: 'address,article,aside,blockquote,dd,div,dl,dt,fieldset,figcaption,figure,footer,'
    + 'form,h1,h2,h3,h4,h5,h6,header,hr,li,main,nav,ol,p,pre,section,summary,ul',
} as const

export const HtmlStyle = {
  hiddenDisplay: 'display:none',
  hiddenVisibility: 'visibility:hidden',
} as const

export const ReadableText = {
  tableCellSeparator: ' | ',
  maximumPreservedBlankLines: 1,
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
  extractDocumentText: 'extract-document-text',
  extractFinancialMetrics: 'extract-financial-metrics',
  calculateFinancialDerivedMetrics: 'calculate-financial-derived-metrics',
  previewQualitativeExtraction: 'preview-qualitative',
  extractQualitative: 'extract-qualitative',
  reviewQualitativeExtraction: 'review-qualitative',
} as const

export const WorkerCommandFlag = {
  executePaidRequest: '--execute-paid-request',
  reviewDecision: '--decision=',
  reviewerLabel: '--reviewer-label=',
  reviewNotes: '--notes=',
  correctedOutputFile: '--corrected-output-file=',
} as const

export const JobName = {
  filingsSync: 'sec-filings-sync',
  documentsSync: 'sec-documents-sync',
  eventsSync: 'earnings-events-sync',
  documentTextExtraction: 'document-text-extraction',
  financialMetricExtraction: 'financial-metric-extraction',
  financialDerivedMetricCalculation: 'financial-derived-metric-calculation',
  qualitativeExtraction: 'qualitative-extraction',
} as const

export const JobStatus = {
  running: 'running',
  succeeded: 'succeeded',
  failed: 'failed',
} as const

export type FinishedJobStatus = typeof JobStatus.succeeded | typeof JobStatus.failed

export const EarningsEventStatus = {
  groupingPending: 'grouping_pending',
  provisional: 'provisional',
  detected: 'detected',
} as const

export const DatabaseTable = {
  companies: 'companies',
  secFilings: 'sec_filings',
  earningsEvents: 'earnings_events',
  documents: 'documents',
  documentTextVersions: 'document_text_versions',
  financialMetrics: 'financial_metrics',
  financialMetricExtractions: 'financial_metric_extractions',
  financialDerivedMetrics: 'financial_derived_metrics',
  financialDerivedMetricCalculations: 'financial_derived_metric_calculations',
  extractionRuns: 'extraction_runs',
  extractionReviews: 'extraction_reviews',
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
  objectSearchLimit: 100,
  derivedTextFolder: 'derived-text',
} as const

const millisecondsPerDay = 86_400_000

export const WorkerTiming = {
  millisecondsPerDay,
  secRequestTimeoutMs: 30_000,
  eventGroupingWindowMs: millisecondsPerDay,
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

export const TextEncoding = {
  utf8: 'utf-8',
} as const

export const ContentHash = {
  algorithm: 'sha256',
  outputEncoding: 'hex',
} as const

export const EnvironmentVariable = {
  supabaseUrl: 'SUPABASE_URL',
  supabaseSecretKey: 'SUPABASE_SECRET_KEY',
  secUserAgent: 'SEC_USER_AGENT',
  secLookbackDays: 'SEC_LOOKBACK_DAYS',
  openAiApiKey: 'OPENAI_API_KEY',
  openAiModel: 'OPENAI_MODEL',
  tiingoApiToken: 'TIINGO_API_TOKEN',
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
