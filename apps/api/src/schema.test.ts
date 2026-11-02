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
    async getEventDetails() {
      return null
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
  let receivedEventId = ''
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
    async getEventDetails(eventId) {
      receivedEventId = eventId
      return {
        eventId,
        documents: [],
        reportedMetrics: [],
        derivedMetrics: [{
          id: 'metric-id',
          metricCode: 'net_margin_percent',
          value: '10.25',
          unit: 'percent',
          calculationExpression: '(current_net_income / current_revenue) * 100',
          calculationVersion: 'financial-derived-metrics-v1',
          createdAt: '2026-10-30T12:05:00.000Z',
        }],
      }
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
      earningsEventDetails(eventId: "event-id") {
        eventId
        derivedMetrics { metricCode value }
      }
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
  assert.equal(receivedEventId, 'event-id')
  const eventDetails = result.data?.earningsEventDetails as {
    eventId: string
    derivedMetrics: Array<{ metricCode: string; value: string }>
  }
  assert.equal(eventDetails.eventId, 'event-id')
  assert.equal(eventDetails.derivedMetrics[0]?.metricCode, 'net_margin_percent')
  assert.equal(eventDetails.derivedMetrics[0]?.value, '10.25')
})

test('exposes the frozen qualitative extraction audit through prediction evidence', async () => {
  const repository: ResearchRepository = {
    async getWatchlistCompanies() { return [] },
    async getRecentPredictionEvents() { return [] },
    async getRecentUnpredictedEvents() { return [] },
    async getEventDetails() { return null },
    async getPredictionEvidence(predictionId) {
      return {
        predictionId,
        extractionSchemaVersion: 'qualitative-earnings-v4',
        evidence: [],
        extractionAudit: {
          promptVersion: 'baseline-v6',
          requestedModelName: 'gpt-test',
          resolvedModelName: 'gpt-test-resolved',
          providerName: 'openai',
          inputSelectionVersion: 'qualitative-input-selection-v1',
          finishedAt: '2026-10-30T17:01:00.000Z',
          tokenUsageJson: '{"inputTokens":100}',
          validationStatus: 'valid',
          originalSchemaVersion: 'qualitative-earnings-v4',
          originalOutputFingerprint: 'a'.repeat(64),
          originalOutputJson: '{"summary":"original"}',
          reviewDecision: 'corrected',
          reviewerLabel: 'owner',
          reviewNotes: 'Corrected one risk.',
          reviewVersion: 'manual-qualitative-review-v1',
          reviewedAt: '2026-10-30T17:30:00.000Z',
          effectiveSource: 'corrected_review',
          effectiveSchemaVersion: 'qualitative-earnings-v4',
          effectiveOutputFingerprint: 'b'.repeat(64),
          effectiveOutputJson: '{"summary":"corrected"}',
        },
      }
    },
  }

  const result = await graphql({
    schema: apiSchema,
    source: `query {
      predictionEvidence(predictionId: "2a545c05-ef0e-43ea-88a1-1ab0f610a7e9") {
        extractionAudit {
          validationStatus
          reviewDecision
          originalOutputJson
          effectiveOutputJson
        }
      }
    }`,
    contextValue: { repository },
  })

  assert.equal(result.errors, undefined)
  const predictionEvidence = result.data?.predictionEvidence as {
    extractionAudit: Record<string, string>
  }
  assert.equal(predictionEvidence.extractionAudit.validationStatus, 'valid')
  assert.equal(predictionEvidence.extractionAudit.reviewDecision, 'corrected')
  assert.equal(predictionEvidence.extractionAudit.originalOutputJson, '{"summary":"original"}')
  assert.equal(predictionEvidence.extractionAudit.effectiveOutputJson, '{"summary":"corrected"}')
})
