import assert from 'node:assert/strict'
import test from 'node:test'
import type { QualitativeExtraction } from '@chiron/shared'
import { canonicalJson } from './canonical-json.js'
import { calculateContentSha256 } from './content-hash.js'
import {
  QualitativeEffectiveOutputSource,
  QualitativeProviderStatus,
  QualitativeReviewDecision,
  QualitativeReviewVersion,
  QualitativeValidationStatus,
} from './constants.js'
import { selectEffectiveQualitativeExtraction } from './effective-qualitative-extraction.js'

const output: QualitativeExtraction = {
  guidance: { status: 'not_provided', items: [], summary: null, evidence: [] },
  marginDirection: { direction: 'not_disclosed', summary: null, evidence: [] },
  managementTone: {
    currentTone: 'unclear',
    changeFromPrevious: 'unavailable',
    summary: null,
    currentEvidence: [],
    previousEvidence: [],
  },
  keyPositives: [],
  keyRisks: [],
  summary: 'The release contains limited qualitative information.',
  sourceLimitations: ['No previous release was supplied.'],
}

const correctedOutput: QualitativeExtraction = {
  ...output,
  summary: 'The reviewed release contains limited qualitative information.',
}

function fingerprint(value: unknown): string {
  return calculateContentSha256(new TextEncoder().encode(canonicalJson(value)))
}

function run(id: string, createdAt: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    earnings_event_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    cutoff_at: '2026-10-28T10:00:00.000Z',
    schema_version: 'qualitative-earnings-v4',
    prompt_version: 'baseline-v6',
    model_name: 'test-model',
    provider_status: QualitativeProviderStatus.completed,
    validation_status: QualitativeValidationStatus.valid,
    output,
    output_sha256: fingerprint(output),
    located_evidence: [],
    created_at: createdAt,
    ...overrides,
  }
}

function review(
  id: string,
  extractionRunId: string,
  decision: string,
  createdAt: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    extraction_run_id: extractionRunId,
    decision,
    reviewed_output_sha256: fingerprint(output),
    corrected_output: null,
    corrected_schema_version: null,
    corrected_output_sha256: null,
    corrected_located_evidence: null,
    reviewer_label: 'owner-review',
    notes: 'Evidence reviewed.',
    review_version: QualitativeReviewVersion.manual,
    created_at: createdAt,
    ...overrides,
  }
}

test('returns no effective output before human review', () => {
  assert.equal(
    selectEffectiveQualitativeExtraction([
      run('11111111-1111-4111-8111-111111111111', '2026-10-28T10:00:00.000Z'),
    ], []),
    null,
  )
})

test('rejects an invalid extraction cutoff timestamp', () => {
  assert.throws(
    () => selectEffectiveQualitativeExtraction([
      run(
        '11111111-1111-4111-8111-111111111111',
        '2026-10-28T10:00:00.000Z',
        { cutoff_at: 'not-a-timestamp' },
      ),
    ], []),
    /invalid cutoff_at/,
  )
})

test('uses the original output after an accepted review', () => {
  const runId = '11111111-1111-4111-8111-111111111111'
  const result = selectEffectiveQualitativeExtraction(
    [run(runId, '2026-10-28T10:00:00.000Z')],
    [review(
      '22222222-2222-4222-8222-222222222222',
      runId,
      QualitativeReviewDecision.accepted,
      '2026-10-28T11:00:00.000Z',
    )],
  )

  assert.equal(result?.effective.source, QualitativeEffectiveOutputSource.original)
  assert.deepEqual(result?.effective.output, output)
})

test('uses corrected output after a corrected review', () => {
  const runId = '11111111-1111-4111-8111-111111111111'
  const result = selectEffectiveQualitativeExtraction(
    [run(runId, '2026-10-28T10:00:00.000Z')],
    [review(
      '22222222-2222-4222-8222-222222222222',
      runId,
      QualitativeReviewDecision.corrected,
      '2026-10-28T11:00:00.000Z',
      {
        corrected_output: correctedOutput,
        corrected_schema_version: 'qualitative-earnings-v4',
        corrected_output_sha256: fingerprint(correctedOutput),
        corrected_located_evidence: [],
      },
    )],
  )

  assert.equal(
    result?.effective.source,
    QualitativeEffectiveOutputSource.correctedReview,
  )
  assert.deepEqual(result?.effective.output, correctedOutput)
  assert.deepEqual(result?.original.output, output)
})

