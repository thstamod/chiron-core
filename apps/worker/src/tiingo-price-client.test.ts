import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildTiingoDailyPricesUrl,
  TiingoPriceClient,
} from './tiingo-price-client.js'

const validProviderResponse = [{
  date: '2026-10-28T00:00:00.000Z',
  open: 268.99,
  high: 272.86,
  low: 267.62,
  close: 269.7,
  volume: 51_234_567,
  adjOpen: 268.99,
  adjHigh: 272.86,
  adjLow: 267.62,
  adjClose: 269.7,
  adjVolume: 51_234_567,
  divCash: 0,
  splitFactor: 1,
}]

test('builds a Tiingo daily-price URL from validated request values', () => {
  const url = buildTiingoDailyPricesUrl({
    providerSymbol: 'AAPL',
    startDate: '2026-10-27',
    endDate: '2026-10-28',
  })

  assert.equal(url.pathname, '/tiingo/daily/AAPL/prices')
  assert.equal(url.searchParams.get('startDate'), '2026-10-27')
  assert.equal(url.searchParams.get('endDate'), '2026-10-28')
  assert.equal(url.searchParams.get('format'), 'json')
})

test('sends the token only in the authorization header and maps validated prices', async () => {
  let requestedUrl = ''
  let authorizationHeader: string | null = null
  const fetchImplementation: typeof fetch = async (input, init) => {
    requestedUrl = input.toString()
    authorizationHeader = new Headers(init?.headers).get('Authorization')
    return Response.json(validProviderResponse)
  }
  const client = new TiingoPriceClient({
    apiToken: 'private-test-token',
    fetchImplementation,
  })

  const result = await client.fetchDailyPrices({
    providerSymbol: 'AAPL',
    startDate: '2026-10-28',
    endDate: '2026-10-28',
  })

  assert.equal(authorizationHeader, 'Token private-test-token')
  assert.equal(requestedUrl.includes('private-test-token'), false)
  assert.deepEqual(result, [{
    tradingDate: '2026-10-28',
    openPrice: 268.99,
    highPrice: 272.86,
    lowPrice: 267.62,
    closePrice: 269.7,
    volume: 51_234_567,
    adjustedOpenPrice: 268.99,
    adjustedHighPrice: 272.86,
    adjustedLowPrice: 267.62,
    adjustedClosePrice: 269.7,
    adjustedVolume: 51_234_567,
    dividendCash: 0,
    splitFactor: 1,
  }])
})

test('rejects invalid request dates before making a provider request', async () => {
  let requestCount = 0
  const fetchImplementation: typeof fetch = async () => {
    requestCount += 1
    return Response.json(validProviderResponse)
  }
  const client = new TiingoPriceClient({ apiToken: 'test-token', fetchImplementation })

  await assert.rejects(
    client.fetchDailyPrices({
      providerSymbol: 'AAPL',
      startDate: '2026-10-32',
      endDate: '2026-11-01',
    }),
    /Invalid Tiingo start date/,
  )
  assert.equal(requestCount, 0)
})

test('rejects a provider response with a missing required value', async () => {
  const { adjClose: _removedValue, ...incompletePrice } = validProviderResponse[0]!
  const fetchImplementation: typeof fetch = async () => Response.json([incompletePrice])
  const client = new TiingoPriceClient({ apiToken: 'test-token', fetchImplementation })

  await assert.rejects(
    client.fetchDailyPrices({
      providerSymbol: 'AAPL',
      startDate: '2026-10-28',
      endDate: '2026-10-28',
    }),
    /failed validation at: 0\.adjClose/,
  )
})

test('ignores a new provider field while preserving required validated values', async () => {
  const expandedProviderPrice = {
    ...validProviderResponse[0]!,
    futureProviderField: 'new metadata',
  }
  const fetchImplementation: typeof fetch = async () => Response.json([expandedProviderPrice])
  const client = new TiingoPriceClient({ apiToken: 'test-token', fetchImplementation })

  const result = await client.fetchDailyPrices({
    providerSymbol: 'AAPL',
    startDate: '2026-10-28',
    endDate: '2026-10-28',
  })

  assert.equal(result[0]?.adjustedClosePrice, 269.7)
  assert.equal('futureProviderField' in result[0]!, false)
})

test('rejects raw prices outside the reported daily low and high', async () => {
  const inconsistentProviderPrice = {
    ...validProviderResponse[0]!,
    high: 269,
    close: 269.7,
  }
  const fetchImplementation: typeof fetch = async () => Response.json([
    inconsistentProviderPrice,
  ])
  const client = new TiingoPriceClient({ apiToken: 'test-token', fetchImplementation })

  await assert.rejects(
    client.fetchDailyPrices({
      providerSymbol: 'AAPL',
      startDate: '2026-10-28',
      endDate: '2026-10-28',
    }),
    /failed validation at: 0\.high/,
  )
})

test('rejects adjusted prices outside the adjusted daily low and high', async () => {
  const inconsistentProviderPrice = {
    ...validProviderResponse[0]!,
    adjLow: 270,
    adjOpen: 268.99,
  }
  const fetchImplementation: typeof fetch = async () => Response.json([
    inconsistentProviderPrice,
  ])
  const client = new TiingoPriceClient({ apiToken: 'test-token', fetchImplementation })

  await assert.rejects(
    client.fetchDailyPrices({
      providerSymbol: 'AAPL',
      startDate: '2026-10-28',
      endDate: '2026-10-28',
    }),
    /failed validation at: 0\.adjLow/,
  )
})

test('rejects a successful response containing a date outside the requested range', async () => {
  const fetchImplementation: typeof fetch = async () => Response.json(validProviderResponse)
  const client = new TiingoPriceClient({ apiToken: 'test-token', fetchImplementation })

  await assert.rejects(
    client.fetchDailyPrices({
      providerSymbol: 'AAPL',
      startDate: '2026-10-27',
      endDate: '2026-10-27',
    }),
    /outside the requested date range/,
  )
})

test('does not automatically retry an unsuccessful provider response', async () => {
  let requestCount = 0
  const fetchImplementation: typeof fetch = async () => {
    requestCount += 1
    return new Response(null, { status: 429 })
  }
  const client = new TiingoPriceClient({ apiToken: 'test-token', fetchImplementation })

  await assert.rejects(
    client.fetchDailyPrices({
      providerSymbol: 'AAPL',
      startDate: '2026-10-28',
      endDate: '2026-10-28',
    }),
    /HTTP 429/,
  )
  assert.equal(requestCount, 1)
})
