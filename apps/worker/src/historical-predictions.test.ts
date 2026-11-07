import assert from 'node:assert/strict'
import test from 'node:test'
import {
  HistoricalPredictionFeatureSet,
  HistoricalPredictionSnapshotVersion,
  MarketCalendar,
  MarketCalendarVersion,
  QualitativeEffectiveOutputSource,
  QualitativeReviewDecision,
  RuleVersion,
} from './constants.js'
import type { EffectiveQualitativeExtraction } from './effective-qualitative-extraction.js'
import { prepareHistoricalPredictionSnapshot } from './historical-predictions.js'

test('freezes a deterministic qualitative-only historical prediction', () => {
  const qualitativeOutput = {
    guidance: {
      status: 'not_provided' as const,
      items: [],
      summary: null,
      evidence: [],
    },
    marginDirection: {
      direction: 'not_disclosed' as const,
      summary: null,
      evidence: [],
    },
    managementTone: {
      currentTone: 'unclear' as const,
      changeFromPrevious: 'unavailable' as const,
      summary: null,
      currentEvidence: [],
      previousEvidence: [],
    },
    keyPositives: [],
    keyRisks: [],
    summary: 'The supplied release contains limited qualitative information.',
    sourceLimitations: ['No previous release was supplied.'],
  }
  const effectiveExtraction: EffectiveQualitativeExtraction = {
    earningsEventId: 'event-1',
    extractionRunId: 'run-1',
    cutoffAt: '2026-08-05T10:45:54.000Z',
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
      reviewerLabel: 'owner-manual-review',
      notes: 'Reviewed.',
      version: 'manual-qualitative-review-v1',
      createdAt: '2026-11-06T18:00:00.000Z',
    },
    effective: {
      source: QualitativeEffectiveOutputSource.original,
      schemaVersion: 'qualitative-earnings-v4',
      output: qualitativeOutput,
      outputFingerprint: 'a'.repeat(64),
      locatedEvidence: [],
    },
  }
  const input = {
    plan: {
      id: 'plan-1',
      earnings_event_id: 'event-1',
      simulated_cutoff_at: '2026-08-05T10:45:54.000Z',
      experiment_version: 'historical-pilot-v1',
      source_availability_rule_version: RuleVersion.historicalSourceAvailability,
      input_selection_version: RuleVersion.historicalQualitativeInputSelection,
      source_manifest: {},
      source_manifest_sha256: 'b'.repeat(64),
      qualitative_input_sha256: 'c'.repeat(64),
      snapshot_schema_version: 'historical-reconstruction-plan-v1',
      recorded_at: '2026-11-04T12:00:00.000Z',
    },
    event: {
      id: 'event-1',
      companyId: 'company-1',
      ticker: 'DIS',
      legalName: 'The Walt Disney Company',
      periodEnd: '2026-06-27',
      status: 'detected',
      actualDetectedAt: '2026-11-01T12:00:00.000Z',
    },
    effectiveExtraction,
    plannedSessions: {
      entry: {
        sessionDate: '2026-08-05',
        opensAt: '2026-08-05T13:30:00.000Z',
        calendarCode: MarketCalendar.unitedStatesEquities,
        calendarVersion: MarketCalendarVersion.unitedStatesEquities2026Through2028,
        ruleVersion: RuleVersion.referencePriceSession,
      },
      day1SessionDate: '2026-08-05',
      day5SessionDate: '2026-08-11',
      day20SessionDate: '2026-09-02',
      evaluationSessionRuleVersion: RuleVersion.evaluationSessionPlan,
    },
  }

  const first = prepareHistoricalPredictionSnapshot(input)
  const second = prepareHistoricalPredictionSnapshot(input)

  assert.equal(first.snapshotFingerprint, second.snapshotFingerprint)
  assert.equal(first.snapshot.schemaVersion, HistoricalPredictionSnapshotVersion.qualitativeOnly)
  assert.equal(first.snapshot.featureSetVersion, HistoricalPredictionFeatureSet.qualitativeOnly)
  assert.equal(first.snapshot.financialInput.status, 'excluded_by_feature_set')
  assert.equal(first.snapshot.score.financialScore, 0)
  assert.equal(first.snapshot.score.score, 0)
})
