import assert from 'node:assert/strict'
import test from 'node:test'
import { SecRequestClient } from './sec-request.js'

function controlledTime(): {
  now: () => number
  sleep: (milliseconds: number) => Promise<void>
  sleeps: number[]
} {
  let currentTime = 0
  const sleeps: number[] = []

  return {
    now: () => currentTime,
    sleep: async (milliseconds) => {
      sleeps.push(milliseconds)
      currentTime += milliseconds
    },
    sleeps,
  }
}

test('spaces every SEC request through one shared limiter', async () => {
  const time = controlledTime()
  const requestTimes: number[] = []
  const fetchImplementation: typeof fetch = async () => {
    requestTimes.push(time.now())
    return new Response('ok')
  }
  const client = new SecRequestClient({
    fetchImplementation,
    now: time.now,
    sleep: time.sleep,
    minimumIntervalMs: 200,
  })

  await Promise.all([
    client.fetch('https://www.sec.gov/first'),
    client.fetch('https://www.sec.gov/second'),
    client.fetch('https://www.sec.gov/third'),
  ])

  assert.deepEqual(requestTimes, [0, 200, 400])
})

test('retries a throttled SEC request using Retry-After', async () => {
  const time = controlledTime()
  let requestCount = 0
  const fetchImplementation: typeof fetch = async () => {
    requestCount += 1
    if (requestCount === 1) {
      return new Response('slow down', {
        status: 429,
        headers: { 'Retry-After': '2' },
      })
    }
    return new Response('ok')
  }
  const client = new SecRequestClient({
    fetchImplementation,
    now: time.now,
    sleep: time.sleep,
    minimumIntervalMs: 200,
  })

  const response = await client.fetch('https://www.sec.gov/throttled')

  assert.equal(response.status, 200)
  assert.equal(requestCount, 2)
  assert.ok(time.sleeps.includes(2_000))
})

test('does not retry a permanent SEC response', async () => {
  let requestCount = 0
  const fetchImplementation: typeof fetch = async () => {
    requestCount += 1
    return new Response('not found', { status: 404 })
  }
  const client = new SecRequestClient({ fetchImplementation })

  const response = await client.fetch('https://www.sec.gov/missing')

  assert.equal(response.status, 404)
  assert.equal(requestCount, 1)
})

test('fails after the configured number of temporary network errors', async () => {
  const time = controlledTime()
  let requestCount = 0
  const fetchImplementation: typeof fetch = async () => {
    requestCount += 1
    throw new Error('temporary network failure')
  }
  const client = new SecRequestClient({
    fetchImplementation,
    now: time.now,
    sleep: time.sleep,
    minimumIntervalMs: 200,
    maximumAttempts: 3,
  })

  await assert.rejects(
    client.fetch('https://www.sec.gov/unavailable'),
    /temporary network failure/,
  )
  assert.equal(requestCount, 3)
})
