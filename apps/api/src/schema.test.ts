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
    async getHistoricalPredictionResults() {
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
    async getHistoricalPredictionResults() {
      return []
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
    async getHistoricalPredictionResults() {
      return []
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

test('keeps retrospective historical outcomes separate and caps their query limit', async () => {
  let receivedHistoricalLimit = 0
  const repository: ResearchRepository = {
    async getWatchlistCompanies() { return [] },
    async getRecentPredictionEvents() { return [] },
    async getRecentUnpredictedEvents() { return [] },
    async getEventDetails() { return null },
    async getPredictionEvidence() { return null },
    async getHistoricalPredictionResults(limit) {
      receivedHistoricalLimit = limit
      return [{
        predictionId: 'historical-prediction-id',
        eventId: 'event-id',
        companyName: 'Example Company',
        ticker: 'EXAMPLE',
        sector: 'Technology',
        periodEnd: '2026-09-30',
        score: 2,
        ruleVersion: 'historical-score-v1',
        experimentVersion: 'historical-pilot-v1',
        featureSetVersion: 'qualitative-only-v1',
        simulatedCutoffAt: '2026-10-20T20:05:00.000Z',
        recordedAt: '2026-11-08T10:00:00.000Z',
        plannedEntrySession: '2026-10-21',
        evaluations: [{
          id: 'historical-evaluation-id',
          horizonDays: 5,
          plannedExitSession: '2026-10-27',
          stockEntryPrice: 100,
          stockExitPrice: 105,
          marketEntryPrice: 200,
          marketExitPrice: 202,
          sectorEntryPrice: 50,
          sectorExitPrice: 51,
          stockReturn: 0.05,
          marketReturn: 0.01,
          sectorReturn: 0.02,
          stockMinusMarketReturn: 0.04,
          stockMinusSectorReturn: 0.03,
          stockEntryPriceObservationId: 'stock-entry-id',
          stockExitPriceObservationId: 'stock-exit-id',
          marketEntryPriceObservationId: 'market-entry-id',
          marketExitPriceObservationId: 'market-exit-id',
          sectorEntryPriceObservationId: 'sector-entry-id',
          sectorExitPriceObservationId: 'sector-exit-id',
          methodologyVersion: 'adjusted-open-to-adjusted-close-v1',
          reconstructionRuleVersion: 'retrospective-price-reconstruction-v1',
          calculatedAt: '2026-11-08T10:00:00.000Z',
          recordedAt: '2026-11-08T10:00:01.000Z',
          snapshotFingerprint: 'a'.repeat(64),
        }],
      }]
    },
  }

  const result = await graphql({
    schema: apiSchema,
    source: `query {
      historicalPredictionResults(limit: 500) {
        ticker
        experimentVersion
        evaluations {
          horizonDays
          stockEntryPrice
          stockReturn
          stockMinusMarketReturn
          reconstructionRuleVersion
          snapshotFingerprint
        }
      }
    }`,
    contextValue: { repository },
  })

  assert.equal(result.errors, undefined)
  assert.equal(receivedHistoricalLimit, 100)
  const historicalResults = result.data?.historicalPredictionResults as Array<{
    ticker: string
    experimentVersion: string
    evaluations: Array<Record<string, unknown>>
  }>
  assert.equal(historicalResults[0]?.ticker, 'EXAMPLE')
  assert.equal(historicalResults[0]?.experimentVersion, 'historical-pilot-v1')
  assert.equal(historicalResults[0]?.evaluations[0]?.stockReturn, 0.05)
  assert.equal(historicalResults[0]?.evaluations[0]?.stockMinusMarketReturn, 0.04)
  assert.equal(historicalResults[0]?.evaluations[0]?.snapshotFingerprint, 'a'.repeat(64))
})
