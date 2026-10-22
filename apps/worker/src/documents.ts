import type { SupabaseClient } from '@supabase/supabase-js'
import { load } from 'cheerio'
import type { SecFilingRecord } from '@chiron/shared'
import {
  DatabaseTable,
  MimeType,
  RuleVersion,
  SecDocumentType,
  type SecDocumentTypeValue,
  SecRequest,
  SecUrl,
  StorageConfig,
} from './constants.js'
import { buildSecPrimaryDocumentUrl } from './sec.js'
import { fetchSecResource } from './sec-request.js'
import { calculateContentSha256 } from './content-hash.js'
import {
  persistImmutableStorageObject,
  type ImmutableStorageObjectActions,
} from './storage.js'

export const exhibitDiscoveryRuleVersion = RuleVersion.exhibitDiscovery

export interface SecDocumentCandidate {
  documentType: SecDocumentTypeValue
  filename: string
  sourceUrl: string
  description: string | null
}

export interface SecDocumentPersistenceActions extends ImmutableStorageObjectActions {
  insertDocumentRecord: () => Promise<void>
}

export async function persistDownloadedSecDocument(
  actions: SecDocumentPersistenceActions,
): Promise<void> {
  await persistImmutableStorageObject(actions)

  await actions.insertDocumentRecord()
}

function contentTypeFor(filename: string): string {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.htm') || lower.endsWith('.html')) return MimeType.html
  if (lower.endsWith('.xml') || lower.endsWith('.xbrl')) return MimeType.xml
  if (lower.endsWith('.json')) return MimeType.json
  return MimeType.plainText
}

function storagePathFor(filing: SecFilingRecord, filename: string): string {
  const safeDocumentName = filename.split('/').at(-1) ?? StorageConfig.fallbackDocumentName
  return `${filing.ticker}/${filing.accessionNumber}/${safeDocumentName}`
}

function storageFolderFor(filing: SecFilingRecord): string {
  return `${filing.ticker}/${filing.accessionNumber}`
}

export function storageListingContainsDocument(
  storedObjects: Array<{ name: string }>,
  documentName: string,
): boolean {
  return storedObjects.some((storedObject) => storedObject.name === documentName)
}

function normalizeSecDocumentUrl(href: string, indexUrl: string): string {
  const url = new URL(href, indexUrl)
  const inlineDocument = url.searchParams.get(SecRequest.inlineDocumentParameter)
  if (inlineDocument?.startsWith(SecRequest.archivePathPrefix)) {
    return new URL(inlineDocument, SecUrl.websiteBase).toString()
  }
  return url.toString()
}

export function parseEarningsReleaseExhibits(
  html: string,
  indexUrl: string,
): SecDocumentCandidate[] {
  const $ = load(html)
  const candidates: SecDocumentCandidate[] = []

  $(SecRequest.filingTableRowsSelector).each((_index, row) => {
    const cells = $(row).find('td')
    if (cells.length < 4) return

    const type = $(cells[3]).text().trim().toUpperCase()
    if (!SecRequest.exhibitTypePattern.test(type)) return

    const link = $(cells[2]).find('a').first()
    const href = link.attr('href')
    const filename = link.text().trim()
    if (!href || !filename) return

    candidates.push({
      documentType: SecDocumentType.earningsExhibit,
      filename,
      sourceUrl: normalizeSecDocumentUrl(href, indexUrl),
      description: $(cells[1]).text().trim() || null,
    })
  })

  return candidates
}

export async function fetchEarningsReleaseExhibits(
  filing: SecFilingRecord,
  secUserAgent: string,
): Promise<SecDocumentCandidate[]> {
  const response = await fetchSecResource({
    url: filing.secIndexUrl,
    headers: {
      Accept: SecRequest.indexAccept,
      'Accept-Encoding': SecRequest.acceptedEncoding,
      'User-Agent': secUserAgent,
    },
  })

  if (!response.ok) {
    throw new Error(`SEC filing-index request failed with HTTP ${response.status}`)
  }

  return parseEarningsReleaseExhibits(await response.text(), filing.secIndexUrl)
}

export function primaryDocumentCandidate(filing: SecFilingRecord): SecDocumentCandidate {
  if (!filing.primaryDocument) {
    throw new Error(`${filing.accessionNumber} has no primary SEC document`)
  }

  return {
    documentType: SecDocumentType.primary,
    filename: filing.primaryDocument,
    sourceUrl: buildSecPrimaryDocumentUrl(
      filing.cik,
      filing.accessionNumber,
      filing.primaryDocument,
    ),
    description: null,
  }
}

export async function downloadAndStoreDocument(
  client: SupabaseClient,
  filing: SecFilingRecord,
  candidate: SecDocumentCandidate,
  secUserAgent: string,
): Promise<void> {
  const response = await fetchSecResource({
    url: candidate.sourceUrl,
    headers: {
      Accept: SecRequest.documentAccept,
      'Accept-Encoding': SecRequest.acceptedEncoding,
      'User-Agent': secUserAgent,
    },
  })

  if (!response.ok) {
    throw new Error(`SEC document request failed with HTTP ${response.status}: ${candidate.sourceUrl}`)
  }

  const body = new Uint8Array(await response.arrayBuffer())
  if (body.byteLength > StorageConfig.maximumDocumentBytes) {
    throw new Error(`${candidate.filename} exceeds the 50 MB document limit`)
  }

  const contentSha256 = calculateContentSha256(body)
  const storagePath = storagePathFor(filing, candidate.filename)
  const storageFolder = storageFolderFor(filing)
  const storageDocumentName = storagePath.split('/').at(-1) ?? StorageConfig.fallbackDocumentName
  const storageBucket = client.storage.from(StorageConfig.secDocumentsBucket)

  await persistDownloadedSecDocument({
    storageObjectExists: async () => {
      const { data: storedObjects, error } = await storageBucket.list(storageFolder, {
        limit: StorageConfig.objectSearchLimit,
        search: storageDocumentName,
      })
      if (error) {
        throw new Error(`Could not check stored ${candidate.filename}: ${error.message}`)
      }
      return storageListingContainsDocument(storedObjects, storageDocumentName)
    },
    verifyExistingStorageObject: async () => {
      const { data: storedDocument, error } = await storageBucket.download(storagePath)
      if (error) {
        throw new Error(`Could not verify stored ${candidate.filename}: ${error.message}`)
      }

      const storedBody = new Uint8Array(await storedDocument.arrayBuffer())
      if (calculateContentSha256(storedBody) !== contentSha256) {
        throw new Error(`Stored ${candidate.filename} does not match the SEC document`)
      }
    },
    uploadNewStorageObject: async () => {
      const { error } = await storageBucket.upload(storagePath, body, {
        contentType: response.headers.get('content-type') ?? contentTypeFor(candidate.filename),
        upsert: false,
      })
      if (error) {
        throw new Error(`Could not store ${candidate.filename}: ${error.message}`)
      }
    },
    insertDocumentRecord: async () => {
      const { error } = await client.from(DatabaseTable.documents).insert({
        earnings_event_id: filing.earningsEventId,
        filing_id: filing.id,
        accession_number: filing.accessionNumber,
        document_type: candidate.documentType,
        source_url: candidate.sourceUrl,
        storage_path: storagePath,
        published_at: filing.acceptedAt ?? filing.firstSeenAt,
        first_seen_at: filing.firstSeenAt,
        content_sha256: contentSha256,
        content_size_bytes: body.byteLength,
      })

      if (error) {
        throw new Error(`Could not record ${candidate.filename}: ${error.message}`)
      }
    },
  })
}
