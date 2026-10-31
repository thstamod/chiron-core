import assert from 'node:assert/strict'
import test from 'node:test'
import type { EffectiveQualitativeExtraction } from './effective-qualitative-extraction.js'
import {
  MarketCalendar,
  MarketCalendarVersion,
  PredictionSnapshotVersion,
  QualitativeEffectiveOutputSource,
  QualitativeReviewDecision,
  RuleVersion,
} from './constants.js'
import {
  preparePredictionSnapshot,
  type PredictionSnapshotInput,
} from './predictions.js'

function predictionSnapshotInput(): PredictionSnapshotInput {
  const qualitativeOutput = {
    guidance: {
      status: 'provided' as const,
      items: [{
        metric: 'revenue' as const,
        direction: 'introduced' as const,
        period: 'next quarter',
        summary: 'Revenue guidance was introduced.',
        evidence: [{ passageId: 'current-p0001' }],
      }],
      summary: 'Guidance was provided.',
      evidence: [{ passageId: 'current-p0001' }],
    },
    marginDirection: {
      direction: 'improving' as const,
      summary: 'Margins improved.',
      evidence: [{ passageId: 'current-p0002' }],
    },
    managementTone: {
      currentTone: 'neutral' as const,
      changeFromPrevious: 'similar' as const,
      summary: 'Tone was similar.',
      currentEvidence: [{ passageId: 'current-p0003' }],
      previousEvidence: [{ passageId: 'previous-p0001' }],
    },
    keyPositives: [{
      statement: 'Demand increased.',
      evidence: [{ passageId: 'current-p0004' }],
    }],
    keyRisks: [{
      statement: 'Costs increased.',
      evidence: [{ passageId: 'current-p0005' }],
    }],
    summary: 'Reviewed earnings summary.',
    sourceLimitations: [],
  }
  const effectiveQualitativeExtraction: EffectiveQualitativeExtraction = {
    earningsEventId: 'event-1',
    extractionRunId: 'run-1',
    cutoffAt: '2026-10-30T17:00:00.000Z',
    promptVersion: 'baseline-v6',
    modelName: 'test-model',
    original: {
      schemaVersion: 'qualitative-earnings-v4',
      validationStatus: 'valid',
      output: qualitativeOutput,
      outputFingerprint: 'a'.repeat(64),
      locatedEvidence: [],
    },
    review: {
      id: 'review-1',
      decision: QualitativeReviewDecision.accepted,
      reviewerLabel: 'test-reviewer',
      notes: 'Reviewed.',
      version: 'manual-qualitative-review-v1',
      createdAt: '2026-10-30T17:30:00.000Z',
    },
    effective: {
      source: QualitativeEffectiveOutputSource.original,
      schemaVersion: 'qualitative-earnings-v4',
      output: qualitativeOutput,
      outputFingerprint: 'a'.repeat(64),
      locatedEvidence: [],
    },
  }

  return {
    cutoffAt: '2026-10-30T18:10:00.000Z',
    earningsEvent: {
      id: 'event-1',
      companyId: 'company-1',
      ticker: 'AMZN',
      legalName: 'Amazon.com, Inc.',
      periodEnd: '2026-09-30',
      status: 'detected',
      detectedAt: '2026-10-29T21:49:15.000Z',
    },
    availableEventDocuments: [{
      id: 'document-1',
      filing_id: 'filing-1',
      accession_number: '0001018724-26-000038',
      document_type: 'sec-exhibit-99.1',
      source_url: 'https://www.sec.gov/example',
      storage_path: 'AMZN/example.htm',
      published_at: '2026-10-29T20:05:27.000Z',
      first_seen_at: '2026-10-29T21:49:05.000Z',
      content_sha256: 'b'.repeat(64),
      content_size_bytes: 100,
    }],
    financial: {
      calculation: {
        id: 'calculation-1',
        earnings_event_id: 'event-1',
        calculation_version: RuleVersion.financialDerivedMetrics,
        input_sha256: 'c'.repeat(64),
        input_manifest: {
          currentPeriod: {
            earningsEventId: 'event-1',
            sourcePublishedAt: '2026-10-29T22:20:46.000Z',
          },
          previousYearPeriod: {
            earningsEventId: 'previous-event',
            sourcePublishedAt: '2025-10-30T22:00:00.000Z',
          },
        },
        metric_count: 2,
        warnings: [],
        output_sha256: 'd'.repeat(64),
        created_at: '2026-10-30T15:56:50.000Z',
      },
      metrics: [
        {
          id: 'metric-1',
          metric_code: 'revenue_growth_year_over_year_percent',
          value_numeric: '12.085875',
          unit: 'percent',
          calculation_expression: 'revenue growth expression',
          calculation_version: RuleVersion.financialDerivedMetrics,
          input_sha256: 'c'.repeat(64),
          input_metrics: [],
          created_at: '2026-10-30T15:56:50.000Z',
        },
        {
          id: 'metric-2',
          metric_code: 'net_margin_change_year_over_year_percentage_points',
          value_numeric: '-1.516576',
          unit: 'percentage_points',
          calculation_expression: 'margin change expression',
          calculation_version: RuleVersion.financialDerivedMetrics,
          input_sha256: 'c'.repeat(64),
          input_metrics: [],
          created_at: '2026-10-30T15:56:50.000Z',
        },
      ],
    },
    effectiveQualitativeExtraction,
    qualitativeRun: {
      id: 'run-1',
      earnings_event_id: 'event-1',
      cutoff_at: '2026-10-30T17:00:00.000Z',
      input_manifest: {
        earningsEventId: 'event-1',
        documents: [{
          publishedAt: '2026-10-29T20:05:27.000Z',
          firstSeenAt: '2026-10-29T21:49:05.000Z',
        }],
      },
      input_sha256: 'e'.repeat(64),
      input_selection_version: RuleVersion.qualitativeInputSelection,
      provider_name: 'test-provider',
      provider_request_id: 'request-1',
      resolved_model_name: 'test-model',
      started_at: '2026-10-30T17:00:00.000Z',
      finished_at: '2026-10-30T17:01:00.000Z',
      token_usage: {},
      created_at: '2026-10-30T17:01:01.000Z',
    },
    plannedSessions: {
      entry: {
        sessionDate: '2026-11-02',
        opensAt: '2026-11-02T14:30:00.000Z',
        calendarCode: MarketCalendar.unitedStatesEquities,
        calendarVersion: MarketCalendarVersion.unitedStatesEquities2026Through2028,
        ruleVersion: RuleVersion.referencePriceSession,
      },
      day1SessionDate: '2026-11-02',
      day5SessionDate: '2026-11-06',
      day20SessionDate: '2026-11-30',
      evaluationSessionRuleVersion: RuleVersion.evaluationSessionPlan,
    },
  }
}

