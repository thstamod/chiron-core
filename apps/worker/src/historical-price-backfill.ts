import type { SupabaseClient } from '@supabase/supabase-js'
import {
  BenchmarkRole,
  type BenchmarkRoleValue,
  DatabaseTable,
  PriceDataProvider,
  PriceInstrumentType,
} from './constants.js'
import {
  createDailyPriceObservations,
  type PriceInstrument,
} from './price-observations.js'
import type {
  TiingoDailyPrice,
  TiingoDailyPriceRequest,
} from './tiingo-price-client.js'
import { subtractCalendarDays } from './price-sync.js'

interface HistoricalPredictionForPriceBackfill {
  id: string
  earnings_event_id: string
  planned_entry_session: string
  planned_day_1_session: string
  planned_day_5_session: string
  planned_day_20_session: string
  entry_calendar_code: string
  entry_calendar_version: string
}

interface HistoricalPriceBackfillEvent {
  company_id: string
  companies: { ticker: string } | Array<{ ticker: string }>
}

interface HistoricalPriceBackfillSession {
  session_date: string
  closes_at: string
}

interface HistoricalPriceBackfillAssignment {
  benchmark_instrument_id: string
  benchmark_role: BenchmarkRoleValue
}

interface HistoricalPriceBackfillObservation {
  price_instrument_id: string
  trading_date: string
  fetched_at: string
  created_at: string
}

interface StoredPriceInstrumentForBackfill {
  id: string
  company_id: string | null
  symbol: string
  instrument_type: PriceInstrument['instrumentType']
  provider_name: string
  provider_symbol: string
  currency: string
}

export interface HistoricalPriceBackfillRequest {
  instrument: PriceInstrument
  requiredDates: string[]
  startDate: string
  endDate: string
}

export interface HistoricalPriceBackfillPreview extends Record<string, unknown> {
  writesDatabase: false
  status: 'ready' | 'nothing_to_backfill'
  historicalPredictionId: string
  ticker: string
  checkedAt: string
  closedFrozenSessions: string[]
  futureFrozenSessions: string[]
  requests: HistoricalPriceBackfillRequest[]
}

export interface HistoricalPriceBackfillSummary extends Record<string, unknown> {
  writesDatabase: true
  historicalPredictionId: string
  ticker: string
  checkedAt: string
  requestsMade: number
  pricesReceived: number
  observationsInserted: number
  requestResults: Array<{
    symbol: string
    startDate: string
    endDate: string
    requiredDates: string[]
    pricesReceived: number
    observationsInserted: number
  }>
}

interface HistoricalPriceBackfillDependencies {
  fetchDailyPrices(request: TiingoDailyPriceRequest): Promise<TiingoDailyPrice[]>
  saveChangedObservations(
    observations: ReturnType<typeof createDailyPriceObservations>,
  ): Promise<number>
  now?: () => Date
}

function singleTicker(
  companies: HistoricalPriceBackfillEvent['companies'],
): string {
  const company = Array.isArray(companies) ? companies[0] : companies
  if (!company) throw new Error('Historical price backfill event has no related company')
  return company.ticker
}

function validDate(value: string, description: string): Date {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.valueOf())) throw new Error(`${description} is not a valid timestamp`)
  return parsed
}

function toPriceInstrument(row: StoredPriceInstrumentForBackfill): PriceInstrument {
  return {
    id: row.id,
    companyId: row.company_id,
    symbol: row.symbol,
    instrumentType: row.instrument_type,
    providerName: row.provider_name,
    providerSymbol: row.provider_symbol,
    currency: row.currency,
  }
}

export function selectMissingHistoricalPriceDates(input: {
  sessions: HistoricalPriceBackfillSession[]
  observations: HistoricalPriceBackfillObservation[]
  checkedAt: string
}): { closedDates: string[]; futureDates: string[]; missingDates: string[] } {
  const checkedAt = validDate(input.checkedAt, 'Historical price backfill time')
  const closedDates: string[] = []
  const futureDates: string[] = []
  const sessionCloseByDate = new Map<string, Date>()
  for (const session of input.sessions) {
    const closesAt = validDate(session.closes_at, `Market close for ${session.session_date}`)
    sessionCloseByDate.set(session.session_date, closesAt)
    if (closesAt <= checkedAt) closedDates.push(session.session_date)
    else futureDates.push(session.session_date)
  }

  const latestObservationByDate = new Map<string, HistoricalPriceBackfillObservation>()
  for (const observation of input.observations) {
    const existing = latestObservationByDate.get(observation.trading_date)
    const observationFetchedAt = validDate(
      observation.fetched_at,
      `Price fetch time for ${observation.trading_date}`,
    )
    const existingFetchedAt = existing
      ? validDate(existing.fetched_at, `Price fetch time for ${existing.trading_date}`)
      : null
    if (!existingFetchedAt || observationFetchedAt > existingFetchedAt) {
      latestObservationByDate.set(observation.trading_date, observation)
    }
  }
  const missingDates = closedDates.filter((sessionDate) => {
    const observation = latestObservationByDate.get(sessionDate)
    if (!observation) return true
    const sessionClose = sessionCloseByDate.get(sessionDate)!
    return validDate(
      observation.fetched_at,
      `Price fetch time for ${sessionDate}`,
    ) < sessionClose
  })
  return { closedDates, futureDates, missingDates }
}

