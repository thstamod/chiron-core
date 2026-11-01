import assert from 'node:assert/strict'
import test from 'node:test'
import { graphql } from 'graphql'
import { apiSchema } from './schema.js'
import type { ResearchRepository } from './types.js'

test('loads recent prediction events through the repository and caps the requested limit', async () => {
  let receivedLimit = 0
  const repository: ResearchRepository = {
    async getRecentPredictionEvents(limit) {
      receivedLimit = limit
      return []
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
