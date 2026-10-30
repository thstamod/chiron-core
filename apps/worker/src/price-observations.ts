import { canonicalJson } from './canonical-json.js'
import { calculateContentSha256 } from './content-hash.js'
import type { TiingoDailyPrice } from './tiingo-price-client.js'
import type { PriceInstrumentTypeValue } from './constants.js'

export interface PriceInstrument {
  id: string
  companyId: string | null
  symbol: string
  instrumentType: PriceInstrumentTypeValue
  providerName: string
  providerSymbol: string
  currency: string
}

export interface DailyPriceObservation {
  priceInstrumentId: string
  providerName: string
  providerSymbol: string
  tradingDate: string
  openPrice: number
  highPrice: number
  lowPrice: number
  closePrice: number
  volume: number
  adjustedOpenPrice: number
  adjustedHighPrice: number
  adjustedLowPrice: number
  adjustedClosePrice: number
  adjustedVolume: number
  dividendCash: number
  splitFactor: number
  observationSha256: string
  fetchedAt: string
}

function observationFingerprint(
  instrument: PriceInstrument,
  price: TiingoDailyPrice,
): string {
  const fingerprintInput = canonicalJson({
    providerName: instrument.providerName,
    providerSymbol: instrument.providerSymbol,
    tradingDate: price.tradingDate,
    openPrice: price.openPrice,
    highPrice: price.highPrice,
    lowPrice: price.lowPrice,
    closePrice: price.closePrice,
    volume: price.volume,
    adjustedOpenPrice: price.adjustedOpenPrice,
    adjustedHighPrice: price.adjustedHighPrice,
    adjustedLowPrice: price.adjustedLowPrice,
    adjustedClosePrice: price.adjustedClosePrice,
    adjustedVolume: price.adjustedVolume,
    dividendCash: price.dividendCash,
    splitFactor: price.splitFactor,
  })
  return calculateContentSha256(new TextEncoder().encode(fingerprintInput))
}

export function createDailyPriceObservations(
  instrument: PriceInstrument,
  prices: TiingoDailyPrice[],
  fetchedAt: string,
): DailyPriceObservation[] {
  const parsedFetchedAt = new Date(fetchedAt)
  if (
    Number.isNaN(parsedFetchedAt.valueOf())
    || parsedFetchedAt.toISOString() !== fetchedAt
  ) {
    throw new Error(`Invalid daily price fetch timestamp: ${fetchedAt}`)
  }

  const observedDates = new Set<string>()
  return prices.map((price) => {
    if (observedDates.has(price.tradingDate)) {
      throw new Error(
        `Tiingo returned duplicate prices for ${instrument.providerSymbol} on ${price.tradingDate}`,
      )
    }
    observedDates.add(price.tradingDate)

    return {
      priceInstrumentId: instrument.id,
      providerName: instrument.providerName,
      providerSymbol: instrument.providerSymbol,
      ...price,
      observationSha256: observationFingerprint(instrument, price),
      fetchedAt,
    }
  })
}

export function selectChangedDailyPriceObservations(
  observations: DailyPriceObservation[],
  latestFingerprintByTradingDate: ReadonlyMap<string, string>,
): DailyPriceObservation[] {
  return observations.filter(
    (observation) => (
      latestFingerprintByTradingDate.get(observation.tradingDate)
      !== observation.observationSha256
    ),
  )
}
