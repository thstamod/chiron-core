import {
  PriceDataProvider,
  PriceSyncPolicy,
} from './constants.js'
import {
  createDailyPriceObservations,
  type DailyPriceObservation,
  type PriceInstrument,
} from './price-observations.js'
import type {
  TiingoDailyPrice,
  TiingoDailyPriceRequest,
} from './tiingo-price-client.js'

export interface DailyPriceSyncInstrumentResult {
  symbol: string
  startDate: string
  endDate: string
  pricesReceived: number
  observationsInserted: number
}

export interface DailyPriceSyncSummary extends Record<string, unknown> {
  providerName: typeof PriceDataProvider.tiingo
  instrumentsChecked: number
  requestsMade: number
  initialBackfills: number
  pricesReceived: number
  observationsInserted: number
  endDate: string
  overlapCalendarDays: number
  initialLookbackCalendarDays: number
}

interface DailyPriceSyncDependencies {
  loadActiveInstruments(providerName: string): Promise<PriceInstrument[]>
  loadLatestTradingDate(priceInstrumentId: string): Promise<string | null>
  fetchDailyPrices(request: TiingoDailyPriceRequest): Promise<TiingoDailyPrice[]>
  saveChangedObservations(observations: DailyPriceObservation[]): Promise<number>
  now?: () => Date
  onInstrumentCompleted?: (result: DailyPriceSyncInstrumentResult) => void
}

function dateOnly(date: Date): string {
  if (Number.isNaN(date.valueOf())) throw new Error('Price sync clock returned an invalid date')
  return date.toISOString().slice(0, 10)
}

export function subtractCalendarDays(date: string, calendarDays: number): string {
  if (!Number.isInteger(calendarDays) || calendarDays < 0) {
    throw new Error('Calendar days must be a non-negative integer')
  }
  const parsedDate = new Date(`${date}T00:00:00.000Z`)
  if (Number.isNaN(parsedDate.valueOf()) || dateOnly(parsedDate) !== date) {
    throw new Error(`Invalid calendar date: ${date}`)
  }
  parsedDate.setUTCDate(parsedDate.getUTCDate() - calendarDays)
  return dateOnly(parsedDate)
}

export function dailyPriceRequestStartDate(
  latestTradingDate: string | null,
  endDate: string,
): string {
  if (latestTradingDate && latestTradingDate > endDate) {
    throw new Error(
      `Latest stored trading date ${latestTradingDate} is after sync end date ${endDate}`,
    )
  }
  return subtractCalendarDays(
    latestTradingDate ?? endDate,
    latestTradingDate
      ? PriceSyncPolicy.overlapCalendarDays
      : PriceSyncPolicy.initialLookbackCalendarDays,
  )
}

export async function syncTiingoDailyPrices(
  dependencies: DailyPriceSyncDependencies,
): Promise<DailyPriceSyncSummary> {
  const now = dependencies.now ?? (() => new Date())
  const endDate = dateOnly(now())
  const instruments = await dependencies.loadActiveInstruments(PriceDataProvider.tiingo)
  let requestsMade = 0
  let initialBackfills = 0
  let pricesReceived = 0
  let observationsInserted = 0

  for (const instrument of instruments) {
    const latestTradingDate = await dependencies.loadLatestTradingDate(instrument.id)
    if (!latestTradingDate) initialBackfills += 1
    const startDate = dailyPriceRequestStartDate(latestTradingDate, endDate)
    const prices = await dependencies.fetchDailyPrices({
      providerSymbol: instrument.providerSymbol,
      startDate,
      endDate,
    })
    requestsMade += 1
    pricesReceived += prices.length

    const observations = createDailyPriceObservations(
      instrument,
      prices,
      now().toISOString(),
    )
    const inserted = observations.length > 0
      ? await dependencies.saveChangedObservations(observations)
      : 0
    observationsInserted += inserted
    dependencies.onInstrumentCompleted?.({
      symbol: instrument.symbol,
      startDate,
      endDate,
      pricesReceived: prices.length,
      observationsInserted: inserted,
    })
  }

  return {
    providerName: PriceDataProvider.tiingo,
    instrumentsChecked: instruments.length,
    requestsMade,
    initialBackfills,
    pricesReceived,
    observationsInserted,
    endDate,
    overlapCalendarDays: PriceSyncPolicy.overlapCalendarDays,
    initialLookbackCalendarDays: PriceSyncPolicy.initialLookbackCalendarDays,
  }
}
