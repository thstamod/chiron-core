import assert from 'node:assert/strict'
import test from 'node:test'
import type { QualitativeExtraction } from '@chiron/shared'
import {
  QualitativeProviderStatus,
  QualitativeReviewDecision,
  QualitativeValidationStatus,
} from './constants.js'
import {
  calculateQualitativeQualityReport,
  type QualitativePricingProfile,
  type QualitativeQualityRun,
} from './qualitative-quality-report.js'

function extraction(overrides: Partial<QualitativeExtraction> = {}): QualitativeExtraction {
  return {
    guidance: {
      status: 'provided',
      items: [],
      summary: 'Guidance was maintained.',
      evidence: [{ passageId: 'current-p0001' }],
    },
    marginDirection: {
      direction: 'stable',
      summary: 'Margins were stable.',
      evidence: [{ passageId: 'current-p0002' }],
    },
    managementTone: {
      currentTone: 'neutral',
      changeFromPrevious: 'similar',
      summary: 'Management tone was similar.',
      currentEvidence: [{ passageId: 'current-p0003' }],
      previousEvidence: [{ passageId: 'previous-p0001' }],
    },
    keyPositives: [],
    keyRisks: [],
    summary: 'Results were stable.',
    sourceLimitations: [],
    ...overrides,
  }
}

const completeUsage = {
  inputTokens: 1_000,
  cachedInputTokens: 200,
  cacheWriteTokens: 100,
  outputTokens: 300,
  reasoningTokens: 50,
  totalTokens: 1_300,
}

function qualityRun(overrides: Partial<QualitativeQualityRun> = {}): QualitativeQualityRun {
  return {
    id: 'run-1',
    earningsEventId: 'event-1',
    inputFingerprint: 'input-1',
    schemaVersion: 'schema-v1',
    promptVersion: 'prompt-v1',
    requestedModel: 'requested-model',
    resolvedModel: 'resolved-model',
    providerStatus: QualitativeProviderStatus.completed,
    validationStatus: QualitativeValidationStatus.valid,
    durationMilliseconds: 1_000,
    tokenUsage: completeUsage,
    output: extraction(),
    outputFingerprint: 'output-1',
    latestReview: {
      decision: QualitativeReviewDecision.accepted,
      correctedOutput: null,
    },
    ...overrides,
  }
}

test('reports technical outcomes, human decisions, and strict field agreement', () => {
  const original = extraction()
  const corrected = extraction({
    keyRisks: [{
      statement: 'Demand could weaken.',
      evidence: [{ passageId: 'current-p0004' }],
    }],
  })
  const report = calculateQualitativeQualityReport([
    qualityRun(),
    qualityRun({
      id: 'run-2',
      earningsEventId: 'event-2',
      output: original,
      outputFingerprint: 'output-2',
      latestReview: {
        decision: QualitativeReviewDecision.corrected,
        correctedOutput: corrected,
      },
    }),
    qualityRun({
      id: 'run-3',
      earningsEventId: 'event-3',
      validationStatus: QualitativeValidationStatus.invalid,
      outputFingerprint: 'output-3',
      latestReview: {
        decision: QualitativeReviewDecision.rejected,
        correctedOutput: null,
      },
    }),
    qualityRun({
      id: 'run-4',
      earningsEventId: 'event-4',
      providerStatus: QualitativeProviderStatus.invalidOutput,
      validationStatus: null,
      output: null,
      outputFingerprint: null,
      latestReview: null,
    }),
  ])

  assert.equal(report.sample.totalRuns, 4)
  assert.deepEqual(report.sample.modelCounts, { 'resolved-model': 4 })
  assert.deepEqual(report.sample.promptVersionCounts, { 'prompt-v1': 4 })
  assert.deepEqual(report.sample.schemaVersionCounts, { 'schema-v1': 4 })
  assert.deepEqual(report.sample.latestReviewCounts, {
    accepted: 1,
    corrected: 1,
    rejected: 1,
    unreviewed: 1,
  })
  assert.equal(report.technicalQuality.schema.validityRate, 3 / 4)
  assert.equal(report.technicalQuality.evidence.validityRate, 2 / 3)
  assert.equal(report.humanReview.referenceRuns, 2)
  assert.equal(report.humanReview.correctionFrequency, 1 / 2)
  assert.equal(report.humanReview.exactOutputAgreement.agreementRate, 1 / 2)
  assert.equal(report.humanReview.fieldAgreement.guidance.agreementRate, 1)
  assert.equal(report.humanReview.fieldAgreement.marginDirection.agreementRate, 1)
  assert.equal(report.humanReview.fieldAgreement.managementTone.agreementRate, 1)
  assert.equal(report.humanReview.fieldAgreement.keyPositives.agreementRate, 1)
  assert.equal(report.humanReview.fieldAgreement.keyRisks.agreementRate, 1 / 2)
})

