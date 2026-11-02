import { validateTrustedSecArchiveUrl } from './evidence-presentation.js'
import type {
  ResearchDerivedFinancialMetric,
  ResearchReportedFinancialMetric,
  ResearchSourceDocument,
} from './types.js'

export interface SourceDocumentRow {
  id: string
  document_type: string
  source_url: string
  published_at: string
  first_seen_at: string
  content_sha256: string
  content_size_bytes: number | string | null
}

export interface ReportedFinancialMetricRow {
  id: string
  metric_code: string
  value_numeric: number | string
  unit: string
  accounting_basis: string
  period_start: string | null
  period_end: string
  source_document_id: string
  extraction_version: string
  xbrl_concept: string
  source_text: string
  created_at: string
}

export interface DerivedFinancialMetricRow {
  id: string
  metric_code: string
  value_numeric: number | string
  unit: string
  calculation_expression: string
  calculation_version: string
  created_at: string
}

function validatedTimestamp(value: string, description: string): string {
  if (!Number.isFinite(Date.parse(value))) throw new Error(`${description} has an invalid timestamp`)
  return value
}

function validatedFingerprint(value: string, description: string): string {
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error(`${description} has an invalid fingerprint`)
  return value
}

function validatedDecimal(value: number | string, description: string): string {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${description} has an invalid numeric value`)
    return String(value)
  }
  const normalizedValue = value.trim()
  if (!/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalizedValue)) {
    throw new Error(`${description} has an invalid numeric value`)
  }
  return normalizedValue
}

function contentSizeBytes(value: number | string | null): number | null {
  if (value === null) return null
  const parsedValue = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(parsedValue) || parsedValue < 0) {
    throw new Error('Source document has an invalid content size')
  }
  return parsedValue
}

export function presentSourceDocument(row: SourceDocumentRow): ResearchSourceDocument {
  return {
    id: row.id,
    documentType: row.document_type,
    sourceUrl: validateTrustedSecArchiveUrl(row.source_url),
    publishedAt: validatedTimestamp(row.published_at, 'Source document publication time'),
    firstSeenAt: validatedTimestamp(row.first_seen_at, 'Source document first-seen time'),
    contentSha256: validatedFingerprint(row.content_sha256, 'Source document'),
    contentSizeBytes: contentSizeBytes(row.content_size_bytes),
  }
}

export function presentReportedFinancialMetric(
  row: ReportedFinancialMetricRow,
): ResearchReportedFinancialMetric {
  return {
    id: row.id,
    metricCode: row.metric_code,
    value: validatedDecimal(row.value_numeric, `Reported metric ${row.metric_code}`),
    unit: row.unit,
    accountingBasis: row.accounting_basis,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    sourceDocumentId: row.source_document_id,
    extractionVersion: row.extraction_version,
    xbrlConcept: row.xbrl_concept,
    sourceText: row.source_text,
    createdAt: validatedTimestamp(row.created_at, `Reported metric ${row.metric_code}`),
  }
}

export function presentDerivedFinancialMetric(
  row: DerivedFinancialMetricRow,
): ResearchDerivedFinancialMetric {
  return {
    id: row.id,
    metricCode: row.metric_code,
    value: validatedDecimal(row.value_numeric, `Derived metric ${row.metric_code}`),
    unit: row.unit,
    calculationExpression: row.calculation_expression,
    calculationVersion: row.calculation_version,
    createdAt: validatedTimestamp(row.created_at, `Derived metric ${row.metric_code}`),
  }
}
