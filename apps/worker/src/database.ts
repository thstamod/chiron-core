import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type {
  SecEarningsClassification,
  SecFilingCandidate,
  SecFilingRecord,
  TrackedCompany,
} from '@chiron/shared'
import type { DatabaseConfig } from './config.js'
import {
  DatabaseTable,
  type FinishedJobStatus,
  JobStatus,
  periodicSecForms,
  type PriceInstrumentTypeValue,
  SecDocumentType,
  WorkerLimit,
} from './constants.js'
import { fetchAllPages } from './pagination.js'
import type {
  DailyPriceObservation,
  PriceInstrument,
} from './price-observations.js'
import { selectChangedDailyPriceObservations } from './price-observations.js'

interface CompanyRow {
  id: string
  cik: string
  legal_name: string
  ticker: string
  exchange: string | null
  sector: string | null
  is_active: boolean
}

interface FilingCompanyRow {
  cik: string
  ticker: string
}

interface FilingRow {
  id: string
  company_id: string
  accession_number: string
  form_type: string
  filing_date: string
  accepted_at: string | null
  first_seen_at: string
  report_date: string | null
  primary_document: string
  items: string[] | null
  sec_index_url: string
  earnings_classification: unknown
  exhibit_discovery: unknown
  earnings_event_id: string | null
  companies: FilingCompanyRow | FilingCompanyRow[]
}

interface DocumentTextSourceRow {
  id: string
  storage_path: string
  content_sha256: string
}

interface DocumentTextVersionRow {
  document_id: string
  source_content_sha256: string
}

interface FinancialMetricDocumentFilingRow {
  form_type: string
  report_date: string | null
  companies: { ticker: string } | { ticker: string }[]
}

interface FinancialMetricDocumentRow {
  id: string
  earnings_event_id: string | null
  storage_path: string
  content_sha256: string
  sec_filings: FinancialMetricDocumentFilingRow | FinancialMetricDocumentFilingRow[]
}

interface FinancialMetricExtractionRow {
  source_document_id: string
  source_content_sha256: string
}

interface PriceInstrumentRow {
  id: string
  company_id: string | null
  symbol: string
  instrument_type: PriceInstrumentTypeValue
  provider_name: string
  provider_symbol: string
  currency: string
}

interface ExistingDailyPriceObservationRow {
  id: string
  trading_date: string
  observation_sha256: string
  fetched_at: string
}

export interface DocumentTextSource {
  id: string
  storagePath: string
  contentSha256: string
}

export interface FinancialMetricDocumentSource {
  id: string
  earningsEventId: string
  ticker: string
  formType: string
  reportDate: string
  storagePath: string
  contentSha256: string
}

function versionFromJson(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const version = (value as { ruleVersion?: unknown }).ruleVersion
  return typeof version === 'string' ? version : null
}

function parseClassification(value: unknown): SecEarningsClassification | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null

  const candidate = value as Partial<SecEarningsClassification>
  if (
    typeof candidate.isEarningsRelated !== 'boolean'
    || typeof candidate.category !== 'string'
    || typeof candidate.reason !== 'string'
    || typeof candidate.ruleVersion !== 'string'
    || typeof candidate.classifiedAt !== 'string'
  ) {
    return null
  }

  return candidate as SecEarningsClassification
}

