import assert from 'node:assert/strict'
import test from 'node:test'
import {
  selectQualitativeDocuments,
  type QualitativeDocumentCandidateRow,
} from './qualitative-input-loader.js'

function documentCandidate(
  id: string,
  earningsEventId: string,
  sourceFingerprint = `${id}-source`,
): QualitativeDocumentCandidateRow {
  return {
    id,
    earnings_event_id: earningsEventId,
    document_type: 'sec-exhibit-99.1',
    published_at: '2026-10-20T20:00:00.000Z',
    first_seen_at: '2026-10-20T20:01:00.000Z',
    content_sha256: sourceFingerprint,
    document_text_versions: {
      extraction_version: 'readable-text-v1',
      source_content_sha256: sourceFingerprint,
      storage_path: `derived-text/${id}.txt`,
      content_sha256: `${id}-text`,
    },
  }
}

test('selects one current and one previous earnings release', () => {
  const selected = selectQualitativeDocuments(
    [documentCandidate('previous-document', 'previous-event'), documentCandidate('current-document', 'current-event')],
    'current-event',
    'previous-event',
  )

  assert.deepEqual(selected.map(({ row, role }) => [row.id, role]), [
    ['current-document', 'current'],
    ['previous-document', 'previous'],
  ])
})

test('allows a current event when the previous event has no earnings release', () => {
  const selected = selectQualitativeDocuments(
    [documentCandidate('current-document', 'current-event')],
    'current-event',
    'previous-event',
  )

  assert.deepEqual(selected.map(({ role }) => role), ['current'])
})

test('rejects ambiguous current earnings releases', () => {
  assert.throws(
    () => selectQualitativeDocuments(
      [
        documentCandidate('current-document-1', 'current-event'),
        documentCandidate('current-document-2', 'current-event'),
      ],
      'current-event',
      null,
    ),
    /multiple readable Exhibit 99\.1 documents/,
  )
})

test('rejects readable text derived from a different source fingerprint', () => {
  const candidate = documentCandidate('current-document', 'current-event')
  const textVersion = candidate.document_text_versions as {
    source_content_sha256: string
  }
  textVersion.source_content_sha256 = 'different-source'

  assert.throws(
    () => selectQualitativeDocuments([candidate], 'current-event', null),
    /different source fingerprint/,
  )
})
