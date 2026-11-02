import type { SupabaseClient } from '@supabase/supabase-js'
import { ApiDatabaseTable } from './constants.js'
import {
  parseFrozenPredictionEvidence,
  presentPredictionEvidence,
  type EvidenceDocumentRow,
} from './evidence-presentation.js'
import {
  presentDerivedFinancialMetric,
  presentReportedFinancialMetric,
  presentSourceDocument,
  type DerivedFinancialMetricRow,
  type ReportedFinancialMetricRow,
  type SourceDocumentRow,
} from './event-details-presentation.js'
import { presentQualitativePrediction } from './prediction-presentation.js'
import { presentScoreBreakdown } from './score-presentation.js'
import type {
  ResearchCompany,
  ResearchEarningsEvent,
  ResearchEvaluation,
  ResearchEventDetails,
  ResearchPrediction,
  ResearchRepository,
} from './types.js'

interface EventCompanyRow {
  id: string
  ticker: string
  legal_name: string
  sector: string | null
}

interface WatchlistCompanyRow extends EventCompanyRow {
  exchange: string | null
  is_active: boolean
}

interface EvaluationRow {
  horizon_days: number
  stock_return: number | string
  market_return: number | string
  sector_return: number | string | null
  stock_minus_market_return: number | string
  stock_minus_sector_return: number | string | null
  calculated_at: string
}

interface PredictionRow {
  id: string
  score: number
  score_components: unknown
  rule_version: string
  cutoff_at: string
  recorded_at: string
  planned_entry_session: string
  planned_day_1_session: string
  planned_day_5_session: string
  planned_day_20_session: string
  snapshot: unknown
  evaluations: EvaluationRow[]
}

interface EarningsEventRow {
  id: string
  period_end: string | null
  detected_at: string
  status: string
  companies: EventCompanyRow | EventCompanyRow[]
  predictions: PredictionRow[]
}

interface UnpredictedEarningsEventRow {
  id: string
  period_end: string | null
  detected_at: string
  status: string
  companies: EventCompanyRow | EventCompanyRow[]
}

interface PredictionEvidenceRow {
  id: string
  snapshot: unknown
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function validateAndNormalizeUuid(value: string, description: string): string {
  const normalizedValue = value.trim()
  if (!uuidPattern.test(normalizedValue)) throw new Error(`${description} must be a valid UUID`)
  return normalizedValue
}

function singleCompany(value: EventCompanyRow | EventCompanyRow[]): EventCompanyRow {
  const company = Array.isArray(value) ? value[0] : value
  if (!company) throw new Error('Earnings event is missing its company')
  return company
}

function numericValue(value: number | string): number {
  const parsedValue = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsedValue)) throw new Error(`Invalid numeric database value: ${value}`)
  return parsedValue
}

function nullableNumericValue(value: number | string | null): number | null {
  return value === null ? null : numericValue(value)
}

function presentEvaluation(row: EvaluationRow): ResearchEvaluation {
  return {
    horizonDays: row.horizon_days,
    stockReturn: numericValue(row.stock_return),
    marketReturn: numericValue(row.market_return),
    sectorReturn: nullableNumericValue(row.sector_return),
    stockMinusMarketReturn: numericValue(row.stock_minus_market_return),
    stockMinusSectorReturn: nullableNumericValue(row.stock_minus_sector_return),
    calculatedAt: row.calculated_at,
  }
}

function presentPrediction(row: PredictionRow): ResearchPrediction {
  return {
    id: row.id,
    score: row.score,
    ...presentScoreBreakdown(row.score_components),
    ruleVersion: row.rule_version,
    cutoffAt: row.cutoff_at,
    recordedAt: row.recorded_at,
    plannedEntrySession: row.planned_entry_session,
    plannedDay1Session: row.planned_day_1_session,
    plannedDay5Session: row.planned_day_5_session,
    plannedDay20Session: row.planned_day_20_session,
    ...presentQualitativePrediction(row.snapshot),
    evaluations: row.evaluations
      .map(presentEvaluation)
      .sort((left, right) => left.horizonDays - right.horizonDays),
  }
}

function latestPrediction(rows: PredictionRow[]): ResearchPrediction | null {
  const latest = [...rows].sort((left, right) => right.cutoff_at.localeCompare(left.cutoff_at))[0]
  return latest ? presentPrediction(latest) : null
}

function presentEarningsEvent(row: EarningsEventRow): ResearchEarningsEvent {
  const company = singleCompany(row.companies)
  return {
    id: row.id,
    companyId: company.id,
    companyName: company.legal_name,
    ticker: company.ticker,
    sector: company.sector,
    periodEnd: row.period_end,
    detectedAt: row.detected_at,
    status: row.status,
    latestPrediction: latestPrediction(row.predictions),
  }
}

function presentUnpredictedEarningsEvent(
  row: UnpredictedEarningsEventRow,
): ResearchEarningsEvent {
  const company = singleCompany(row.companies)
  return {
    id: row.id,
    companyId: company.id,
    companyName: company.legal_name,
    ticker: company.ticker,
    sector: company.sector,
    periodEnd: row.period_end,
    detectedAt: row.detected_at,
    status: row.status,
    latestPrediction: null,
  }
}

function presentCompany(row: WatchlistCompanyRow): ResearchCompany {
  return {
    id: row.id,
    legalName: row.legal_name,
    ticker: row.ticker,
    exchange: row.exchange,
    sector: row.sector,
    isActive: row.is_active,
  }
}