export function historicalPriceBackfillRequestRange(
  missingDates: string[],
  latestAllowedRequestDate: string,
): { startDate: string; endDate: string } {
  if (missingDates.length === 0) {
    throw new Error('Historical price backfill request requires at least one missing date')
  }
  const firstMissingDate = missingDates[0]!
  const lastMissingDate = missingDates.at(-1)!
  const followingDate = new Date(`${lastMissingDate}T00:00:00.000Z`)
  followingDate.setUTCDate(followingDate.getUTCDate() + 1)
  const followingDateOnly = followingDate.toISOString().slice(0, 10)
  const canUseFollowingDate = followingDateOnly <= latestAllowedRequestDate
  if (firstMissingDate !== lastMissingDate) {
    return { startDate: firstMissingDate, endDate: lastMissingDate }
  }
  if (canUseFollowingDate) {
    return { startDate: firstMissingDate, endDate: followingDateOnly }
  }
  return {
    startDate: subtractCalendarDays(firstMissingDate, 1),
    endDate: lastMissingDate,
  }
}

async function loadHistoricalPriceBackfillInstruments(
  client: SupabaseClient,
  companyId: string,
  entrySession: string,
  checkedAt: string,
): Promise<PriceInstrument[]> {
  const [{ data: stockData, error: stockError }, { data: assignmentData, error: assignmentError }] = (
    await Promise.all([
      client
        .from(DatabaseTable.priceInstruments)
        .select(
          'id,company_id,symbol,instrument_type,provider_name,provider_symbol,currency',
        )
        .eq('company_id', companyId)
        .eq('instrument_type', PriceInstrumentType.companyStock)
        .eq('provider_name', PriceDataProvider.tiingo)
        .single(),
      client
        .from(DatabaseTable.companyBenchmarkAssignments)
        .select('benchmark_instrument_id,benchmark_role,applicable_from,created_at')
        .eq('company_id', companyId)
        .lte('applicable_from', entrySession)
        .lte('created_at', checkedAt)
        .order('applicable_from', { ascending: false })
        .order('created_at', { ascending: false })
        .order('id', { ascending: false }),
    ])
  )
  if (stockError) throw new Error(`Could not load historical stock instrument: ${stockError.message}`)
  if (assignmentError) {
    throw new Error(`Could not load historical benchmark mappings: ${assignmentError.message}`)
  }
  const assignments = (assignmentData ?? []) as HistoricalPriceBackfillAssignment[]
  const marketAssignment = assignments.find(
    (assignment) => assignment.benchmark_role === BenchmarkRole.market,
  )
  const sectorAssignment = assignments.find(
    (assignment) => assignment.benchmark_role === BenchmarkRole.sector,
  )
  if (!marketAssignment || !sectorAssignment) {
    throw new Error('Historical price backfill requires market and sector benchmark mappings')
  }
  const { data: benchmarkData, error: benchmarkError } = await client
    .from(DatabaseTable.priceInstruments)
    .select('id,company_id,symbol,instrument_type,provider_name,provider_symbol,currency')
    .in('id', [marketAssignment.benchmark_instrument_id, sectorAssignment.benchmark_instrument_id])
    .eq('provider_name', PriceDataProvider.tiingo)
  if (benchmarkError) {
    throw new Error(`Could not load historical benchmark instruments: ${benchmarkError.message}`)
  }
  const benchmarkInstruments = (
    (benchmarkData ?? []) as StoredPriceInstrumentForBackfill[]
  ).map(toPriceInstrument)
  if (benchmarkInstruments.length !== 2) {
    throw new Error('Historical price backfill requires two Tiingo benchmark instruments')
  }
  return [
    toPriceInstrument(stockData as unknown as StoredPriceInstrumentForBackfill),
    ...benchmarkInstruments,
  ]
}

