import assert from 'node:assert/strict'
import test from 'node:test'
import type { QualitativeExtraction } from '@chiron/shared'
import {
  QualitativeProviderStatus,
  QualitativeReviewDecision,
  QualitativeValidationStatus,
} from './constants.js'
import { canonicalJson } from './canonical-json.js'
import { calculateContentSha256 } from './content-hash.js'
import {
  buildQualitativeQualityRuns,
  createQualitativeQualityReviewRunIdBatches,
} from './qualitative-quality-report-loader.js'

function fingerprint(value: unknown): string {
  return calculateContentSha256(new TextEncoder().encode(canonicalJson(value)))
}

const output: QualitativeExtraction = {
  guidance: {
    status: 'not_provided',
    items: [],
    summary: null,
    evidence: [],
  },
  marginDirection: {
    direction: 'not_disclosed',
    summary: null,
    evidence: [],
  },
  managementTone: {
    currentTone: 'neutral',
    changeFromPrevious: 'unavailable',
    summary: 'Management described the quarter.',
    currentEvidence: [{ passageId: 'current-p0001' }],
    previousEvidence: [],
  },
  keyPositives: [],
  keyRisks: [],
  summary: 'The company reported quarterly results.',
  sourceLimitations: ['No previous release was supplied.'],
}

const correctedOutput: QualitativeExtraction = {
  ...output,
  managementTone: {
    ...output.managementTone,
    currentTone: 'cautious',
  },
}

const version1Output = {
  guidance: {
    change: 'maintained',
    summary: 'Guidance was maintained.',
    evidence: [{
      sourceDocumentId: '11111111-1111-4111-8111-111111111111',
      quote: 'Guidance remains unchanged.',
    }],
  },
  marginDirection: {
    direction: 'stable',
    summary: 'Margins were stable.',
    evidence: [],
  },
  managementTone: {
    currentTone: 'neutral',
    changeFromPrevious: 'unavailable',
    summary: null,
    evidence: [],
  },
  keyPositives: [],
  keyRisks: [],
  summary: 'The company maintained guidance.',
  sourceLimitations: ['No previous report was supplied.'],
}

const documentEvidence = {
  sourceDocumentId: '11111111-1111-4111-8111-111111111111',
  quote: 'Revenue guidance was maintained.',
}

const version2Output = {
  guidance: {
    status: 'provided',
    items: [{
      metric: 'revenue',
      direction: 'maintained',
      period: 'full year',
      summary: 'Revenue guidance was maintained.',
      evidence: [documentEvidence],
    }],
    summary: 'Guidance was maintained.',
    evidence: [documentEvidence],
  },
  marginDirection: {
    direction: 'stable',
    summary: 'Margins were stable.',
    evidence: [documentEvidence],
  },
  managementTone: {
    currentTone: 'neutral',
    changeFromPrevious: 'unavailable',
    summary: null,
    evidence: [],
  },
  keyPositives: [],
  keyRisks: [],
  summary: 'The company maintained guidance.',
  sourceLimitations: ['No previous report was supplied.'],
}

const passageEvidence = { passageId: 'current-p0001' }
const version3Output = {
  ...version2Output,
  guidance: {
    ...version2Output.guidance,
    items: version2Output.guidance.items.map((item) => ({
      ...item,
      evidence: [passageEvidence],
    })),
    evidence: [passageEvidence],
  },
  marginDirection: {
    ...version2Output.marginDirection,
    evidence: [passageEvidence],
  },
}

function extractionRunRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'run-1',
    earnings_event_id: 'event-1',
    input_sha256: 'input-fingerprint',
    schema_version: 'qualitative-earnings-v4',
    prompt_version: 'baseline-v6',
    model_name: 'requested-model',
    resolved_model_name: 'resolved-model',
    provider_status: QualitativeProviderStatus.completed,
    validation_status: QualitativeValidationStatus.valid,
    duration_milliseconds: 1_250,
    token_usage: {
      inputTokens: 1_000,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 200,
      reasoningTokens: 20,
      totalTokens: 1_200,
    },
    output,
    output_sha256: fingerprint(output),
    created_at: '2026-11-01T10:00:00.000Z',
    ...overrides,
  }
}

function reviewRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'review-1',
    extraction_run_id: 'run-1',
    decision: QualitativeReviewDecision.accepted,
    reviewed_output_sha256: fingerprint(output),
    corrected_output: null,
    corrected_schema_version: null,
    corrected_output_sha256: null,
    created_at: '2026-11-01T11:00:00.000Z',
    ...overrides,
  }
}

