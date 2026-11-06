import assert from 'node:assert/strict'
import test from 'node:test'
import { calculateContentSha256 } from './content-hash.js'
import {
  HistoricalReconstructionMode,
  HistoricalReconstructionPlanVersion,
  QualitativeSourceAvailabilityMode,
  RuleVersion,
} from './constants.js'
import { prepareHistoricalReconstructionPlan } from './historical-reconstruction-plan.js'
import { prepareQualitativeExtractionInput } from './qualitative-extraction.js'

function historicalInput() {
  const text = 'Management raised full-year revenue guidance.'
  return prepareQualitativeExtractionInput(
    '11111111-1111-4111-8111-111111111111',
    '2025-10-20T21:00:00.000Z',
    [{
      documentId: '22222222-2222-4222-8222-222222222222',
      role: 'current',
      documentType: 'sec-exhibit-99.1',
      publishedAt: '2025-10-20T20:00:00.000Z',
      firstSeenAt: '2026-11-04T20:00:00.000Z',
      sourceContentSha256: 'source-fingerprint',
      textExtractionVersion: 'sec-html-text-v3',
      textContentSha256: calculateContentSha256(new TextEncoder().encode(text)),
      text,
    }],
    {
      sourceAvailabilityMode: QualitativeSourceAvailabilityMode.historicalReconstruction,
    },
  )
}

test('prepares an immutable historical plan without price or outcome data', () => {
  const input = historicalInput()
  const prepared = prepareHistoricalReconstructionPlan(
    input.manifest,
    input.inputSha256,
    'historical-pilot-v1',
  )

  assert.equal(prepared.record.reconstruction_mode, HistoricalReconstructionMode.retrospective)
  assert.equal(
    prepared.record.snapshot_schema_version,
    HistoricalReconstructionPlanVersion.initial,
  )
  assert.equal(prepared.record.experiment_version, 'historical-pilot-v1')
  assert.equal(prepared.record.source_manifest.documents.length, 1)
  assert.match(prepared.record.source_manifest_sha256, /^[0-9a-f]{64}$/)
  assert.equal(JSON.stringify(prepared.record).includes('stock_return'), false)
})

test('rejects a forward manifest as a historical plan', () => {
  const input = historicalInput()
  const forwardManifest = {
    ...input.manifest,
    inputSelectionVersion: RuleVersion.qualitativeInputSelection,
    sourceAvailabilityRuleVersion: RuleVersion.forwardSourceAvailability,
  }

  assert.throws(
    () => prepareHistoricalReconstructionPlan(
      forwardManifest,
      input.inputSha256,
      'historical-pilot-v1',
    ),
    /historical qualitative input-selection rule/,
  )
})