export function createResearchRepository(client: SupabaseClient): ResearchRepository {
  return {
    async getWatchlistCompanies(): Promise<ResearchCompany[]> {
      const { data, error } = await client
        .from(ApiDatabaseTable.companies)
        .select('id,ticker,legal_name,exchange,sector,is_active')
        .order('ticker', { ascending: true })

      if (error) throw new Error(`Could not load watchlist companies: ${error.message}`)
      return (data as WatchlistCompanyRow[]).map(presentCompany)
    },

    async getRecentPredictionEvents(limit: number): Promise<ResearchEarningsEvent[]> {
      const { data, error } = await client
        .from(ApiDatabaseTable.earningsEvents)
        .select(`
          id,
          period_end,
          detected_at,
          status,
          companies!inner(id,ticker,legal_name,sector),
          predictions!inner(
            id,
            score,
            score_components,
            rule_version,
            cutoff_at,
            recorded_at,
            planned_entry_session,
            planned_day_1_session,
            planned_day_5_session,
            planned_day_20_session,
            snapshot,
            evaluations(
              horizon_days,
              stock_return,
              market_return,
              sector_return,
              stock_minus_market_return,
              stock_minus_sector_return,
              calculated_at
            )
          )
        `)
        .order('detected_at', { ascending: false })
        .limit(limit)

      if (error) throw new Error(`Could not load recent prediction events: ${error.message}`)
      return (data as EarningsEventRow[]).map(presentEarningsEvent)
    },

    async getRecentUnpredictedEvents(limit: number): Promise<ResearchEarningsEvent[]> {
      const { data, error } = await client
        .from(ApiDatabaseTable.earningsEvents)
        .select(`
          id,
          period_end,
          detected_at,
          status,
          companies!inner(id,ticker,legal_name,sector),
          predictions()
        `)
        .is('predictions', null)
        .order('detected_at', { ascending: false })
        .limit(limit)

      if (error) throw new Error(`Could not load unpredicted earnings events: ${error.message}`)
      return (data as UnpredictedEarningsEventRow[]).map(presentUnpredictedEarningsEvent)
    },

    async getEventDetails(eventId: string): Promise<ResearchEventDetails | null> {
      const normalizedEventId = validateAndNormalizeUuid(eventId, 'Earnings event ID')
      const { data: eventData, error: eventError } = await client
        .from(ApiDatabaseTable.earningsEvents)
        .select('id')
        .eq('id', normalizedEventId)
        .maybeSingle()
      if (eventError) throw new Error(`Could not load earnings event: ${eventError.message}`)
      if (!eventData) return null

      const [documentResult, reportedMetricResult, derivedMetricResult] = await Promise.all([
        client
          .from(ApiDatabaseTable.documents)
          .select(`
            id,
            document_type,
            source_url,
            published_at,
            first_seen_at,
            content_sha256,
            content_size_bytes
          `)
          .eq('earnings_event_id', normalizedEventId)
          .order('published_at', { ascending: false }),
        client
          .from(ApiDatabaseTable.financialMetrics)
          .select(`
            id,
            metric_code,
            value_numeric,
            unit,
            accounting_basis,
            period_start,
            period_end,
            source_document_id,
            extraction_version,
            xbrl_concept,
            source_text,
            created_at
          `)
          .eq('earnings_event_id', normalizedEventId)
          .order('period_end', { ascending: false })
          .order('metric_code', { ascending: true })
          .order('created_at', { ascending: false }),
        client
          .from(ApiDatabaseTable.financialDerivedMetrics)
          .select(`
            id,
            metric_code,
            value_numeric,
            unit,
            calculation_expression,
            calculation_version,
            created_at
          `)
          .eq('earnings_event_id', normalizedEventId)
          .order('created_at', { ascending: false })
          .order('metric_code', { ascending: true }),
      ])

      if (documentResult.error) {
        throw new Error(`Could not load event source documents: ${documentResult.error.message}`)
      }
      if (reportedMetricResult.error) {
        throw new Error(`Could not load reported financial metrics: ${reportedMetricResult.error.message}`)
      }
      if (derivedMetricResult.error) {
        throw new Error(`Could not load derived financial metrics: ${derivedMetricResult.error.message}`)
      }

      return {
        eventId: normalizedEventId,
        documents: (documentResult.data as SourceDocumentRow[]).map(presentSourceDocument),
        reportedMetrics: (reportedMetricResult.data as ReportedFinancialMetricRow[])
          .map(presentReportedFinancialMetric),
        derivedMetrics: (derivedMetricResult.data as DerivedFinancialMetricRow[])
          .map(presentDerivedFinancialMetric),
      }
    },

    async getPredictionEvidence(predictionId) {
      const normalizedId = validateAndNormalizeUuid(predictionId, 'Prediction ID')
      const { data: predictionData, error: predictionError } = await client
        .from(ApiDatabaseTable.predictions)
        .select('id,snapshot')
        .eq('id', normalizedId)
        .maybeSingle()
      if (predictionError) {
        throw new Error(`Could not load prediction evidence snapshot: ${predictionError.message}`)
      }
      if (!predictionData) return null

      const prediction = predictionData as PredictionEvidenceRow
      const frozenEvidence = parseFrozenPredictionEvidence(prediction.snapshot)
      const documentIds = frozenEvidence.documents.map((document) => document.documentId)
      const { data: documentData, error: documentError } = await client
        .from(ApiDatabaseTable.documents)
        .select('id,document_type,source_url,published_at,first_seen_at,content_sha256')
        .in('id', documentIds)
      if (documentError) {
        throw new Error(`Could not load prediction evidence documents: ${documentError.message}`)
      }

      return presentPredictionEvidence(
        prediction.id,
        frozenEvidence,
        documentData as EvidenceDocumentRow[],
      )
    },
  }
}
