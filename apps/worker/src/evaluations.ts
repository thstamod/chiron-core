import type { SupabaseClient } from '@supabase/supabase-js'
import {
  BenchmarkRole,
  type BenchmarkRoleValue,
  DatabaseTable,
  EvaluationHorizonTradingDays,
  PriceInstrumentType,
  RuleVersion,
} from './constants.js'
import {
  calculateEvaluationReturns,
  type EvaluationReturnResult,
} from './evaluation-calculation.js'

export type EvaluationHorizonDays =
  typeof EvaluationHorizonTradingDays[keyof typeof EvaluationHorizonTradingDays]

interface StoredPredictionForEvaluation {
  id: string
  earnings_event_id: string
  cutoff_at: string
  snapshot_sha256: string
  planned_entry_session: string
  planned_day_1_session: string
  planned_day_5_session: string
  planned_day_20_session: string
  entry_calendar_code: string
  entry_calendar_version: string
}

interface StoredEarningsEventForEvaluation {
  company_id: string
  companies: {
    ticker: string
    legal_name: string
  } | Array<{
    ticker: string
    legal_name: string
  }>
}

interface StoredMarketSessionForEvaluation {
  session_date: string
  closes_at: string
}

interface StoredBenchmarkAssignment {
  id: string
  benchmark_instrument_id: string
  benchmark_role: BenchmarkRoleValue
  mapping_version: string
  applicable_from: string
  created_at: string
}

interface StoredPriceInstrument {
  id: string
  symbol: string
  instrument_type: string
  provider_name: string
  provider_symbol: string
}

interface StoredPriceObservation {
  id: string
  price_instrument_id: string
  trading_date: string
  adjusted_open_price: string | number
  adjusted_close_price: string | number
  observation_sha256: string
  fetched_at: string
  created_at: string
}

interface EvaluationInstrumentEvidence {
  instrument: StoredPriceInstrument
  entryObservation: StoredPriceObservation
  exitObservation: StoredPriceObservation
}

interface EvaluationBenchmarkEvidence extends EvaluationInstrumentEvidence {
  assignment: StoredBenchmarkAssignment
}

export interface EvaluationPreview extends Record<string, unknown> {
  writesDatabase: false
  status: 'ready' | 'not_ready' | 'already_evaluated'
  predictionId: string
  predictionSnapshotFingerprint: string
  ticker: string
  horizonDays: EvaluationHorizonDays
  methodologyVersion: string
  calculatedAt: string
  entrySession: string
  exitSession: string
  reasons: string[]
  stock?: EvaluationInstrumentEvidence
  marketBenchmark?: EvaluationBenchmarkEvidence
  sectorBenchmark?: EvaluationBenchmarkEvidence
  returns?: EvaluationReturnResult
}

function validTimestamp(value: string, description: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.valueOf())) throw new Error(`${description} is not a valid timestamp`)
  return parsed.toISOString()
}

function singleRelation<T>(relation: T | T[]): T {
  const selected = Array.isArray(relation) ? relation[0] : relation
  if (!selected) throw new Error('Evaluation event has no related company')
  return selected
}

export function parseEvaluationHorizon(value: string): EvaluationHorizonDays {
  const horizon = Number(value)
  const supportedHorizons = new Set<number>(Object.values(EvaluationHorizonTradingDays))
  if (!Number.isInteger(horizon) || !supportedHorizons.has(horizon)) {
    throw new Error('Evaluation horizon must be 1, 5, or 20 trading days')
  }
  return horizon as EvaluationHorizonDays
}

