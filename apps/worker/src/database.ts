import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type {
  SecEarningsClassification,
  SecFilingCandidate,
  SecFilingRecord,
  TrackedCompany,
} from '@chiron/shared'
import type { WorkerConfig } from './config.js'

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
  primary_document: string
  items: string[] | null
  earnings_classification: unknown
  companies: FilingCompanyRow | FilingCompanyRow[]
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

export function createDatabaseClient(config: WorkerConfig): SupabaseClient {
  return createClient(config.supabaseUrl, config.supabaseSecretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}

export async function checkDatabase(client: SupabaseClient): Promise<number> {
  const { count, error } = await client
    .from('companies')
    .select('id', { count: 'exact' })
    .limit(1)

  if (error) {
    throw new Error(`Supabase health check failed: ${error.message}`)
  }

  return count ?? 0
}

export async function getActiveCompanies(client: SupabaseClient): Promise<TrackedCompany[]> {
  const { data, error } = await client
    .from('companies')
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

export async function saveFilingCandidates(
  client: SupabaseClient,
  filings: SecFilingCandidate[],
): Promise<void> {
  if (filings.length === 0) return

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

  const { error } = await client
    .from('sec_filings')
    .upsert(rows, { onConflict: 'accession_number', ignoreDuplicates: true })

  if (error) {
    throw new Error(`Could not save SEC filings: ${error.message}`)
  }
}

export async function getFilingsForDocumentSync(
  client: SupabaseClient,
): Promise<SecFilingRecord[]> {
  const { data, error } = await client
    .from('sec_filings')
    .select(`
      id,
      company_id,
      accession_number,
      form_type,
      filing_date,
      accepted_at,
      first_seen_at,
      primary_document,
      items,
      earnings_classification,
      companies!inner(cik,ticker)
    `)
    .order('filing_date', { ascending: false })

  if (error) {
    throw new Error(`Could not load SEC filings for document sync: ${error.message}`)
  }

  return ((data ?? []) as unknown as FilingRow[]).map((filing) => {
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
      primaryDocument: filing.primary_document,
      items: filing.items ?? [],
      earningsClassification: parseClassification(filing.earnings_classification),
    }
  })
}

export async function updateFilingClassification(
  client: SupabaseClient,
  filingId: string,
  classification: SecEarningsClassification,
): Promise<void> {
  const { error } = await client
    .from('sec_filings')
    .update({ earnings_classification: classification })
    .eq('id', filingId)

  if (error) {
    throw new Error(`Could not save filing classification: ${error.message}`)
  }
}

export async function getStoredPrimaryDocumentFilingIds(
  client: SupabaseClient,
): Promise<Set<string>> {
  const { data, error } = await client
    .from('documents')
    .select('filing_id')
    .eq('document_type', 'sec-primary-document')
    .not('filing_id', 'is', null)

  if (error) {
    throw new Error(`Could not load stored SEC documents: ${error.message}`)
  }

  return new Set((data ?? []).map((row) => row.filing_id as string))
}
