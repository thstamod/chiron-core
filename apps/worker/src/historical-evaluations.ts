import type { SupabaseClient } from '@supabase/supabase-js'
import {
  BenchmarkRole,
  type BenchmarkRoleValue,
  DatabaseTable,
  EvaluationHorizonTradingDays,
  HistoricalEvaluationSnapshotVersion,
  PriceInstrumentType,
  RuleVersion,
} from './constants.js'
import { canonicalJson } from './canonical-json.js'
import { calculateContentSha256 } from './content-hash.js'
import {
  calculateEvaluationReturns,
  type EvaluationReturnResult,
} from './evaluation-calculation.js'
import type { EvaluationHorizonDays } from './evaluations.js'

interface StoredHistoricalPredictionForEvaluation {
  id: string
  earnings_event_id: string
  experiment_version: string
  feature_set_version: string
  simulated_cutoff_at: string
  snapshot_sha256: string
  planned_entry_session: string
  planned_day_1_session: string
  planned_day_5_session: string
  planned_day_20_session: string
  entry_calendar_code: string
  entry_calendar_version: string
}

interface StoredHistoricalEventForEvaluation {
  company_id: string
  companies: { ticker: string; legal_name: string } | Array<{
    ticker: string
    legal_name: string
  }>
}

interface StoredMarketSessionForHistoricalEvaluation {
  session_date: string
  closes_at: string
}

interface StoredHistoricalBenchmarkAssignment {
  id: string
  benchmark_instrument_id: string
  benchmark_role: BenchmarkRoleValue
  mapping_version: string
  applicable_from: string
  created_at: string
}

interface StoredHistoricalPriceInstrument {
  id: string
  symbol: string
  instrument_type: string
  provider_name: string
  provider_symbol: string
}

interface StoredHistoricalPriceObservation {
  id: string
  price_instrument_id: string
  trading_date: string
  adjusted_open_price: string | number
  adjusted_close_price: string | number
  observation_sha256: string
  fetched_at: string
  created_at: string
}

interface HistoricalEvaluationInstrumentEvidence {
  instrument: StoredHistoricalPriceInstrument
  entryObservation: StoredHistoricalPriceObservation
  exitObservation: StoredHistoricalPriceObservation
}

interface HistoricalEvaluationBenchmarkEvidence
  extends HistoricalEvaluationInstrumentEvidence {
  assignment: StoredHistoricalBenchmarkAssignment
}

export interface HistoricalEvaluationPreview extends Record<string, unknown> {
  writesDatabase: false
  status: 'ready' | 'not_ready' | 'already_evaluated'
  reconstructionMode: 'retrospective'
  historicalPredictionId: string
  historicalPredictionSnapshotFingerprint: string
  ticker: string
  experimentVersion: string
  featureSetVersion: string
  simulatedCutoffAt: string
  horizonDays: EvaluationHorizonDays
  methodologyVersion: string
  reconstructionRuleVersion: string
  calculatedAt: string
  entrySession: string
  exitSession: string
  reasons: string[]
  stock?: HistoricalEvaluationInstrumentEvidence
  marketBenchmark?: HistoricalEvaluationBenchmarkEvidence
  sectorBenchmark?: HistoricalEvaluationBenchmarkEvidence
  returns?: EvaluationReturnResult
}

export interface HistoricalEvaluationSnapshot {
  schemaVersion: string
  calculatedAt: string
  methodologyVersion: string
  reconstructionRuleVersion: string
  reconstructionMode: 'retrospective'
  historicalPrediction: {
    id: string
    snapshotFingerprint: string
    experimentVersion: string
    featureSetVersion: string
    simulatedCutoffAt: string
  }
  horizonDays: EvaluationHorizonDays
  entrySession: string
  exitSession: string
  stock: HistoricalEvaluationInstrumentEvidence
  marketBenchmark: HistoricalEvaluationBenchmarkEvidence
  sectorBenchmark: HistoricalEvaluationBenchmarkEvidence
  returns: EvaluationReturnResult
}