function plannedExitSession(
  prediction: StoredPredictionForEvaluation,
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

async function loadLatestPriceObservation(
  client: SupabaseClient,
  priceInstrumentId: string,
  tradingDate: string,
  calculatedAt: string,
): Promise<StoredPriceObservation | null> {
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
  if (error) throw new Error(`Could not load evaluation price observation: ${error.message}`)
  return data as StoredPriceObservation | null
}

function observationReadyAfterClose(
  observation: StoredPriceObservation | null,
  sessionClose: string,
): boolean {
  return Boolean(observation && observation.fetched_at >= sessionClose)
}

export async function previewEvaluation(
  client: SupabaseClient,
  predictionId: string,
  horizonDays: EvaluationHorizonDays,
  now: () => Date = () => new Date(),
): Promise<EvaluationPreview> {
  const normalizedPredictionId = predictionId.trim()
  if (!normalizedPredictionId) throw new Error('Evaluation preview requires a prediction ID')
  const calculationTime = now()
  if (Number.isNaN(calculationTime.valueOf())) {
    throw new Error('Evaluation preview clock returned an invalid date')
  }
  const calculatedAt = calculationTime.toISOString()

  const { data: predictionData, error: predictionError } = await client
    .from(DatabaseTable.predictions)
    .select(
      'id,earnings_event_id,cutoff_at,snapshot_sha256,planned_entry_session,'
      + 'planned_day_1_session,planned_day_5_session,planned_day_20_session,'
      + 'entry_calendar_code,entry_calendar_version',
    )
    .eq('id', normalizedPredictionId)
    .single()
  if (predictionError) throw new Error(`Could not load evaluation prediction: ${predictionError.message}`)
  const prediction = predictionData as unknown as StoredPredictionForEvaluation
  const exitSession = plannedExitSession(prediction, horizonDays)

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
  if (eventError) throw new Error(`Could not load evaluation event: ${eventError.message}`)
  if (sessionError) throw new Error(`Could not load evaluation market sessions: ${sessionError.message}`)
  const event = eventData as unknown as StoredEarningsEventForEvaluation
  const company = singleRelation(event.companies)
  const sessions = (sessionData ?? []) as StoredMarketSessionForEvaluation[]
  const entryMarketSession = sessions.find(
    (session) => session.session_date === prediction.planned_entry_session,
  )
  const exitMarketSession = sessions.find((session) => session.session_date === exitSession)
  if (!entryMarketSession || !exitMarketSession) {
    throw new Error('Evaluation prediction references a missing market session')
  }
  const entryClosesAt = validTimestamp(entryMarketSession.closes_at, 'Entry session close')
  const exitClosesAt = validTimestamp(exitMarketSession.closes_at, 'Exit session close')

  const basePreview = {
    writesDatabase: false as const,
    predictionId: prediction.id,
    predictionSnapshotFingerprint: prediction.snapshot_sha256,
    ticker: company.ticker,
    horizonDays,
    methodologyVersion: RuleVersion.evaluationMethodology,
    calculatedAt,
    entrySession: prediction.planned_entry_session,
    exitSession,
  }
  if (calculatedAt < exitClosesAt) {
    return {
      ...basePreview,
      status: 'not_ready',
      reasons: [`The ${horizonDays}-day exit session has not closed yet`],
    }
  }

  const { data: existingEvaluation, error: existingEvaluationError } = await client
    .from(DatabaseTable.evaluations)
    .select('id')
    .eq('prediction_id', prediction.id)
    .eq('horizon_days', horizonDays)
    .eq('methodology_version', RuleVersion.evaluationMethodology)
    .limit(1)
    .maybeSingle()
  if (existingEvaluationError) {
    throw new Error(`Could not check for an existing evaluation: ${existingEvaluationError.message}`)
  }
  if (existingEvaluation) {
    return {
      ...basePreview,
      status: 'already_evaluated',
      reasons: [`Evaluation ${existingEvaluation.id} already exists for this methodology`],
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
      .lte('created_at', prediction.cutoff_at)
      .order('applicable_from', { ascending: false })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false }),
  ])
  if (instrumentError) throw new Error(`Could not load company price instrument: ${instrumentError.message}`)
  if (assignmentResult.error) {
    throw new Error(`Could not load evaluation benchmark assignments: ${assignmentResult.error.message}`)
  }
  const stockInstrument = instrumentData as StoredPriceInstrument
  const assignments = (assignmentResult.data ?? []) as StoredBenchmarkAssignment[]
  const marketAssignment = assignments.find(
    (assignment) => assignment.benchmark_role === BenchmarkRole.market,
  )
  const sectorAssignment = assignments.find(
    (assignment) => assignment.benchmark_role === BenchmarkRole.sector,
  )
  const reasons: string[] = []
  if (!marketAssignment) reasons.push('No market benchmark assignment existed at prediction time')
  if (!sectorAssignment) reasons.push('No sector benchmark assignment existed at prediction time')
  if (!marketAssignment || !sectorAssignment) {
    return { ...basePreview, status: 'not_ready', reasons }
  }

  const { data: benchmarkInstrumentData, error: benchmarkInstrumentError } = await client
    .from(DatabaseTable.priceInstruments)
    .select('id,symbol,instrument_type,provider_name,provider_symbol')
    .in('id', [marketAssignment.benchmark_instrument_id, sectorAssignment.benchmark_instrument_id])
  if (benchmarkInstrumentError) {
    throw new Error(`Could not load benchmark price instruments: ${benchmarkInstrumentError.message}`)
  }
  const benchmarkInstruments = (benchmarkInstrumentData ?? []) as StoredPriceInstrument[]
  const marketInstrument = benchmarkInstruments.find(
    (instrument) => instrument.id === marketAssignment.benchmark_instrument_id,
  )
  const sectorInstrument = benchmarkInstruments.find(
    (instrument) => instrument.id === sectorAssignment.benchmark_instrument_id,
  )
  if (!marketInstrument) reasons.push('Market benchmark price instrument is missing')
  if (!sectorInstrument) reasons.push('Sector benchmark price instrument is missing')
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
    loadLatestPriceObservation(client, stockInstrument.id, prediction.planned_entry_session, calculatedAt),
    loadLatestPriceObservation(client, stockInstrument.id, exitSession, calculatedAt),
    loadLatestPriceObservation(client, marketInstrument.id, prediction.planned_entry_session, calculatedAt),
    loadLatestPriceObservation(client, marketInstrument.id, exitSession, calculatedAt),
    loadLatestPriceObservation(client, sectorInstrument.id, prediction.planned_entry_session, calculatedAt),
    loadLatestPriceObservation(client, sectorInstrument.id, exitSession, calculatedAt),
  ])

  const requiredObservations = [
    ['stock entry', stockEntryObservation, entryClosesAt],
    ['stock exit', stockExitObservation, exitClosesAt],
    ['market entry', marketEntryObservation, entryClosesAt],
    ['market exit', marketExitObservation, exitClosesAt],
    ['sector entry', sectorEntryObservation, entryClosesAt],
    ['sector exit', sectorExitObservation, exitClosesAt],
  ] as const
  for (const [description, observation, sessionClose] of requiredObservations) {
    if (!observation) reasons.push(`The ${description} price observation is missing`)
    else if (!observationReadyAfterClose(observation, sessionClose)) {
      reasons.push(`The ${description} observation was fetched before its session closed`)
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
