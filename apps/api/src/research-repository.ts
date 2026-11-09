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
  ResearchHistoricalPredictionResult,
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
  id: string
  horizon_days: number
  planned_exit_session: string
  stock_entry_price: number | string
  stock_exit_price: number | string
  market_entry_price: number | string
  market_exit_price: number | string
  sector_entry_price: number | string | null
  sector_exit_price: number | string | null
  stock_return: number | string
  market_return: number | string
  sector_return: number | string | null
  stock_minus_market_return: number | string
  stock_minus_sector_return: number | string | null
  stock_entry_price_observation_id: string
  stock_exit_price_observation_id: string
  market_entry_price_observation_id: string
  market_exit_price_observation_id: string
  sector_entry_price_observation_id: string | null
  sector_exit_price_observation_id: string | null
  methodology_version: string
  reconstruction_rule_version?: string
  calculated_at: string
  recorded_at: string
  snapshot_sha256: string
}

interface HistoricalPredictionEventRow {
  id: string
  period_end: string | null
  companies: EventCompanyRow | EventCompanyRow[]
}

interface HistoricalPredictionResultRow {
  id: string
  score: number
  rule_version: string
  experiment_version: string
  feature_set_version: string
  simulated_cutoff_at: string
  recorded_at: string
  planned_entry_session: string
  earnings_events: HistoricalPredictionEventRow | HistoricalPredictionEventRow[]
  historical_evaluations: EvaluationRow[]
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
    id: row.id,
    horizonDays: row.horizon_days,
    plannedExitSession: row.planned_exit_session,
    stockEntryPrice: numericValue(row.stock_entry_price),
    stockExitPrice: numericValue(row.stock_exit_price),
    marketEntryPrice: numericValue(row.market_entry_price),
    marketExitPrice: numericValue(row.market_exit_price),
    sectorEntryPrice: nullableNumericValue(row.sector_entry_price),
    sectorExitPrice: nullableNumericValue(row.sector_exit_price),
    stockReturn: numericValue(row.stock_return),
    marketReturn: numericValue(row.market_return),
    sectorReturn: nullableNumericValue(row.sector_return),
    stockMinusMarketReturn: numericValue(row.stock_minus_market_return),
    stockMinusSectorReturn: nullableNumericValue(row.stock_minus_sector_return),
    stockEntryPriceObservationId: row.stock_entry_price_observation_id,
    stockExitPriceObservationId: row.stock_exit_price_observation_id,
    marketEntryPriceObservationId: row.market_entry_price_observation_id,
    marketExitPriceObservationId: row.market_exit_price_observation_id,
    sectorEntryPriceObservationId: row.sector_entry_price_observation_id,
    sectorExitPriceObservationId: row.sector_exit_price_observation_id,
    methodologyVersion: row.methodology_version,
    reconstructionRuleVersion: row.reconstruction_rule_version ?? null,
    calculatedAt: row.calculated_at,
    recordedAt: row.recorded_at,
    snapshotFingerprint: row.snapshot_sha256,
  }
}

function presentHistoricalPredictionResult(
  row: HistoricalPredictionResultRow,
): ResearchHistoricalPredictionResult {
  const event = Array.isArray(row.earnings_events)
    ? row.earnings_events[0]
    : row.earnings_events
  if (!event) throw new Error('Historical prediction is missing its earnings event')
  const company = singleCompany(event.companies)
  return {
    predictionId: row.id,
    eventId: event.id,
    companyName: company.legal_name,
    ticker: company.ticker,
    sector: company.sector,
    periodEnd: event.period_end,
    score: row.score,
    ruleVersion: row.rule_version,
    experimentVersion: row.experiment_version,
    featureSetVersion: row.feature_set_version,
    simulatedCutoffAt: row.simulated_cutoff_at,
    recordedAt: row.recorded_at,
    plannedEntrySession: row.planned_entry_session,
    evaluations: row.historical_evaluations
      .map(presentEvaluation)
      .sort((left, right) => left.horizonDays - right.horizonDays),
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
              id,
              horizon_days,
              planned_exit_session,
              stock_entry_price,
              stock_exit_price,
              market_entry_price,
              market_exit_price,
              sector_entry_price,
              sector_exit_price,
              stock_return,
              market_return,
              sector_return,
              stock_minus_market_return,
              stock_minus_sector_return,
              stock_entry_price_observation_id,
              stock_exit_price_observation_id,
              market_entry_price_observation_id,
              market_exit_price_observation_id,
              sector_entry_price_observation_id,
              sector_exit_price_observation_id,
              methodology_version,
              calculated_at,
              recorded_at,
              snapshot_sha256
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

    async getHistoricalPredictionResults(limit): Promise<ResearchHistoricalPredictionResult[]> {
      const { data, error } = await client
        .from(ApiDatabaseTable.historicalPredictions)
        .select(`
          id,
          score,
          rule_version,
          experiment_version,
          feature_set_version,
          simulated_cutoff_at,
          recorded_at,
          planned_entry_session,
          earnings_events!inner(
            id,
            period_end,
            companies!inner(id,ticker,legal_name,sector)
          ),
          historical_evaluations!inner(
            id,
            horizon_days,
            planned_exit_session,
            stock_entry_price,
            stock_exit_price,
            market_entry_price,
            market_exit_price,
            sector_entry_price,
            sector_exit_price,
            stock_return,
            market_return,
            sector_return,
            stock_minus_market_return,
            stock_minus_sector_return,
            stock_entry_price_observation_id,
            stock_exit_price_observation_id,
            market_entry_price_observation_id,
            market_exit_price_observation_id,
            sector_entry_price_observation_id,
            sector_exit_price_observation_id,
            methodology_version,
            reconstruction_rule_version,
            calculated_at,
            recorded_at,
            snapshot_sha256
          )
        `)
        .order('recorded_at', { ascending: false })
        .limit(limit)

      if (error) {
        throw new Error(`Could not load historical prediction results: ${error.message}`)
      }
      return (data as HistoricalPredictionResultRow[]).map(presentHistoricalPredictionResult)
    },
  }
}