test('a newer rejected review makes that extraction run unusable', () => {
  const runId = '11111111-1111-4111-8111-111111111111'
  const result = selectEffectiveQualitativeExtraction(
    [run(runId, '2026-10-28T10:00:00.000Z')],
    [
      review(
        '22222222-2222-4222-8222-222222222222',
        runId,
        QualitativeReviewDecision.accepted,
        '2026-10-28T11:00:00.000Z',
      ),
      review(
        '33333333-3333-4333-8333-333333333333',
        runId,
        QualitativeReviewDecision.rejected,
        '2026-10-28T12:00:00.000Z',
      ),
    ],
  )

  assert.equal(result, null)
})

test('uses the newest reviewed usable run and ignores an unreviewed newer run', () => {
  const olderRunId = '11111111-1111-4111-8111-111111111111'
  const newerRunId = '22222222-2222-4222-8222-222222222222'
  const result = selectEffectiveQualitativeExtraction(
    [
      run(olderRunId, '2026-10-28T10:00:00.000Z'),
      run(newerRunId, '2026-10-28T12:00:00.000Z'),
    ],
    [review(
      '33333333-3333-4333-8333-333333333333',
      olderRunId,
      QualitativeReviewDecision.accepted,
      '2026-10-28T11:00:00.000Z',
    )],
  )

  assert.equal(result?.extractionRunId, olderRunId)
})

test('uses the usable run with the newest human review', () => {
  const olderRunId = '11111111-1111-4111-8111-111111111111'
  const newerRunId = '22222222-2222-4222-8222-222222222222'
  const result = selectEffectiveQualitativeExtraction(
    [
      run(olderRunId, '2026-10-28T10:00:00.000Z'),
      run(newerRunId, '2026-10-28T11:00:00.000Z'),
    ],
    [
      review(
        '33333333-3333-4333-8333-333333333333',
        olderRunId,
        QualitativeReviewDecision.accepted,
        '2026-10-28T12:00:00.000Z',
      ),
      review(
        '44444444-4444-4444-8444-444444444444',
        newerRunId,
        QualitativeReviewDecision.accepted,
        '2026-10-28T13:00:00.000Z',
      ),
    ],
  )

  assert.equal(result?.extractionRunId, newerRunId)
})

test('rejects extraction runs from different earnings events', () => {
  assert.throws(
    () => selectEffectiveQualitativeExtraction([
      run('11111111-1111-4111-8111-111111111111', '2026-10-28T10:00:00.000Z'),
      run(
        '22222222-2222-4222-8222-222222222222',
        '2026-10-28T11:00:00.000Z',
        { earnings_event_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
      ),
    ], []),
    /cannot mix earnings events/,
  )
})

test('rejects effective output that does not match its stored fingerprint', () => {
  const runId = '11111111-1111-4111-8111-111111111111'

  assert.throws(
    () => selectEffectiveQualitativeExtraction(
      [run(runId, '2026-10-28T10:00:00.000Z', { output_sha256: '0'.repeat(64) })],
      [review(
        '22222222-2222-4222-8222-222222222222',
        runId,
        QualitativeReviewDecision.accepted,
        '2026-10-28T11:00:00.000Z',
      )],
    ),
    /does not match its output fingerprint/,
  )
})

test('rejects corrected output that does not match its stored fingerprint', () => {
  const runId = '11111111-1111-4111-8111-111111111111'

  assert.throws(
    () => selectEffectiveQualitativeExtraction(
      [run(runId, '2026-10-28T10:00:00.000Z')],
      [review(
        '22222222-2222-4222-8222-222222222222',
        runId,
        QualitativeReviewDecision.corrected,
        '2026-10-28T11:00:00.000Z',
        {
          corrected_output: correctedOutput,
          corrected_schema_version: 'qualitative-earnings-v4',
          corrected_output_sha256: '0'.repeat(64),
          corrected_located_evidence: [],
        },
      )],
    ),
    /does not match its output fingerprint/,
  )
})

test('rejects a reviewed completed output without a validation status', () => {
  const runId = '11111111-1111-4111-8111-111111111111'

  assert.throws(
    () => selectEffectiveQualitativeExtraction(
      [run(runId, '2026-10-28T10:00:00.000Z', { validation_status: null })],
      [review(
        '22222222-2222-4222-8222-222222222222',
        runId,
        QualitativeReviewDecision.corrected,
        '2026-10-28T11:00:00.000Z',
        {
          corrected_output: correctedOutput,
          corrected_schema_version: 'qualitative-earnings-v4',
          corrected_output_sha256: fingerprint(correctedOutput),
          corrected_located_evidence: [],
        },
      )],
    ),
    /has no validation status/,
  )
})