test('measures exact consistency only across identical run configurations', () => {
  const report = calculateQualitativeQualityReport([
    qualityRun({ id: 'run-1', outputFingerprint: 'same' }),
    qualityRun({ id: 'run-2', outputFingerprint: 'same' }),
    qualityRun({
      id: 'run-3',
      earningsEventId: 'event-2',
      inputFingerprint: 'input-2',
      outputFingerprint: 'first',
    }),
    qualityRun({
      id: 'run-4',
      earningsEventId: 'event-2',
      inputFingerprint: 'input-2',
      outputFingerprint: 'second',
    }),
    qualityRun({
      id: 'run-5',
      earningsEventId: 'event-3',
      outputFingerprint: 'single',
    }),
  ])

  assert.deepEqual(report.consistency, {
    repeatedConfigurationGroups: 2,
    exactMatchGroups: 1,
    exactMatchRate: 1 / 2,
  })
})

test('uses separate token categories for a dated cost estimate', () => {
  const pricingProfile: QualitativePricingProfile = {
    name: 'test-pricing',
    asOfDate: '2026-11-11',
    sourceUrl: 'https://example.com/pricing',
    modelPricing: {
      'resolved-model': {
        ordinaryInputUsdPerMillionTokens: 1,
        cachedInputUsdPerMillionTokens: 0.1,
        cacheWriteUsdPerMillionTokens: 1.25,
        outputUsdPerMillionTokens: 5,
      },
    },
  }
  const report = calculateQualitativeQualityReport([
    qualityRun(),
    qualityRun({
      id: 'run-2',
      resolvedModel: 'unpriced-model',
      durationMilliseconds: 2_000,
    }),
  ], pricingProfile)

  assert.deepEqual(report.efficiency.tokens.totalsFromCompleteRuns, {
    inputTokens: 2_000,
    cachedInputTokens: 400,
    cacheWriteTokens: 200,
    outputTokens: 600,
    reasoningTokens: 100,
    totalTokens: 2_600,
  })
  assert.equal(report.efficiency.latency.averageMilliseconds, 1_500)
  assert.equal(report.efficiency.latency.maximumMilliseconds, 2_000)
  assert.equal(report.efficiency.estimatedCost.pricedRuns, 1)
  assert.equal(report.efficiency.estimatedCost.unpricedRuns, 1)
  assert.equal(report.efficiency.estimatedCost.totalUsd, 0.002345)
})

test('does not invent cost or rates when no pricing profile is supplied', () => {
  const report = calculateQualitativeQualityReport([qualityRun()])

  assert.equal(report.efficiency.estimatedCost.pricingProfile, null)
  assert.equal(report.efficiency.estimatedCost.pricedRuns, 0)
  assert.equal(report.efficiency.estimatedCost.unpricedRuns, 1)
  assert.equal(report.efficiency.estimatedCost.totalUsd, null)
})

test('rejects incomplete corrected review data instead of lowering quality denominators', () => {
  assert.throws(
    () => calculateQualitativeQualityReport([
      qualityRun({
        latestReview: {
          decision: QualitativeReviewDecision.corrected,
          correctedOutput: null,
        },
      }),
    ]),
    /has no corrected output/,
  )
})

test('rejects invalid token numbers even without the database loader', () => {
  assert.throws(
    () => calculateQualitativeQualityReport([
      qualityRun({
        tokenUsage: {
          ...completeUsage,
          outputTokens: -1,
        },
      }),
    ]),
    /invalid outputTokens/,
  )

  assert.throws(
    () => calculateQualitativeQualityReport([
      qualityRun({
        tokenUsage: {
          ...completeUsage,
          inputTokens: 1.5,
        },
      }),
    ]),
    /invalid inputTokens/,
  )
})
