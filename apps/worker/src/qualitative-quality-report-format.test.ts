import assert from 'node:assert/strict'
import test from 'node:test'
import { QualitativeProviderStatus } from './constants.js'
import { formatQualitativeQualityReport } from './qualitative-quality-report-format.js'
import {
  calculateQualitativeQualityReport,
  type QualitativeQualityRun,
} from './qualitative-quality-report.js'

const run: QualitativeQualityRun = {
  id: 'run-1',
  earningsEventId: 'event-1',
  inputFingerprint: 'input-1',
  schemaVersion: 'qualitative-earnings-v4',
  promptVersion: 'baseline-v6',
  requestedModel: 'requested-model',
  resolvedModel: 'resolved-model',
  providerStatus: QualitativeProviderStatus.requestFailed,
  validationStatus: null,
  durationMilliseconds: 1_250,
  tokenUsage: {
    inputTokens: null,
    cachedInputTokens: null,
    cacheWriteTokens: null,
    outputTokens: null,
    reasoningTokens: null,
    totalTokens: null,
  },
  output: null,
  outputFingerprint: null,
  latestReview: null,
}

test('formats missing review, consistency, token, and cost evidence honestly', () => {
  const formatted = formatQualitativeQualityReport(
    calculateQualitativeQualityReport([run]),
    'all extraction purposes',
  )

  assert.match(formatted, /request_failed: 1/)
  assert.match(formatted, /resolved-model: 1/)
  assert.match(formatted, /unreviewed: 1/)
  assert.match(formatted, /Correction frequency among accepted\/corrected reviews/)
  assert.match(formatted, /Exact-match groups: 0\/0 \(not enough data\)/)
  assert.match(formatted, /Incomplete token-usage rows: 1/)
  assert.match(formatted, /Estimated cost: not calculated/)
  assert.match(formatted, /does not approve automated extraction/)
})
