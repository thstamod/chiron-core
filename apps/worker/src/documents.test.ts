import assert from 'node:assert/strict'
import test from 'node:test'
import { parseEarningsReleaseExhibits } from './documents.js'

test('extracts only Exhibit 99.1 documents from an SEC filing index', () => {
  const html = `
    <table class="tableFile">
      <tr><th>Seq</th><th>Description</th><th>Document</th><th>Type</th></tr>
      <tr><td>1</td><td>Current report</td><td><a href="primary.htm">primary.htm</a></td><td>8-K</td></tr>
      <tr><td>2</td><td>Earnings release</td><td><a href="release.htm">release.htm</a></td><td>EX-99.1</td></tr>
      <tr><td>3</td><td>Other exhibit</td><td><a href="other.htm">other.htm</a></td><td>EX-99.2</td></tr>
    </table>
  `

  const exhibits = parseEarningsReleaseExhibits(
    html,
    'https://www.sec.gov/Archives/edgar/data/1/0001/0001-index.html',
  )

  assert.equal(exhibits.length, 1)
  assert.equal(exhibits[0]?.filename, 'release.htm')
  assert.equal(exhibits[0]?.sourceUrl, 'https://www.sec.gov/Archives/edgar/data/1/0001/release.htm')
  assert.equal(exhibits[0]?.documentType, 'sec-exhibit-99.1')
})
