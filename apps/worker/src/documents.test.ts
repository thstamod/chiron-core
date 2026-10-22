import assert from 'node:assert/strict'
import test from 'node:test'
import {
  parseEarningsReleaseExhibits,
  persistDownloadedSecDocument,
  storageListingContainsDocument,
  type SecDocumentPersistenceActions,
} from './documents.js'

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

test('matches only the exact document name in a storage folder listing', () => {
  const storedObjects = [
    { name: 'meta-20260930.htm.backup' },
    { name: 'meta-20260930.htm' },
  ]

  assert.equal(
    storageListingContainsDocument(storedObjects, 'meta-20260930.htm'),
    true,
  )
  assert.equal(
    storageListingContainsDocument(storedObjects, 'meta-20260630.htm'),
    false,
  )
})

test('reuses a verified storage object when retrying a failed database insert', async () => {
  const completedSteps: string[] = []
  let storageObjectExists = false
  let documentInsertAttempts = 0

  const actions: SecDocumentPersistenceActions = {
    storageObjectExists: async () => {
      completedSteps.push('check storage object')
      return storageObjectExists
    },
    verifyExistingStorageObject: async () => {
      completedSteps.push('verify storage object')
    },
    uploadNewStorageObject: async () => {
      completedSteps.push('upload storage object')
      storageObjectExists = true
    },
    insertDocumentRecord: async () => {
      completedSteps.push('insert document record')
      documentInsertAttempts += 1
      if (documentInsertAttempts === 1) throw new Error('database insert failed')
    },
  }

  await assert.rejects(persistDownloadedSecDocument(actions), /database insert failed/)
  await persistDownloadedSecDocument(actions)

  assert.deepEqual(completedSteps, [
    'check storage object',
    'upload storage object',
    'insert document record',
    'check storage object',
    'verify storage object',
    'insert document record',
  ])
})

test('does not insert a document record when storage verification fails', async () => {
  let documentRecordInserted = false

  await assert.rejects(
    persistDownloadedSecDocument({
      storageObjectExists: async () => true,
      verifyExistingStorageObject: async () => {
        throw new Error('stored content does not match')
      },
      uploadNewStorageObject: async () => {},
      insertDocumentRecord: async () => {
        documentRecordInserted = true
      },
    }),
    /stored content does not match/,
  )

  assert.equal(documentRecordInserted, false)
})
