import assert from 'node:assert/strict'
import test from 'node:test'
import { calculateContentSha256 } from './content-hash.js'
import { QualitativeEvidencePassageLimit } from './constants.js'
import { createQualitativeEvidencePassages } from './qualitative-evidence-passages.js'
import type { QualitativeSourceDocument } from './qualitative-extraction.js'

function sourceDocument(
  role: QualitativeSourceDocument['role'],
  text: string,
): QualitativeSourceDocument {
  return {
    documentId: role === 'current'
      ? '11111111-1111-4111-8111-111111111111'
      : '22222222-2222-4222-8222-222222222222',
    role,
    documentType: 'sec-exhibit-99.1',
    publishedAt: '2026-10-20T20:00:00.000Z',
    firstSeenAt: '2026-10-20T20:05:00.000Z',
    sourceContentSha256: `${role}-source`,
    textExtractionVersion: 'sec-html-text-v3',
    textContentSha256: calculateContentSha256(new TextEncoder().encode(text)),
    text,
  }
}

test('creates stable passage IDs and exact source ranges', () => {
  const text = 'First paragraph.\n\nSecond paragraph.'
  const passages = createQualitativeEvidencePassages([sourceDocument('current', text)])

  assert.deepEqual(passages.map(({ passageId, text: passageText }) => (
    [passageId, passageText]
  )), [
    ['current-p0001', 'First paragraph.'],
    ['current-p0002', 'Second paragraph.'],
  ])
  for (const passage of passages) {
    assert.equal(
      text.slice(passage.startCharacter, passage.endCharacter),
      passage.text,
    )
  }
})

test('splits oversized passages at the configured maximum', () => {
  const text = 'A'.repeat(QualitativeEvidencePassageLimit.maximumCharacters + 1)
  const passages = createQualitativeEvidencePassages([sourceDocument('current', text)])

  assert.equal(passages.length, 2)
  assert.equal(passages[0]?.text.length, QualitativeEvidencePassageLimit.maximumCharacters)
  assert.equal(passages[1]?.text, 'A')
})

test('uses separate current and previous passage namespaces', () => {
  const passages = createQualitativeEvidencePassages([
    sourceDocument('current', 'Current text.'),
    sourceDocument('previous', 'Previous text.'),
  ])

  assert.deepEqual(passages.map(({ passageId }) => passageId), [
    'current-p0001',
    'previous-p0001',
  ])
})