test('prepares a complete deterministic immutable prediction snapshot', () => {
  const input = predictionSnapshotInput()
  const first = preparePredictionSnapshot(input)
  const second = preparePredictionSnapshot(input)

  assert.equal(first.snapshot.schemaVersion, PredictionSnapshotVersion.initial)
  assert.equal(first.snapshot.cutoffAt, input.cutoffAt)
  assert.equal(first.score.financialScore, 0)
  assert.equal(first.score.qualitativeScore, 1)
  assert.equal(first.score.score, 1)
  assert.equal(first.fingerprint, second.fingerprint)
  assert.match(first.fingerprint, /^[0-9a-f]{64}$/)
})

test('changes the prediction fingerprint when a frozen input changes', () => {
  const original = predictionSnapshotInput()
  const changed = predictionSnapshotInput()
  changed.availableEventDocuments[0]!.content_sha256 = 'f'.repeat(64)

  assert.notEqual(
    preparePredictionSnapshot(original).fingerprint,
    preparePredictionSnapshot(changed).fingerprint,
  )
})

test('rejects prediction information that became available after the cutoff', () => {
  const input = predictionSnapshotInput()
  input.availableEventDocuments[0]!.first_seen_at = '2026-10-30T18:11:00.000Z'

  assert.throws(
    () => preparePredictionSnapshot(input),
    /later than the prediction cutoff/,
  )
})

test('rejects mismatched financial and qualitative event identities', () => {
  const financialMismatch = predictionSnapshotInput()
  financialMismatch.financial.calculation.earnings_event_id = 'event-2'
  assert.throws(
    () => preparePredictionSnapshot(financialMismatch),
    /financial calculation belongs to a different earnings event/,
  )

  const qualitativeMismatch = predictionSnapshotInput()
  qualitativeMismatch.effectiveQualitativeExtraction.earningsEventId = 'event-2'
  assert.throws(
    () => preparePredictionSnapshot(qualitativeMismatch),
    /qualitative extraction belongs to a different earnings event/,
  )
})

test('rejects an entry opening that is not after the prediction cutoff', () => {
  const input = predictionSnapshotInput()
  input.plannedSessions.entry.opensAt = input.cutoffAt

  assert.throws(
    () => preparePredictionSnapshot(input),
    /must open after the prediction cutoff/,
  )
})
