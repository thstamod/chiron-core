import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { SecFilingRecord } from '@chiron/shared'
import { buildSecPrimaryDocumentUrl } from './sec.js'

const storageBucket = 'sec-documents'
const documentType = 'sec-primary-document'
const maximumDocumentBytes = 50 * 1024 * 1024

function contentTypeFor(filename: string): string {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.htm') || lower.endsWith('.html')) return 'text/html'
  if (lower.endsWith('.xml') || lower.endsWith('.xbrl')) return 'application/xml'
  if (lower.endsWith('.json')) return 'application/json'
  return 'text/plain'
}

function storagePathFor(filing: SecFilingRecord): string {
  const safeDocumentName = filing.primaryDocument.split('/').at(-1) ?? 'primary-document.txt'
  return `${filing.ticker}/${filing.accessionNumber}/${safeDocumentName}`
}

export async function downloadAndStorePrimaryDocument(
  client: SupabaseClient,
  filing: SecFilingRecord,
  secUserAgent: string,
): Promise<void> {
  if (!filing.primaryDocument) {
    throw new Error(`${filing.accessionNumber} has no primary SEC document`)
  }

  const sourceUrl = buildSecPrimaryDocumentUrl(
    filing.cik,
    filing.accessionNumber,
    filing.primaryDocument,
  )
  const response = await fetch(sourceUrl, {
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml,text/plain',
      'Accept-Encoding': 'gzip, deflate',
      'User-Agent': secUserAgent,
    },
    signal: AbortSignal.timeout(30_000),
  })

  if (!response.ok) {
    throw new Error(`SEC document request failed with HTTP ${response.status}: ${sourceUrl}`)
  }

  const body = new Uint8Array(await response.arrayBuffer())
  if (body.byteLength > maximumDocumentBytes) {
    throw new Error(`${filing.accessionNumber} exceeds the 50 MB document limit`)
  }

  const contentSha256 = createHash('sha256').update(body).digest('hex')
  const storagePath = storagePathFor(filing)
  const { error: uploadError } = await client.storage
    .from(storageBucket)
    .upload(storagePath, body, {
      contentType: response.headers.get('content-type') ?? contentTypeFor(filing.primaryDocument),
      upsert: true,
    })

  if (uploadError) {
    throw new Error(`Could not store ${filing.accessionNumber}: ${uploadError.message}`)
  }

  const { error: insertError } = await client.from('documents').insert({
    filing_id: filing.id,
    accession_number: filing.accessionNumber,
    document_type: documentType,
    source_url: sourceUrl,
    storage_path: storagePath,
    published_at: filing.acceptedAt ?? filing.firstSeenAt,
    first_seen_at: filing.firstSeenAt,
    content_sha256: contentSha256,
  })

  if (insertError) {
    throw new Error(`Could not record ${filing.accessionNumber}: ${insertError.message}`)
  }
}
