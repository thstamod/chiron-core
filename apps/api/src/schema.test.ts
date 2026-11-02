import assert from 'node:assert/strict'
import test from 'node:test'
import { graphql } from 'graphql'
import { apiSchema } from './schema.js'
import type { ResearchRepository } from './types.js'

test('loads recent prediction events through the repository and caps the requested limit', async () => {
  let receivedLimit = 0
  const repository: ResearchRepository = {
    async getWatchlistCompanies() {
      return []
    },
    async getRecentPredictionEvents(limit) {
      receivedLimit = limit
      return []
    },
    async getRecentUnpredictedEvents() {
      return []
    },
    async getPredictionEvidence() {
      return null
    },
  }

  const result = await graphql({
    schema: apiSchema,
    source: 'query { recentPredictionEvents(limit: 500) { id } }',
    contextValue: { repository },
  })

  assert.equal(result.errors, undefined)
  assert.deepEqual(result.data?.recentPredictionEvents, [])
  assert.equal(receivedLimit, 100)
})

test('loads the watchlist and unpredicted events through explicit repository methods', async () => {
  let receivedUnpredictedLimit = 0
  const repository: ResearchRepository = {
    async getWatchlistCompanies() {
      return [{
        id: 'company-id',
        legalName: 'Example Company',
        ticker: 'EXAMPLE',
        exchange: 'NASDAQ',
        sector: 'Technology',
        isActive: true,
      }]
    },
    async getRecentPredictionEvents() {
      return []
    },
    async getRecentUnpredictedEvents(limit) {
      receivedUnpredictedLimit = limit
      return []
    },
    async getPredictionEvidence() {
      return null
    },
  }

  const result = await graphql({
    schema: apiSchema,
    source: `query {
      watchlistCompanies { ticker isActive }
      recentUnpredictedEvents(limit: 500) { id }
    }`,
    contextValue: { repository },
  })

  assert.equal(result.errors, undefined)
  const watchlistCompanies = result.data?.watchlistCompanies as Array<{
    ticker: string
    isActive: boolean
  }>
  assert.equal(watchlistCompanies.length, 1)
  assert.equal(watchlistCompanies[0]?.ticker, 'EXAMPLE')
  assert.equal(watchlistCompanies[0]?.isActive, true)
  assert.deepEqual(result.data?.recentUnpredictedEvents, [])
  assert.equal(receivedUnpredictedLimit, 100)
})