export interface PreparedHistoricalEvaluationSnapshot {
  snapshot: HistoricalEvaluationSnapshot
  fingerprint: string
}

export interface HistoricalEvaluationCreationSummary extends Record<string, unknown> {
  historicalEvaluationId: string
  historicalPredictionId: string
  ticker: string
  horizonDays: EvaluationHorizonDays
  methodologyVersion: string
  reconstructionRuleVersion: string
  calculatedAt: string
  databaseRecordedAt: string
  entrySession: string
  exitSession: string
  stockReturn: number
  stockMinusMarketReturn: number
  stockMinusSectorReturn: number
  snapshotFingerprint: string
}

function singleCompany(
  companies: StoredHistoricalEventForEvaluation['companies'],
): { ticker: string; legal_name: string } {
  const company = Array.isArray(companies) ? companies[0] : companies
  if (!company) throw new Error('Historical evaluation event has no related company')
  return company
}

export function historicalEvaluationExitSession(
  prediction: Pick<
    StoredHistoricalPredictionForEvaluation,
    'planned_day_1_session' | 'planned_day_5_session' | 'planned_day_20_session'
  >,
  horizonDays: EvaluationHorizonDays,
): string {
  if (horizonDays === EvaluationHorizonTradingDays.one) {
    return prediction.planned_day_1_session
  }
  if (horizonDays === EvaluationHorizonTradingDays.five) {
    return prediction.planned_day_5_session
  }
  return prediction.planned_day_20_session
}

async function loadLatestHistoricalPriceObservation(
  client: SupabaseClient,
  priceInstrumentId: string,
  tradingDate: string,
  calculatedAt: string,
): Promise<StoredHistoricalPriceObservation | null> {
  const { data, error } = await client
    .from(DatabaseTable.dailyPriceObservations)
    .select(
      'id,price_instrument_id,trading_date,adjusted_open_price,adjusted_close_price,'
      + 'observation_sha256,fetched_at,created_at',
    )
    .eq('price_instrument_id', priceInstrumentId)
    .eq('trading_date', tradingDate)
    .lte('fetched_at', calculatedAt)
    .lte('created_at', calculatedAt)
    .order('fetched_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) {
    throw new Error(`Could not load historical evaluation price: ${error.message}`)
  }
  return data as StoredHistoricalPriceObservation | null
}

function observationWasCollectedAfterSessionClosed(
  observation: StoredHistoricalPriceObservation | null,
  sessionClose: string,
): boolean {
  if (!observation) return false
  const fetchedAt = new Date(observation.fetched_at)
  const closesAt = new Date(sessionClose)
  if (Number.isNaN(fetchedAt.valueOf()) || Number.isNaN(closesAt.valueOf())) {
    throw new Error('Historical evaluation contains an invalid price or session timestamp')
  }
  return fetchedAt >= closesAt
}