test('selects the newest review and returns calculator-ready runs', () => {
  const runs = buildQualitativeQualityRuns(
    [extractionRunRow()],
    [
      reviewRow(),
      reviewRow({
        id: 'review-2',
        decision: QualitativeReviewDecision.corrected,
        corrected_output: correctedOutput,
        corrected_schema_version: 'qualitative-earnings-v4',
        corrected_output_sha256: fingerprint(correctedOutput),
        created_at: '2026-11-01T12:00:00.000Z',
      }),
      reviewRow({
        id: 'unrelated-review',
        extraction_run_id: 'unselected-run',
      }),
    ],
  )

  assert.equal(runs.length, 1)
  assert.equal(runs[0]?.id, 'run-1')
  assert.equal(runs[0]?.latestReview?.decision, QualitativeReviewDecision.corrected)
  assert.deepEqual(runs[0]?.latestReview?.correctedOutput, correctedOutput)
})

test('creates bounded unique run-ID batches for review queries', () => {
  const runIds = Array.from({ length: 205 }, (_, index) => `run-${index}`)
  runIds.push('run-0')

  const batches = createQualitativeQualityReviewRunIdBatches(runIds)

  assert.deepEqual(batches.map((batch) => batch.length), [100, 100, 5])
  assert.equal(new Set(batches.flat()).size, 205)
  assert.deepEqual(createQualitativeQualityReviewRunIdBatches([]), [])
})

test('preserves unsuccessful attempts without inventing output data', () => {
  const runs = buildQualitativeQualityRuns([
    extractionRunRow({
      provider_status: QualitativeProviderStatus.requestFailed,
      validation_status: null,
      output: null,
      output_sha256: null,
      token_usage: {
        inputTokens: null,
        cachedInputTokens: null,
        cacheWriteTokens: null,
        outputTokens: null,
        reasoningTokens: null,
        totalTokens: null,
      },
    }),
  ], [])

  assert.equal(runs[0]?.providerStatus, QualitativeProviderStatus.requestFailed)
  assert.equal(runs[0]?.output, null)
  assert.equal(runs[0]?.latestReview, null)
})

test('validates immutable version 1 output with its original schema', () => {
  const runs = buildQualitativeQualityRuns(
    [extractionRunRow({
      schema_version: 'qualitative-earnings-v1',
      output: version1Output,
      output_sha256: fingerprint(version1Output),
    })],
    [reviewRow({ reviewed_output_sha256: fingerprint(version1Output) })],
  )

  assert.equal(runs[0]?.schemaVersion, 'qualitative-earnings-v1')
  assert.deepEqual(runs[0]?.output, version1Output)
})

test('validates immutable version 2 and version 3 outputs with their original schemas', () => {
  for (const [schemaVersion, historicalOutput] of [
    ['qualitative-earnings-v2', version2Output],
    ['qualitative-earnings-v3', version3Output],
  ] as const) {
    const runs = buildQualitativeQualityRuns(
      [extractionRunRow({
        schema_version: schemaVersion,
        output: historicalOutput,
        output_sha256: fingerprint(historicalOutput),
      })],
      [reviewRow({ reviewed_output_sha256: fingerprint(historicalOutput) })],
    )

    assert.equal(runs[0]?.schemaVersion, schemaVersion)
    assert.deepEqual(runs[0]?.output, historicalOutput)
  }
})

test('rejects malformed token usage and inconsistent review shapes', () => {
  assert.throws(
    () => buildQualitativeQualityRuns([
      extractionRunRow({
        token_usage: {
          inputTokens: -1,
          cachedInputTokens: 0,
          cacheWriteTokens: 0,
          outputTokens: 0,
          reasoningTokens: 0,
          totalTokens: 0,
        },
      }),
    ], []),
    /invalid inputTokens/,
  )

  assert.throws(
    () => buildQualitativeQualityRuns(
      [extractionRunRow()],
      [reviewRow({
        decision: QualitativeReviewDecision.corrected,
        corrected_output: null,
        corrected_schema_version: null,
        corrected_output_sha256: null,
      })],
    ),
    /corrected output inconsistent with its decision/,
  )
})

test('rejects output and review fingerprint mismatches', () => {
  assert.throws(
    () => buildQualitativeQualityRuns([
      extractionRunRow({ output_sha256: '0'.repeat(64) }),
    ], []),
    /output does not match its stored fingerprint/,
  )

  assert.throws(
    () => buildQualitativeQualityRuns(
      [extractionRunRow()],
      [reviewRow({ reviewed_output_sha256: '0'.repeat(64) })],
    ),
    /does not match extraction run/,
  )
})
