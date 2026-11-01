import type { SupabaseClient } from '@supabase/supabase-js'
import { ApiDatabaseTable } from './constants.js'
import { presentQualitativePrediction } from './prediction-presentation.js'
import type {
  ResearchEarningsEvent,
  ResearchEvaluation,
  ResearchPrediction,
  ResearchRepository,
} from './types.js'

interface CompanyRow {
  id: string
  ticker: string
  legal_name: string
  sector: string | null
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
  cutoff_at: string
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
  companies: CompanyRow | CompanyRow[]
  predictions: PredictionRow[]
}

function singleCompany(value: CompanyRow | CompanyRow[]): CompanyRow {
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
    cutoffAt: row.cutoff_at,
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

export function createResearchRepository(client: SupabaseClient): ResearchRepository {
  return {
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
            cutoff_at,
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
  }
}