export function createDatabaseClient(config: DatabaseConfig): SupabaseClient {
  return createClient(config.supabaseUrl, config.supabaseSecretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}

export async function checkDatabase(client: SupabaseClient): Promise<number> {
  const { count, error } = await client
    .from(DatabaseTable.companies)
    .select('id', { count: 'exact' })
    .limit(1)

  if (error) {
    throw new Error(`Supabase health check failed: ${error.message}`)
  }

  return count ?? 0
}

export async function getActiveCompanies(client: SupabaseClient): Promise<TrackedCompany[]> {
  const { data, error } = await client
    .from(DatabaseTable.companies)
    .select('id,cik,legal_name,ticker,exchange,sector,is_active')
    .eq('is_active', true)
    .order('ticker')

  if (error) {
    throw new Error(`Could not load active companies: ${error.message}`)
  }

  return ((data ?? []) as CompanyRow[]).map((company) => ({
    id: company.id,
    cik: company.cik,
    legalName: company.legal_name,
    ticker: company.ticker,
    exchange: company.exchange,
    sector: company.sector,
    isActive: company.is_active,
  }))
}

export async function getActivePriceInstrumentsForProvider(
  client: SupabaseClient,
  providerName: string,
): Promise<PriceInstrument[]> {
  const { data, error } = await client
    .from(DatabaseTable.priceInstruments)
    .select(`
      id,
      company_id,
      symbol,
      instrument_type,
      provider_name,
      provider_symbol,
      currency
    `)
    .eq('is_active', true)
    .eq('provider_name', providerName)
    .order('provider_name')
    .order('provider_symbol')

  if (error) {
    throw new Error(`Could not load active price instruments: ${error.message}`)
  }

  return ((data ?? []) as PriceInstrumentRow[]).map((instrument) => ({
    id: instrument.id,
    companyId: instrument.company_id,
    symbol: instrument.symbol,
    instrumentType: instrument.instrument_type,
    providerName: instrument.provider_name,
    providerSymbol: instrument.provider_symbol,
    currency: instrument.currency,
  }))
}

export async function getLatestPriceTradingDate(
  client: SupabaseClient,
  priceInstrumentId: string,
): Promise<string | null> {
  const { data, error } = await client
    .from(DatabaseTable.dailyPriceObservations)
    .select('trading_date')
    .eq('price_instrument_id', priceInstrumentId)
    .order('trading_date', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    throw new Error(`Could not load latest price trading date: ${error.message}`)
  }

  return (data?.trading_date as string | undefined) ?? null
}

export async function saveChangedDailyPriceObservations(
  client: SupabaseClient,
  observations: DailyPriceObservation[],
): Promise<number> {
  if (observations.length === 0) return 0

  const priceInstrumentId = observations[0]!.priceInstrumentId
  if (observations.some((observation) => observation.priceInstrumentId !== priceInstrumentId)) {
    throw new Error('Daily price observations must belong to one price instrument')
  }

  const tradingDates = observations.map((observation) => observation.tradingDate)
  const firstTradingDate = tradingDates.reduce(
    (earliest, date) => (date < earliest ? date : earliest),
  )
  const lastTradingDate = tradingDates.reduce(
    (latest, date) => (date > latest ? date : latest),
  )
  const existingObservations = await fetchAllPages<ExistingDailyPriceObservationRow>(
    async (from, to) => {
      const { data, error } = await client
        .from(DatabaseTable.dailyPriceObservations)
        .select('id,trading_date,observation_sha256,fetched_at')
        .eq('price_instrument_id', priceInstrumentId)
        .gte('trading_date', firstTradingDate)
        .lte('trading_date', lastTradingDate)
        .order('trading_date')
        .order('fetched_at', { ascending: false })
        .order('id', { ascending: false })
        .range(from, to)

      return { data, error }
    },
    'Could not load existing daily price observations',
  )

  const latestFingerprintByTradingDate = new Map<string, string>()
  for (const observation of existingObservations) {
    if (!latestFingerprintByTradingDate.has(observation.trading_date)) {
      latestFingerprintByTradingDate.set(
        observation.trading_date,
        observation.observation_sha256,
      )
    }
  }

  const changedObservations = selectChangedDailyPriceObservations(
    observations,
    latestFingerprintByTradingDate,
  )
  if (changedObservations.length === 0) return 0

  const rows = changedObservations.map((observation) => ({
    price_instrument_id: observation.priceInstrumentId,
    provider_name: observation.providerName,
    provider_symbol: observation.providerSymbol,
    trading_date: observation.tradingDate,
    open_price: observation.openPrice,
    high_price: observation.highPrice,
    low_price: observation.lowPrice,
    close_price: observation.closePrice,
    volume: observation.volume,
    adjusted_open_price: observation.adjustedOpenPrice,
    adjusted_high_price: observation.adjustedHighPrice,
    adjusted_low_price: observation.adjustedLowPrice,
    adjusted_close_price: observation.adjustedClosePrice,
    adjusted_volume: observation.adjustedVolume,
    dividend_cash: observation.dividendCash,
    split_factor: observation.splitFactor,
    observation_sha256: observation.observationSha256,
    fetched_at: observation.fetchedAt,
  }))

  const { data, error } = await client
    .from(DatabaseTable.dailyPriceObservations)
    .upsert(rows, {
      onConflict: 'price_instrument_id,trading_date,fetched_at',
      ignoreDuplicates: true,
    })
    .select('id')

  if (error) {
    throw new Error(`Could not save daily price observations: ${error.message}`)
  }

  return data?.length ?? 0
}

export async function saveFilingCandidates(
  client: SupabaseClient,
  filings: SecFilingCandidate[],
): Promise<number> {
  if (filings.length === 0) return 0

  const firstSeenAt = new Date().toISOString()
  const rows = filings.map((filing) => ({
    company_id: filing.companyId,
    accession_number: filing.accessionNumber,
    form_type: filing.formType,
    filing_date: filing.filingDate,
    accepted_at: filing.acceptedAt,
    first_seen_at: firstSeenAt,
    report_date: filing.reportDate,
    primary_document: filing.primaryDocument,
    items: filing.items,
    sec_index_url: filing.secIndexUrl,
    metadata: filing.metadata,
  }))

  const { data, error } = await client
    .from(DatabaseTable.secFilings)
    .upsert(rows, { onConflict: 'accession_number', ignoreDuplicates: true })
    .select('id')

  if (error) {
    throw new Error(`Could not save SEC filings: ${error.message}`)
  }

  return data?.length ?? 0
}

export async function getFilingsForDocumentSync(
  client: SupabaseClient,
): Promise<SecFilingRecord[]> {
  const data = await fetchAllPages<FilingRow>(
    async (from, to) => {
      const { data: page, error } = await client
        .from(DatabaseTable.secFilings)
        .select(`
          id,
          company_id,
          accession_number,
          form_type,
          filing_date,
          accepted_at,
          first_seen_at,
          report_date,
          primary_document,
          items,
          sec_index_url,
          earnings_classification,
          exhibit_discovery,
          earnings_event_id,
          companies!inner(cik,ticker)
        `)
        .order('filing_date', { ascending: false })
        .order('id')
        .range(from, to)

      return { data: page as unknown as FilingRow[] | null, error }
    },
    'Could not load SEC filings for document sync',
  )

  return data.map((filing) => {
    const company = Array.isArray(filing.companies) ? filing.companies[0] : filing.companies
    if (!company) {
      throw new Error(`Filing ${filing.accession_number} has no related company`)
    }

    return {
      id: filing.id,
      companyId: filing.company_id,
      cik: company.cik,
      ticker: company.ticker,
      accessionNumber: filing.accession_number,
      formType: filing.form_type,
      filingDate: filing.filing_date,
      acceptedAt: filing.accepted_at,
      firstSeenAt: filing.first_seen_at,
      reportDate: filing.report_date,
      primaryDocument: filing.primary_document,
      items: filing.items ?? [],
      secIndexUrl: filing.sec_index_url,
      earningsClassification: parseClassification(filing.earnings_classification),
      exhibitDiscoveryVersion: versionFromJson(filing.exhibit_discovery),
      earningsEventId: filing.earnings_event_id,
    }
  })
}

export async function updateFilingClassification(
  client: SupabaseClient,
  filingId: string,
  classification: SecEarningsClassification,
): Promise<void> {
  const { error } = await client
    .from(DatabaseTable.secFilings)
    .update({ earnings_classification: classification })
    .eq('id', filingId)

  if (error) {
    throw new Error(`Could not save filing classification: ${error.message}`)
  }
}

export async function getStoredDocumentSourceUrls(
  client: SupabaseClient,
): Promise<Set<string>> {
  const data = await fetchAllPages<{ source_url: string }>(
    async (from, to) => {
      const { data: page, error } = await client
        .from(DatabaseTable.documents)
        .select('source_url')
        .order('source_url')
        .range(from, to)

      return { data: page, error }
    },
    'Could not load stored SEC documents',
  )

  return new Set(data.map((row) => row.source_url))
}

export async function getPendingDocumentsForTextExtraction(
  client: SupabaseClient,
  extractionVersion: string,
): Promise<DocumentTextSource[]> {
  const [documents, existingTextVersions] = await Promise.all([
    fetchAllPages<DocumentTextSourceRow>(
      async (from, to) => {
        const { data, error } = await client
          .from(DatabaseTable.documents)
          .select('id,storage_path,content_sha256')
          .order('id')
          .range(from, to)

        return { data, error }
      },
      'Could not load documents for text extraction',
    ),
    fetchAllPages<DocumentTextVersionRow>(
      async (from, to) => {
        const { data, error } = await client
          .from(DatabaseTable.documentTextVersions)
          .select('document_id,source_content_sha256')
          .eq('extraction_version', extractionVersion)
          .order('document_id')
          .order('source_content_sha256')
          .range(from, to)

        return { data, error }
      },
      'Could not load existing document text versions',
    ),
  ])

  const completedExtractionKeys = new Set(
    existingTextVersions.map(
      (version) => `${version.document_id}:${version.source_content_sha256}`,
    ),
  )

  return documents
    .filter((document) => {
      const extractionKey = `${document.id}:${document.content_sha256}`
      return !completedExtractionKeys.has(extractionKey)
    })
    .map((document) => ({
      id: document.id,
      storagePath: document.storage_path,
      contentSha256: document.content_sha256,
    }))
}

export async function getPendingDocumentsForFinancialMetricExtraction(
  client: SupabaseClient,
  extractionVersion: string,
): Promise<FinancialMetricDocumentSource[]> {
  const [documents, completedExtractions] = await Promise.all([
    fetchAllPages<FinancialMetricDocumentRow>(
      async (from, to) => {
        const { data, error } = await client
          .from(DatabaseTable.documents)
          .select(`
            id,
            earnings_event_id,
            storage_path,
            content_sha256,
            sec_filings!inner(form_type,report_date,companies!inner(ticker))
          `)
          .eq('document_type', SecDocumentType.primary)
          .not('earnings_event_id', 'is', null)
          .in('sec_filings.form_type', [...periodicSecForms])
          .not('sec_filings.report_date', 'is', null)
          .order('id')
          .range(from, to)

        return { data: data as unknown as FinancialMetricDocumentRow[] | null, error }
      },
      'Could not load documents for financial metric extraction',
    ),
    fetchAllPages<FinancialMetricExtractionRow>(
      async (from, to) => {
        const { data, error } = await client
          .from(DatabaseTable.financialMetricExtractions)
          .select('source_document_id,source_content_sha256')
          .eq('extraction_version', extractionVersion)
          .order('source_document_id')
          .order('source_content_sha256')
          .range(from, to)

        return { data, error }
      },
      'Could not load completed financial metric extractions',
    ),
  ])

  const completedExtractionKeys = new Set(
    completedExtractions.map(
      (extraction) => `${extraction.source_document_id}:${extraction.source_content_sha256}`,
    ),
  )

  return documents.flatMap((document) => {
    const extractionKey = `${document.id}:${document.content_sha256}`
    if (completedExtractionKeys.has(extractionKey) || !document.earnings_event_id) return []

    const filing = Array.isArray(document.sec_filings)
      ? document.sec_filings[0]
      : document.sec_filings
    if (!filing?.report_date) return []

    const company = Array.isArray(filing.companies)
      ? filing.companies[0]
      : filing.companies
    if (!company) return []

    return [{
      id: document.id,
      earningsEventId: document.earnings_event_id,
      ticker: company.ticker,
      formType: filing.form_type,
      reportDate: filing.report_date,
      storagePath: document.storage_path,
      contentSha256: document.content_sha256,
    }]
  })
}

export async function updateExhibitDiscovery(
  client: SupabaseClient,
  filingId: string,
  discovery: Record<string, unknown>,
): Promise<void> {
  const { error } = await client
    .from(DatabaseTable.secFilings)
    .update({ exhibit_discovery: discovery })
    .eq('id', filingId)

  if (error) {
    throw new Error(`Could not save exhibit discovery: ${error.message}`)
  }
}

export async function createJobRun(client: SupabaseClient, jobName: string): Promise<string> {
  const { data, error } = await client
    .from(DatabaseTable.jobRuns)
    .insert({ job_name: jobName, status: JobStatus.running })
    .select('id')
    .single()

  if (error) {
    throw new Error(`Could not create job run: ${error.message}`)
  }

  return data.id as string
}

export async function finishJobRun(
  client: SupabaseClient,
  jobRunId: string,
  status: FinishedJobStatus,
  details: Record<string, unknown>,
  errorSummary: string | null = null,
): Promise<void> {
  const { error } = await client
    .from(DatabaseTable.jobRuns)
    .update({
      status,
      finished_at: new Date().toISOString(),
      error_summary: errorSummary?.slice(0, WorkerLimit.errorSummaryCharacters) ?? null,
      details,
    })
    .eq('id', jobRunId)

  if (error) {
    throw new Error(`Could not finish job run: ${error.message}`)
  }
}
