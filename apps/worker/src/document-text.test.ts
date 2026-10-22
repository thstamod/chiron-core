import assert from 'node:assert/strict'
import test from 'node:test'
import {
  decodeUtf8Text,
  documentTextExtractionVersion,
  documentTextVersionRecordsMatch,
  extractReadableTextFromHtml,
  type DocumentTextVersionRecord,
} from './document-text.js'

test('rejects invalid UTF-8 instead of silently replacing bytes', () => {
  assert.throws(
    () => decodeUtf8Text(new Uint8Array([0xc3, 0x28])),
    /encoded data was not valid/i,
  )
})

test('accepts only matching document-text metadata', () => {
  const expected: DocumentTextVersionRecord = {
    document_id: 'document-1',
    extraction_version: 'sec-html-text-v3',
    source_content_sha256: 'source-fingerprint',
    storage_path: 'derived-text/document-1/sec-html-text-v3/source-fingerprint.txt',
    content_sha256: 'text-fingerprint',
    content_size_bytes: 120,
    character_count: 115,
    line_count: 8,
  }

  assert.equal(documentTextVersionRecordsMatch(expected, { ...expected }), true)
  assert.equal(
    documentTextVersionRecordsMatch(expected, {
      ...expected,
      content_sha256: 'different-fingerprint',
    }),
    false,
  )
})

test('extracts readable text with stable paragraph and table boundaries', () => {
  const html = `
    <html>
      <head><title>Ignored browser title</title><style>.hidden { display: none; }</style></head>
      <body>
        <h1>Quarterly results</h1>
        <p>Revenue increased&nbsp;12%.</p>
        <table>
          <tr><th>Metric</th><th>Value</th></tr>
          <tr><td>Revenue</td><td>$10 billion</td></tr>
        </table>
        <p>Guidance was raised.<br>Demand remains strong.</p>
      </body>
    </html>
  `

  assert.equal(
    extractReadableTextFromHtml(html),
    [
      'Quarterly results',
      '',
      'Revenue increased 12%.',
      '',
      'Metric | Value',
      'Revenue | $10 billion',
      '',
      'Guidance was raised.',
      'Demand remains strong.',
    ].join('\n'),
  )
  assert.equal(documentTextExtractionVersion, 'sec-html-text-v3')
})

test('removes scripts and hidden inline XBRL content', () => {
  const html = `
    <body>
      <script>Never include this</script>
      <ix:hidden>Duplicate XBRL fact</ix:hidden>
      <div hidden>Hidden attribute</div>
      <div aria-hidden="true">Hidden for accessibility</div>
      <div style="DISPLAY: none">Hidden with inline style</div>
      <p>Visible filing text</p>
    </body>
  `

  assert.equal(extractReadableTextFromHtml(html), 'Visible filing text')
})

test('returns identical output for identical input', () => {
  const html = '<article><h2>Results</h2><p>Net income improved.</p></article>'

  assert.equal(
    extractReadableTextFromHtml(html),
    extractReadableTextFromHtml(html),
  )
})

test('preserves empty table cells so values do not shift between columns', () => {
  const html = `
    <table>
      <tr><th>Metric</th><th>2026</th><th>2025</th></tr>
      <tr><td>Operating margin</td><td></td><td>42%</td></tr>
      <tr><td></td><td></td><td></td></tr>
    </table>
  `

  assert.equal(
    extractReadableTextFromHtml(html),
    [
      'Metric | 2026 | 2025',
      'Operating margin | | 42%',
    ].join('\n'),
  )
})

test('keeps HTML-sensitive table text as readable text', () => {
  const html = `
    <table>
      <tr><td>Threshold</td><td>&lt; $10 billion &amp; improving</td></tr>
    </table>
  `

  assert.equal(
    extractReadableTextFromHtml(html),
    'Threshold | < $10 billion & improving',
  )
})
