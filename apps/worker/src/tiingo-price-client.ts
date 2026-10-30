import { z } from 'zod'
import {
  TiingoRequest,
  TiingoRequestPolicy,
  TiingoUrl,
} from './constants.js'

const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/
const providerSymbolPattern = /^[A-Za-z0-9.-]{1,20}$/
const tiingoTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/

const tiingoDailyPriceSchema = z.object({
  date: z.string().regex(tiingoTimestampPattern),
  open: z.number().finite().positive(),
  high: z.number().finite().positive(),
  low: z.number().finite().positive(),
  close: z.number().finite().positive(),
  volume: z.number().finite().nonnegative(),
  adjOpen: z.number().finite().positive(),
  adjHigh: z.number().finite().positive(),
  adjLow: z.number().finite().positive(),
  adjClose: z.number().finite().positive(),
  adjVolume: z.number().finite().nonnegative(),
  divCash: z.number().finite().nonnegative(),
  splitFactor: z.number().finite().positive(),
}).superRefine((price, context) => {
  if (price.high < Math.max(price.open, price.low, price.close)) {
    context.addIssue({
      code: 'custom',
      path: ['high'],
      message: 'Daily high must not be below the open, low, or close',
    })
  }
  if (price.low > Math.min(price.open, price.high, price.close)) {
    context.addIssue({
      code: 'custom',
      path: ['low'],
      message: 'Daily low must not be above the open, high, or close',
    })
  }
  if (price.adjHigh < Math.max(price.adjOpen, price.adjLow, price.adjClose)) {
    context.addIssue({
      code: 'custom',
      path: ['adjHigh'],
      message: 'Adjusted daily high must not be below the adjusted open, low, or close',
    })
  }
  if (price.adjLow > Math.min(price.adjOpen, price.adjHigh, price.adjClose)) {
    context.addIssue({
      code: 'custom',
      path: ['adjLow'],
      message: 'Adjusted daily low must not be above the adjusted open, high, or close',
    })
  }
})

const tiingoDailyPricesSchema = z.array(tiingoDailyPriceSchema)

export interface TiingoDailyPrice {
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
}

export interface TiingoDailyPriceRequest {
  providerSymbol: string
  startDate: string
  endDate: string
}

interface TiingoPriceClientOptions {
  apiToken: string
  fetchImplementation?: typeof fetch
  requestTimeoutMilliseconds?: number
}

function isRealCalendarDate(value: string): boolean {
  if (!dateOnlyPattern.test(value)) return false
  const parsedDate = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsedDate.valueOf())
    && parsedDate.toISOString().slice(0, 10) === value
}

function validateRequest(request: TiingoDailyPriceRequest): void {
  if (!providerSymbolPattern.test(request.providerSymbol)) {
    throw new Error(`Invalid Tiingo provider symbol: ${request.providerSymbol}`)
  }
  if (!isRealCalendarDate(request.startDate)) {
    throw new Error(`Invalid Tiingo start date: ${request.startDate}`)
  }
  if (!isRealCalendarDate(request.endDate)) {
    throw new Error(`Invalid Tiingo end date: ${request.endDate}`)
  }
  if (request.startDate > request.endDate) {
    throw new Error('Tiingo start date must not be after the end date')
  }
}

export function buildTiingoDailyPricesUrl(request: TiingoDailyPriceRequest): URL {
  validateRequest(request)
  const encodedSymbol = encodeURIComponent(request.providerSymbol)
  const url = new URL(
    `${TiingoUrl.dailyPricesBase}/${encodedSymbol}/${TiingoRequest.pricesPath}`,
  )
  url.searchParams.set(TiingoRequest.startDateParameter, request.startDate)
  url.searchParams.set(TiingoRequest.endDateParameter, request.endDate)
  url.searchParams.set(
    TiingoRequest.responseFormatParameter,
    TiingoRequest.jsonResponseFormat,
  )
  return url
}

function toDailyPrice(providerPrice: z.infer<typeof tiingoDailyPriceSchema>): TiingoDailyPrice {
  return {
    tradingDate: providerPrice.date.slice(0, 10),
    openPrice: providerPrice.open,
    highPrice: providerPrice.high,
    lowPrice: providerPrice.low,
    closePrice: providerPrice.close,
    volume: providerPrice.volume,
    adjustedOpenPrice: providerPrice.adjOpen,
    adjustedHighPrice: providerPrice.adjHigh,
    adjustedLowPrice: providerPrice.adjLow,
    adjustedClosePrice: providerPrice.adjClose,
    adjustedVolume: providerPrice.adjVolume,
    dividendCash: providerPrice.divCash,
    splitFactor: providerPrice.splitFactor,
  }
}

export class TiingoPriceClient {
  private readonly apiToken: string
  private readonly fetchImplementation: typeof fetch
  private readonly requestTimeoutMilliseconds: number

  constructor(options: TiingoPriceClientOptions) {
    const apiToken = options.apiToken.trim()
    if (!apiToken) throw new Error('Tiingo API token must not be empty')

    this.apiToken = apiToken
    this.fetchImplementation = options.fetchImplementation ?? globalThis.fetch
    this.requestTimeoutMilliseconds = options.requestTimeoutMilliseconds
      ?? TiingoRequestPolicy.requestTimeoutMilliseconds
  }

  async fetchDailyPrices(request: TiingoDailyPriceRequest): Promise<TiingoDailyPrice[]> {
    const url = buildTiingoDailyPricesUrl(request)
    const response = await this.fetchImplementation(url, {
      headers: {
        [TiingoRequest.acceptHeader]: TiingoRequest.accept,
        [TiingoRequest.authorizationHeader]: (
          `${TiingoRequest.authorizationScheme} ${this.apiToken}`
        ),
      },
      signal: AbortSignal.timeout(this.requestTimeoutMilliseconds),
    })

    if (!response.ok) {
      await response.body?.cancel()
      throw new Error(`Tiingo price request failed with HTTP ${response.status}`)
    }

    let providerResponse: unknown
    try {
      providerResponse = await response.json()
    } catch {
      throw new Error('Tiingo price response was not valid JSON')
    }

    const parsedResponse = tiingoDailyPricesSchema.safeParse(providerResponse)
    if (!parsedResponse.success) {
      const invalidPaths = parsedResponse.error.issues
        .map((issue) => issue.path.join('.') || 'response')
        .join(', ')
      throw new Error(`Tiingo price response failed validation at: ${invalidPaths}`)
    }

    const dailyPrices = parsedResponse.data.map(toDailyPrice)
    const outsideRequestedRange = dailyPrices.find(
      ({ tradingDate }) => (
        tradingDate < request.startDate || tradingDate > request.endDate
      ),
    )
    if (outsideRequestedRange) {
      throw new Error(
        `Tiingo returned ${outsideRequestedRange.tradingDate} outside the requested date range`,
      )
    }

    return dailyPrices
  }
}
