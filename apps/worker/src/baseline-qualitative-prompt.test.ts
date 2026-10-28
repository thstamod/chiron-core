import assert from 'node:assert/strict'
import test from 'node:test'
import { buildBaselineQualitativeProviderRequest } from './baseline-qualitative-prompt.js'
import { PromptVersion, QualitativeExtractionLimit } from './constants.js'
import { calculateContentSha256 } from './content-hash.js'
import {
  prepareQualitativeExtractionInput,
  type QualitativeSourceDocument,
} from './qualitative-extraction.js'

function sourceDocument(
  documentId: string,
  role: 'current' | 'previous',
  publishedAt: string,
  text: string,
): QualitativeSourceDocument {
  return {
    documentId,
    role,
    documentType: 'sec-exhibit-99.1',
    publishedAt,
    firstSeenAt: publishedAt,
    sourceContentSha256: `source-${documentId}`,
    textExtractionVersion: 'sec-html-text-v3',
    textContentSha256: calculateContentSha256(new TextEncoder().encode(text)),
    text,
  }
}

const currentDocument = sourceDocument(
  '11111111-1111-4111-8111-111111111111',
  'current',
  '2026-10-20T20:00:00.000Z',
  'Current earnings release text.',
)

const previousDocument = sourceDocument(
  '22222222-2222-4222-8222-222222222222',
  'previous',
  '2025-10-20T20:00:00.000Z',
  'Previous earnings release text.',
)

test('builds the versioned baseline request without provider-specific fields', () => {
  const preparedInput = prepareQualitativeExtractionInput(
    'event-1',
    '2026-10-21T00:00:00.000Z',
    [previousDocument, currentDocument],
  )
  const request = buildBaselineQualitativeProviderRequest(preparedInput)

  assert.equal(request.prompt.version, PromptVersion.baselineQualitativeExtraction)
  assert.equal(
    request.maximumOutputTokens,
    QualitativeExtractionLimit.maximumOutputTokens,
  )
  assert.match(request.prompt.instructions, /Do not give investment advice/)
  assert.match(request.prompt.instructions, /Exclude standard safe-harbor/)
  assert.match(request.prompt.instructions, /material one-time, discrete, valuation, investment/)
  assert.match(request.prompt.instructions, /recurring operating performance/)
  assert.match(request.prompt.instructions, /unknown, not positive evidence/)
  assert.match(request.prompt.instructions, /official regulatory sources/)
  assert.equal(request.metadata.earningsEventId, 'event-1')
  assert.equal(request.metadata.inputFingerprint, preparedInput.inputSha256)
  assert.equal(request.metadata.schemaVersion, preparedInput.manifest.schemaVersion)
  assert.equal(
    request.metadata.inputSelectionVersion,
    preparedInput.manifest.inputSelectionVersion,
  )
  assert.doesNotMatch(request.prompt.documentInput, /inputFingerprint/)
  assert.doesNotMatch(request.prompt.documentInput, /characterCount/)
  assert.ok(
    request.prompt.documentInput.indexOf('role: current')
      < request.prompt.documentInput.indexOf('role: previous'),
  )
  assert.match(request.prompt.documentInput, /Current earnings release text\./)
  assert.match(request.prompt.documentInput, /Previous earnings release text\./)
  assert.match(request.prompt.documentInput, /BEGIN_PASSAGE current-p0001/)
})

test('builds a valid request when no previous document is available', () => {
  const preparedInput = prepareQualitativeExtractionInput(
    'event-2',
    '2026-10-21T00:00:00.000Z',
    [currentDocument],
  )
  const request = buildBaselineQualitativeProviderRequest(preparedInput)

  assert.match(request.prompt.documentInput, /role: current/)
  assert.doesNotMatch(request.prompt.documentInput, /role: previous/)
  assert.match(request.prompt.instructions, /changeFromPrevious must be unavailable/)
})
