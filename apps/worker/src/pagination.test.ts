import assert from 'node:assert/strict'
import test from 'node:test'
import { fetchAllPages } from './pagination.js'

test('loads every database page until the final partial page', async () => {
  const source = ['a', 'b', 'c', 'd', 'e']
  const requestedRanges: Array<[number, number]> = []

  const rows = await fetchAllPages(
    async (from, to) => {
      requestedRanges.push([from, to])
      return { data: source.slice(from, to + 1), error: null }
    },
    'Could not load test rows',
    2,
  )

  assert.deepEqual(rows, source)
  assert.deepEqual(requestedRanges, [[0, 1], [2, 3], [4, 5]])
})

test('reports a database error from a later page', async () => {
  await assert.rejects(
    fetchAllPages(
      async (from) => from === 0
        ? { data: ['a', 'b'], error: null }
        : { data: null, error: { message: 'database unavailable' } },
      'Could not load test rows',
      2,
    ),
    /Could not load test rows: database unavailable/,
  )
})