export async function previewHistoricalPriceBackfill(
  client: SupabaseClient,
  historicalPredictionId: string,
  now: () => Date = () => new Date(),
): Promise<HistoricalPriceBackfillPreview> {
  const normalizedPredictionId = historicalPredictionId.trim()
  if (!normalizedPredictionId) {
    throw new Error('Historical price backfill preview requires a prediction ID')
  }
  const checkedAtDate = now()
  if (Number.isNaN(checkedAtDate.valueOf())) {
    throw new Error('Historical price backfill clock returned an invalid date')
  }
  const checkedAt = checkedAtDate.toISOString()
  const { data: predictionData, error: predictionError } = await client
    .from(DatabaseTable.historicalPredictions)
    .select(
      'id,earnings_event_id,planned_entry_session,planned_day_1_session,'
      + 'planned_day_5_session,planned_day_20_session,entry_calendar_code,'
      + 'entry_calendar_version',
    )
    .eq('id', normalizedPredictionId)
    .single()
  if (predictionError) {
    throw new Error(`Could not load historical price backfill prediction: ${predictionError.message}`)
  }
  const prediction = predictionData as unknown as HistoricalPredictionForPriceBackfill
  const frozenSessionDates = [...new Set([
    prediction.planned_entry_session,
    prediction.planned_day_1_session,
    prediction.planned_day_5_session,
    prediction.planned_day_20_session,
  ])]
  const [{ data: eventData, error: eventError }, { data: sessionData, error: sessionError }] = (
    await Promise.all([
      client
        .from(DatabaseTable.earningsEvents)
        .select('company_id,companies!inner(ticker)')
        .eq('id', prediction.earnings_event_id)
        .single(),
      client
        .from(DatabaseTable.marketSessions)
        .select('session_date,closes_at')
        .eq('calendar_code', prediction.entry_calendar_code)
        .eq('calendar_version', prediction.entry_calendar_version)
        .in('session_date', frozenSessionDates)
        .order('session_date'),
    ])
  )
  if (eventError) throw new Error(`Could not load historical price backfill event: ${eventError.message}`)
  if (sessionError) {
    throw new Error(`Could not load historical price backfill sessions: ${sessionError.message}`)
  }
  const sessions = (sessionData ?? []) as HistoricalPriceBackfillSession[]
  if (sessions.length !== frozenSessionDates.length) {
    throw new Error('Historical price backfill prediction references a missing market session')
  }
  const event = eventData as unknown as HistoricalPriceBackfillEvent
  const instruments = await loadHistoricalPriceBackfillInstruments(
    client,
    event.company_id,
    prediction.planned_entry_session,
    checkedAt,
  )
  const closedAndFuture = selectMissingHistoricalPriceDates({
    sessions,
    observations: [],
    checkedAt,
  })
  const requests: HistoricalPriceBackfillRequest[] = []
  for (const instrument of instruments) {
    const { data: observationData, error: observationError } = await client
      .from(DatabaseTable.dailyPriceObservations)
      .select('price_instrument_id,trading_date,fetched_at,created_at')
      .eq('price_instrument_id', instrument.id)
      .in('trading_date', closedAndFuture.closedDates)
      .lte('fetched_at', checkedAt)
      .lte('created_at', checkedAt)
      .order('fetched_at', { ascending: false })
    if (observationError) {
      throw new Error(`Could not inspect historical prices for ${instrument.symbol}: ${observationError.message}`)
    }
    const { missingDates } = selectMissingHistoricalPriceDates({
      sessions: sessions.filter(
        (session) => closedAndFuture.closedDates.includes(session.session_date),
      ),
      observations: (observationData ?? []) as HistoricalPriceBackfillObservation[],
      checkedAt,
    })
    if (missingDates.length > 0) {
      const requestRange = historicalPriceBackfillRequestRange(
        missingDates,
        checkedAt.slice(0, 10),
      )
      requests.push({
        instrument,
        requiredDates: missingDates,
        ...requestRange,
      })
    }
  }
  return {
    writesDatabase: false,
    status: requests.length > 0 ? 'ready' : 'nothing_to_backfill',
    historicalPredictionId: prediction.id,
    ticker: singleTicker(event.companies),
    checkedAt,
    closedFrozenSessions: closedAndFuture.closedDates,
    futureFrozenSessions: closedAndFuture.futureDates,
    requests,
  }
}

export async function backfillHistoricalPrices(
  client: SupabaseClient,
  historicalPredictionId: string,
  dependencies: HistoricalPriceBackfillDependencies,
): Promise<HistoricalPriceBackfillSummary> {
  const now = dependencies.now ?? (() => new Date())
  const preview = await previewHistoricalPriceBackfill(client, historicalPredictionId, now)
  let pricesReceived = 0
  let observationsInserted = 0
  const requestResults: HistoricalPriceBackfillSummary['requestResults'] = []
  for (const request of preview.requests) {
    const prices = await dependencies.fetchDailyPrices({
      providerSymbol: request.instrument.providerSymbol,
      startDate: request.startDate,
      endDate: request.endDate,
    })
    const returnedDates = new Set(prices.map((price) => price.tradingDate))
    const missingRequiredDate = request.requiredDates.find((date) => !returnedDates.has(date))
    if (missingRequiredDate) {
      throw new Error(
        `Tiingo did not return required ${request.instrument.symbol} price for ${missingRequiredDate}`,
      )
    }
    const observations = createDailyPriceObservations(
      request.instrument,
      prices,
      now().toISOString(),
    )
    const inserted = await dependencies.saveChangedObservations(observations)
    pricesReceived += prices.length
    observationsInserted += inserted
    requestResults.push({
      symbol: request.instrument.symbol,
      startDate: request.startDate,
      endDate: request.endDate,
      requiredDates: request.requiredDates,
      pricesReceived: prices.length,
      observationsInserted: inserted,
    })
  }
  return {
    writesDatabase: true,
    historicalPredictionId: preview.historicalPredictionId,
    ticker: preview.ticker,
    checkedAt: preview.checkedAt,
    requestsMade: preview.requests.length,
    pricesReceived,
    observationsInserted,
    requestResults,
  }
}