export async function previewHistoricalEvaluation(
  client: SupabaseClient,
  historicalPredictionId: string,
  horizonDays: EvaluationHorizonDays,
  now: () => Date = () => new Date(),
): Promise<HistoricalEvaluationPreview> {
  const normalizedHistoricalPredictionId = historicalPredictionId.trim()
  if (!normalizedHistoricalPredictionId) {
    throw new Error('Historical evaluation preview requires a historical prediction ID')
  }
  const calculationTime = now()
  if (Number.isNaN(calculationTime.valueOf())) {
    throw new Error('Historical evaluation preview clock returned an invalid date')
  }
  const calculatedAt = calculationTime.toISOString()

  const { data: predictionData, error: predictionError } = await client
    .from(DatabaseTable.historicalPredictions)
    .select(
      'id,earnings_event_id,experiment_version,feature_set_version,simulated_cutoff_at,'
      + 'snapshot_sha256,planned_entry_session,planned_day_1_session,'
      + 'planned_day_5_session,planned_day_20_session,entry_calendar_code,'
      + 'entry_calendar_version',
    )
    .eq('id', normalizedHistoricalPredictionId)
    .single()
  if (predictionError) {
    throw new Error(`Could not load historical evaluation prediction: ${predictionError.message}`)
  }
  const prediction = predictionData as unknown as StoredHistoricalPredictionForEvaluation
  const exitSession = historicalEvaluationExitSession(prediction, horizonDays)

  const [{ data: eventData, error: eventError }, { data: sessionData, error: sessionError }] = (
    await Promise.all([
      client
        .from(DatabaseTable.earningsEvents)
        .select('company_id,companies!inner(ticker,legal_name)')
        .eq('id', prediction.earnings_event_id)
        .single(),
      client
        .from(DatabaseTable.marketSessions)
        .select('session_date,closes_at')
        .eq('calendar_code', prediction.entry_calendar_code)
        .eq('calendar_version', prediction.entry_calendar_version)
        .in('session_date', [prediction.planned_entry_session, exitSession])
        .order('session_date'),
    ])
  )
  if (eventError) {
    throw new Error(`Could not load historical evaluation event: ${eventError.message}`)
  }
  if (sessionError) {
    throw new Error(`Could not load historical evaluation sessions: ${sessionError.message}`)
  }
  const event = eventData as unknown as StoredHistoricalEventForEvaluation
  const company = singleCompany(event.companies)
  const sessions = (sessionData ?? []) as StoredMarketSessionForHistoricalEvaluation[]
  const entryMarketSession = sessions.find(
    (session) => session.session_date === prediction.planned_entry_session,
  )
  const exitMarketSession = sessions.find((session) => session.session_date === exitSession)
  if (!entryMarketSession || !exitMarketSession) {
    throw new Error('Historical prediction references a missing market session')
  }

  const basePreview = {
    writesDatabase: false as const,
    reconstructionMode: 'retrospective' as const,
    historicalPredictionId: prediction.id,
    historicalPredictionSnapshotFingerprint: prediction.snapshot_sha256,
    ticker: company.ticker,
    experimentVersion: prediction.experiment_version,
    featureSetVersion: prediction.feature_set_version,
    simulatedCutoffAt: new Date(prediction.simulated_cutoff_at).toISOString(),
    horizonDays,
    methodologyVersion: RuleVersion.evaluationMethodology,
    reconstructionRuleVersion: RuleVersion.historicalEvaluationReconstruction,
    calculatedAt,
    entrySession: prediction.planned_entry_session,
    exitSession,
  }
  const exitSessionClosesAt = new Date(exitMarketSession.closes_at)
  if (Number.isNaN(exitSessionClosesAt.valueOf())) {
    throw new Error('Historical evaluation exit session has an invalid close timestamp')
  }
  if (calculationTime < exitSessionClosesAt) {
    return {
      ...basePreview,
      status: 'not_ready',
      reasons: [`The ${horizonDays}-day historical exit session has not closed yet`],
    }
  }

  const { data: existingEvaluation, error: existingEvaluationError } = await client
    .from(DatabaseTable.historicalEvaluations)
    .select('id')
    .eq('historical_prediction_id', prediction.id)
    .eq('horizon_days', horizonDays)
    .eq('methodology_version', RuleVersion.evaluationMethodology)
    .eq('reconstruction_rule_version', RuleVersion.historicalEvaluationReconstruction)
    .limit(1)
    .maybeSingle()
  if (existingEvaluationError) {
    throw new Error(
      `Could not check for an existing historical evaluation: ${existingEvaluationError.message}`,
    )
  }
  if (existingEvaluation) {
    return {
      ...basePreview,
      status: 'already_evaluated',
      reasons: [`Historical evaluation ${existingEvaluation.id} already exists`],
    }
  }

  const [{ data: instrumentData, error: instrumentError }, assignmentResult] = await Promise.all([
    client
      .from(DatabaseTable.priceInstruments)
      .select('id,symbol,instrument_type,provider_name,provider_symbol')
      .eq('company_id', event.company_id)
      .eq('instrument_type', PriceInstrumentType.companyStock)
      .single(),
    client
      .from(DatabaseTable.companyBenchmarkAssignments)
      .select(
        'id,benchmark_instrument_id,benchmark_role,mapping_version,applicable_from,created_at',
      )
      .eq('company_id', event.company_id)
      .lte('applicable_from', prediction.planned_entry_session)
      .lte('created_at', calculatedAt)
      .order('applicable_from', { ascending: false })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false }),
  ])
  if (instrumentError) {
    throw new Error(`Could not load historical company price instrument: ${instrumentError.message}`)
  }
  if (assignmentResult.error) {
    throw new Error(
      `Could not load historical benchmark assignments: ${assignmentResult.error.message}`,
    )
  }

  const stockInstrument = instrumentData as StoredHistoricalPriceInstrument
  const assignments = (assignmentResult.data ?? []) as StoredHistoricalBenchmarkAssignment[]
  const marketAssignment = assignments.find(
    (assignment) => assignment.benchmark_role === BenchmarkRole.market,
  )
  const sectorAssignment = assignments.find(
    (assignment) => assignment.benchmark_role === BenchmarkRole.sector,
  )
  const reasons: string[] = []
  if (!marketAssignment) reasons.push('No market benchmark mapping applies to the entry session')
  if (!sectorAssignment) reasons.push('No sector benchmark mapping applies to the entry session')
  if (!marketAssignment || !sectorAssignment) {
    return { ...basePreview, status: 'not_ready', reasons }
  }

  const { data: benchmarkInstrumentData, error: benchmarkInstrumentError } = await client
    .from(DatabaseTable.priceInstruments)
    .select('id,symbol,instrument_type,provider_name,provider_symbol')
    .in('id', [marketAssignment.benchmark_instrument_id, sectorAssignment.benchmark_instrument_id])
  if (benchmarkInstrumentError) {
    throw new Error(
      `Could not load historical benchmark instruments: ${benchmarkInstrumentError.message}`,
    )
  }
  const benchmarkInstruments = (
    benchmarkInstrumentData ?? []
  ) as StoredHistoricalPriceInstrument[]
  const marketInstrument = benchmarkInstruments.find(
    (instrument) => instrument.id === marketAssignment.benchmark_instrument_id,
  )
  const sectorInstrument = benchmarkInstruments.find(
    (instrument) => instrument.id === sectorAssignment.benchmark_instrument_id,
  )
  if (!marketInstrument) reasons.push('The market benchmark instrument is missing')
  if (!sectorInstrument) reasons.push('The sector benchmark instrument is missing')
  if (!marketInstrument || !sectorInstrument) {
    return { ...basePreview, status: 'not_ready', reasons }
  }

  const [
    stockEntryObservation,
    stockExitObservation,
    marketEntryObservation,
    marketExitObservation,
    sectorEntryObservation,
    sectorExitObservation,
  ] = await Promise.all([
    loadLatestHistoricalPriceObservation(
      client,
      stockInstrument.id,
      prediction.planned_entry_session,
      calculatedAt,
    ),
    loadLatestHistoricalPriceObservation(client, stockInstrument.id, exitSession, calculatedAt),
    loadLatestHistoricalPriceObservation(
      client,
      marketInstrument.id,
      prediction.planned_entry_session,
      calculatedAt,
    ),
    loadLatestHistoricalPriceObservation(client, marketInstrument.id, exitSession, calculatedAt),
    loadLatestHistoricalPriceObservation(
      client,
      sectorInstrument.id,
      prediction.planned_entry_session,
      calculatedAt,
    ),
    loadLatestHistoricalPriceObservation(client, sectorInstrument.id, exitSession, calculatedAt),
  ])

  const requiredObservations = [
    ['stock entry', stockEntryObservation, entryMarketSession.closes_at],
    ['stock exit', stockExitObservation, exitMarketSession.closes_at],
    ['market entry', marketEntryObservation, entryMarketSession.closes_at],
    ['market exit', marketExitObservation, exitMarketSession.closes_at],
    ['sector entry', sectorEntryObservation, entryMarketSession.closes_at],
    ['sector exit', sectorExitObservation, exitMarketSession.closes_at],
  ] as const
  for (const [description, observation, sessionClose] of requiredObservations) {
    if (!observation) reasons.push(`The historical ${description} price is missing`)
    else if (!observationWasCollectedAfterSessionClosed(observation, sessionClose)) {
      reasons.push(`The historical ${description} price was fetched before its session closed`)
    }
  }
  if (
    reasons.length > 0
    || !stockEntryObservation
    || !stockExitObservation
    || !marketEntryObservation
    || !marketExitObservation
    || !sectorEntryObservation
    || !sectorExitObservation
  ) {
    return { ...basePreview, status: 'not_ready', reasons }
  }

  const stock = {
    instrument: stockInstrument,
    entryObservation: stockEntryObservation,
    exitObservation: stockExitObservation,
  }
  const marketBenchmark = {
    assignment: marketAssignment,
    instrument: marketInstrument,
    entryObservation: marketEntryObservation,
    exitObservation: marketExitObservation,
  }
  const sectorBenchmark = {
    assignment: sectorAssignment,
    instrument: sectorInstrument,
    entryObservation: sectorEntryObservation,
    exitObservation: sectorExitObservation,
  }
  const returns = calculateEvaluationReturns({
    stock: {
      adjustedEntryOpenPrice: stockEntryObservation.adjusted_open_price,
      adjustedExitClosePrice: stockExitObservation.adjusted_close_price,
    },
    marketBenchmark: {
      adjustedEntryOpenPrice: marketEntryObservation.adjusted_open_price,
      adjustedExitClosePrice: marketExitObservation.adjusted_close_price,
    },
    sectorBenchmark: {
      adjustedEntryOpenPrice: sectorEntryObservation.adjusted_open_price,
      adjustedExitClosePrice: sectorExitObservation.adjusted_close_price,
    },
  })

  return {
    ...basePreview,
    status: 'ready',
    reasons: [],
    stock,
    marketBenchmark,
    sectorBenchmark,
    returns,
  }
}

