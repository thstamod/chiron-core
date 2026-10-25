import type { SupabaseClient } from '@supabase/supabase-js'
import type { FinancialMetricDocumentSource } from './database.js'
import { calculateContentSha256 } from './content-hash.js'
import { DatabaseTable, StorageConfig, XbrlFiscalPeriod } from './constants.js'
import { decodeUtf8Text } from './document-text.js'
import {
  extractFinancialMetricsFromInlineXbrl,
  financialMetricExtractionVersion,
  type ExtractedFinancialMetric,
  type FinancialMetricExtractionResult,
} from './xbrl.js'

interface FinancialMetricRecord {
  earnings_event_id: string
  metric_code: string
  value_numeric: string | number
  unit: string
  accounting_basis: string
  period_start: string
  period_end: string
  source_document_id: string
  source_location: string
  extraction_version: string
  source_content_sha256: string
  xbrl_concept: string
  xbrl_context_id: string
  source_text: string
  source_metadata: Record<string, unknown>
}

interface FinancialMetricExtractionRecord {
  earnings_event_id: string
  source_document_id: string
  extraction_version: string
  source_content_sha256: string
  fiscal_year: number | null
  fiscal_period: string | null
  metric_count: number
  warnings: string[]
  output_sha256: string
}

interface EarningsEventFiscalIdentity {
  fiscal_year: number | null
  fiscal_quarter: number | null
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${canonicalJson(entryValue)}`)
    return `{${entries.join(',')}}`
  }
  return JSON.stringify(value)
}

function metricRecord(
  document: FinancialMetricDocumentSource,
  metric: ExtractedFinancialMetric,
): FinancialMetricRecord {
  return {
    earnings_event_id: document.earningsEventId,
    metric_code: metric.metricCode,
    value_numeric: metric.valueNumeric,
    unit: metric.unit,
    accounting_basis: metric.accountingBasis,
    period_start: metric.periodStart,
    period_end: metric.periodEnd,
    source_document_id: document.id,
    source_location: metric.sourceLocation,
    extraction_version: financialMetricExtractionVersion,
    source_content_sha256: document.contentSha256,
    xbrl_concept: metric.xbrlConcept,
    xbrl_context_id: metric.xbrlContextId,
    source_text: metric.sourceText,
    source_metadata: metric.sourceMetadata,
  }
}

function recordsMatch(
  expected: FinancialMetricRecord,
  stored: FinancialMetricRecord,
): boolean {
  return expected.earnings_event_id === stored.earnings_event_id
    && expected.metric_code === stored.metric_code
    && String(expected.value_numeric) === String(stored.value_numeric)
    && expected.unit === stored.unit
    && expected.accounting_basis === stored.accounting_basis
    && expected.period_start === stored.period_start
    && expected.period_end === stored.period_end
    && expected.source_document_id === stored.source_document_id
    && expected.source_location === stored.source_location
    && expected.extraction_version === stored.extraction_version
    && expected.source_content_sha256 === stored.source_content_sha256
    && expected.xbrl_concept === stored.xbrl_concept
    && expected.xbrl_context_id === stored.xbrl_context_id
    && expected.source_text === stored.source_text
    && canonicalJson(expected.source_metadata) === canonicalJson(stored.source_metadata)
}

function extractionRecordsMatch(
  expected: FinancialMetricExtractionRecord,
  stored: FinancialMetricExtractionRecord,
): boolean {
  return expected.earnings_event_id === stored.earnings_event_id
    && expected.source_document_id === stored.source_document_id
    && expected.extraction_version === stored.extraction_version
    && expected.source_content_sha256 === stored.source_content_sha256
    && expected.fiscal_year === stored.fiscal_year
    && expected.fiscal_period === stored.fiscal_period
    && expected.metric_count === Number(stored.metric_count)
    && canonicalJson(expected.warnings) === canonicalJson(stored.warnings)
    && expected.output_sha256 === stored.output_sha256
}

function fiscalQuarter(fiscalPeriod: string | null): number | null {
  switch (fiscalPeriod) {
    case XbrlFiscalPeriod.firstQuarter: return 1
    case XbrlFiscalPeriod.secondQuarter: return 2
    case XbrlFiscalPeriod.thirdQuarter: return 3
    case XbrlFiscalPeriod.fourthQuarter:
    case XbrlFiscalPeriod.fullYear: return 4
    default: return null
  }
}

async function saveEventFiscalIdentity(
  client: SupabaseClient,
  document: FinancialMetricDocumentSource,
  extraction: FinancialMetricExtractionResult,
): Promise<void> {
  const { data, error } = await client
    .from(DatabaseTable.earningsEvents)
    .select('fiscal_year,fiscal_quarter')
    .eq('id', document.earningsEventId)
    .single()
  if (error) {
    throw new Error(`Could not load fiscal identity for event ${document.earningsEventId}: ${error.message}`)
  }

  const storedIdentity = data as EarningsEventFiscalIdentity
  const extractedQuarter = fiscalQuarter(extraction.fiscalPeriod)
  if (
    storedIdentity.fiscal_year !== null
    && extraction.fiscalYear !== null
    && storedIdentity.fiscal_year !== extraction.fiscalYear
  ) {
    throw new Error(`Extracted fiscal year conflicts with event ${document.earningsEventId}`)
  }
  if (
    storedIdentity.fiscal_quarter !== null
    && extractedQuarter !== null
    && storedIdentity.fiscal_quarter !== extractedQuarter
  ) {
    throw new Error(`Extracted fiscal quarter conflicts with event ${document.earningsEventId}`)
  }

  const fiscalYear = storedIdentity.fiscal_year ?? extraction.fiscalYear
  const fiscalQuarterValue = storedIdentity.fiscal_quarter ?? extractedQuarter
  if (
    fiscalYear === storedIdentity.fiscal_year
    && fiscalQuarterValue === storedIdentity.fiscal_quarter
  ) return

  const { error: updateError } = await client
    .from(DatabaseTable.earningsEvents)
    .update({ fiscal_year: fiscalYear, fiscal_quarter: fiscalQuarterValue })
    .eq('id', document.earningsEventId)
  if (updateError) {
    throw new Error(`Could not save fiscal identity for event ${document.earningsEventId}: ${updateError.message}`)
  }
}

async function saveAndVerifyMetrics(
  client: SupabaseClient,
  document: FinancialMetricDocumentSource,
  extraction: FinancialMetricExtractionResult,
): Promise<void> {
  const expectedRecords = extraction.metrics.map((metric) => metricRecord(document, metric))
  if (expectedRecords.length > 0) {
    const { error } = await client
      .from(DatabaseTable.financialMetrics)
      .upsert(expectedRecords, {
        onConflict: 'source_document_id,extraction_version,source_content_sha256,metric_code',
        ignoreDuplicates: true,
      })
    if (error) {
      throw new Error(`Could not save financial metrics for document ${document.id}: ${error.message}`)
    }
  }

  const { data, error } = await client
    .from(DatabaseTable.financialMetrics)
    .select(`
      earnings_event_id,
      metric_code,
      value_numeric,
      unit,
      accounting_basis,
      period_start,
      period_end,
      source_document_id,
      source_location,
      extraction_version,
      source_content_sha256,
      xbrl_concept,
      xbrl_context_id,
      source_text,
      source_metadata
    `)
    .eq('source_document_id', document.id)
    .eq('extraction_version', financialMetricExtractionVersion)
    .eq('source_content_sha256', document.contentSha256)
    .order('metric_code')
  if (error) {
    throw new Error(`Could not verify financial metrics for document ${document.id}: ${error.message}`)
  }

  const storedRecords = (data ?? []) as FinancialMetricRecord[]
  const sortedExpectedRecords = [...expectedRecords].sort(
    (left, right) => left.metric_code.localeCompare(right.metric_code),
  )
  if (
    storedRecords.length !== sortedExpectedRecords.length
    || sortedExpectedRecords.some(
      (expected, index) => !recordsMatch(expected, storedRecords[index]!),
    )
  ) {
    throw new Error(`Stored financial metrics do not match document ${document.id}`)
  }
}

async function saveAndVerifyCompletion(
  client: SupabaseClient,
  document: FinancialMetricDocumentSource,
  extraction: FinancialMetricExtractionResult,
): Promise<void> {
  const serializedOutput = new TextEncoder().encode(JSON.stringify(extraction))
  const expectedRecord: FinancialMetricExtractionRecord = {
    earnings_event_id: document.earningsEventId,
    source_document_id: document.id,
    extraction_version: financialMetricExtractionVersion,
    source_content_sha256: document.contentSha256,
    fiscal_year: extraction.fiscalYear,
    fiscal_period: extraction.fiscalPeriod,
    metric_count: extraction.metrics.length,
    warnings: extraction.warnings,
    output_sha256: calculateContentSha256(serializedOutput),
  }

  const { error } = await client
    .from(DatabaseTable.financialMetricExtractions)
    .upsert(expectedRecord, {
      onConflict: 'source_document_id,extraction_version,source_content_sha256',
      ignoreDuplicates: true,
    })
  if (error) {
    throw new Error(`Could not complete financial metric extraction for document ${document.id}: ${error.message}`)
  }

  const { data, error: verificationError } = await client
    .from(DatabaseTable.financialMetricExtractions)
    .select(`
      earnings_event_id,
      source_document_id,
      extraction_version,
      source_content_sha256,
      fiscal_year,
      fiscal_period,
      metric_count,
      warnings,
      output_sha256
    `)
    .eq('source_document_id', document.id)
    .eq('extraction_version', financialMetricExtractionVersion)
    .eq('source_content_sha256', document.contentSha256)
    .single()
  if (verificationError) {
    throw new Error(`Could not verify financial metric extraction for document ${document.id}: ${verificationError.message}`)
  }
  if (!extractionRecordsMatch(expectedRecord, data as FinancialMetricExtractionRecord)) {
    throw new Error(`Stored financial metric extraction does not match document ${document.id}`)
  }
}

export async function extractAndStoreFinancialMetrics(
  client: SupabaseClient,
  document: FinancialMetricDocumentSource,
): Promise<FinancialMetricExtractionResult> {
  const { data: sourceDocumentFile, error } = await client.storage
    .from(StorageConfig.secDocumentsBucket)
    .download(document.storagePath)
  if (error) {
    throw new Error(`Could not download source document ${document.id}: ${error.message}`)
  }

  const sourceDocumentBytes = new Uint8Array(await sourceDocumentFile.arrayBuffer())
  if (calculateContentSha256(sourceDocumentBytes) !== document.contentSha256) {
    throw new Error(`Source document ${document.id} does not match its recorded fingerprint`)
  }

  let sourceDocumentHtml: string
  try {
    sourceDocumentHtml = decodeUtf8Text(sourceDocumentBytes)
  } catch {
    throw new Error(`Source document ${document.id} is not valid UTF-8`)
  }

  const extraction = extractFinancialMetricsFromInlineXbrl(
    sourceDocumentHtml,
    document.formType,
    document.reportDate,
  )
  await saveAndVerifyMetrics(client, document, extraction)
  await saveEventFiscalIdentity(client, document, extraction)
  await saveAndVerifyCompletion(client, document, extraction)
  return extraction
}