export function prepareHistoricalEvaluationSnapshot(
  preview: HistoricalEvaluationPreview,
): PreparedHistoricalEvaluationSnapshot {
  if (
    preview.status !== 'ready'
    || !preview.stock
    || !preview.marketBenchmark
    || !preview.sectorBenchmark
    || !preview.returns
    || !preview.returns.sectorBenchmark
    || preview.returns.stockMinusSectorReturn === null
  ) {
    throw new Error(
      `Historical evaluation is not ready: ${preview.reasons.join('; ') || preview.status}`,
    )
  }
  const snapshot: HistoricalEvaluationSnapshot = {
    schemaVersion: HistoricalEvaluationSnapshotVersion.initial,
    calculatedAt: preview.calculatedAt,
    methodologyVersion: preview.methodologyVersion,
    reconstructionRuleVersion: preview.reconstructionRuleVersion,
    reconstructionMode: preview.reconstructionMode,
    historicalPrediction: {
      id: preview.historicalPredictionId,
      snapshotFingerprint: preview.historicalPredictionSnapshotFingerprint,
      experimentVersion: preview.experimentVersion,
      featureSetVersion: preview.featureSetVersion,
      simulatedCutoffAt: preview.simulatedCutoffAt,
    },
    horizonDays: preview.horizonDays,
    entrySession: preview.entrySession,
    exitSession: preview.exitSession,
    stock: preview.stock,
    marketBenchmark: preview.marketBenchmark,
    sectorBenchmark: preview.sectorBenchmark,
    returns: preview.returns,
  }
  return {
    snapshot,
    fingerprint: calculateContentSha256(
      new TextEncoder().encode(canonicalJson(snapshot)),
    ),
  }
}

export async function createAndStoreHistoricalEvaluation(
  client: SupabaseClient,
  historicalPredictionId: string,
  horizonDays: EvaluationHorizonDays,
  now: () => Date = () => new Date(),
): Promise<HistoricalEvaluationCreationSummary> {
  const preview = await previewHistoricalEvaluation(
    client,
    historicalPredictionId,
    horizonDays,
    now,
  )
  const { snapshot, fingerprint } = prepareHistoricalEvaluationSnapshot(preview)
  const sectorBenchmarkReturn = snapshot.returns.sectorBenchmark
  const stockMinusSectorReturn = snapshot.returns.stockMinusSectorReturn
  if (!sectorBenchmarkReturn || stockMinusSectorReturn === null) {
    throw new Error('Historical evaluation requires complete sector benchmark returns')
  }
  const { data, error } = await client
    .from(DatabaseTable.historicalEvaluations)
    .insert({
      historical_prediction_id: snapshot.historicalPrediction.id,
      horizon_days: snapshot.horizonDays,
      stock_entry_price: snapshot.returns.stock.entryPrice,
      stock_exit_price: snapshot.returns.stock.exitPrice,
      market_entry_price: snapshot.returns.marketBenchmark.entryPrice,
      market_exit_price: snapshot.returns.marketBenchmark.exitPrice,
      sector_entry_price: sectorBenchmarkReturn.entryPrice,
      sector_exit_price: sectorBenchmarkReturn.exitPrice,
      stock_return: snapshot.returns.stock.returnFraction,
      market_return: snapshot.returns.marketBenchmark.returnFraction,
      sector_return: sectorBenchmarkReturn.returnFraction,
      stock_minus_market_return: snapshot.returns.stockMinusMarketReturn,
      stock_minus_sector_return: stockMinusSectorReturn,
      stock_entry_price_observation_id: snapshot.stock.entryObservation.id,
      stock_exit_price_observation_id: snapshot.stock.exitObservation.id,
      market_entry_price_observation_id: snapshot.marketBenchmark.entryObservation.id,
      market_exit_price_observation_id: snapshot.marketBenchmark.exitObservation.id,
      sector_entry_price_observation_id: snapshot.sectorBenchmark.entryObservation.id,
      sector_exit_price_observation_id: snapshot.sectorBenchmark.exitObservation.id,
      market_benchmark_assignment_id: snapshot.marketBenchmark.assignment.id,
      sector_benchmark_assignment_id: snapshot.sectorBenchmark.assignment.id,
      planned_exit_session: snapshot.exitSession,
      calculated_at: snapshot.calculatedAt,
      methodology_version: snapshot.methodologyVersion,
      reconstruction_rule_version: snapshot.reconstructionRuleVersion,
      snapshot,
      snapshot_schema_version: snapshot.schemaVersion,
      snapshot_sha256: fingerprint,
    })
    .select('id,recorded_at')
    .single()
  if (error) throw new Error(`Could not save historical evaluation: ${error.message}`)
  return {
    historicalEvaluationId: data.id,
    historicalPredictionId: snapshot.historicalPrediction.id,
    ticker: preview.ticker,
    horizonDays: snapshot.horizonDays,
    methodologyVersion: snapshot.methodologyVersion,
    reconstructionRuleVersion: snapshot.reconstructionRuleVersion,
    calculatedAt: snapshot.calculatedAt,
    databaseRecordedAt: data.recorded_at,
    entrySession: snapshot.entrySession,
    exitSession: snapshot.exitSession,
    stockReturn: snapshot.returns.stock.returnFraction,
    stockMinusMarketReturn: snapshot.returns.stockMinusMarketReturn,
    stockMinusSectorReturn,
    snapshotFingerprint: fingerprint,
  }
}
