import type { SupabaseClient } from '@supabase/supabase-js'
import {
  DatabaseTable,
  SecDocumentType,
  StorageConfig,
} from './constants.js'
import { calculateContentSha256 } from './content-hash.js'
import {
  decodeUtf8Text,
  documentTextExtractionVersion,
} from './document-text.js'
import {
  prepareQualitativeExtractionInput,
  type PreparedQualitativeExtractionInput,
  type QualitativeDocumentRole,
  type QualitativeSourceDocument,
} from './qualitative-extraction.js'

interface QualitativeEventRow {
  id: string
  previous_event_id: string | null
}

interface QualitativeDocumentTextVersionRow {
  extraction_version: string
  source_content_sha256: string
  storage_path: string
  content_sha256: string
}

export interface QualitativeDocumentCandidateRow {
  id: string
  earnings_event_id: string
  document_type: string
  published_at: string
  first_seen_at: string
  content_sha256: string
  document_text_versions:
    | QualitativeDocumentTextVersionRow
    | QualitativeDocumentTextVersionRow[]
}

export interface SelectedQualitativeDocument {
  row: QualitativeDocumentCandidateRow
  role: QualitativeDocumentRole
  textVersion: QualitativeDocumentTextVersionRow
}

function singleTextVersion(
  document: QualitativeDocumentCandidateRow,
): QualitativeDocumentTextVersionRow {
  const versions = Array.isArray(document.document_text_versions)
    ? document.document_text_versions
    : [document.document_text_versions]
  if (versions.length !== 1 || !versions[0]) {
    throw new Error(
      `Qualitative document ${document.id} requires exactly one current readable-text version`,
    )
  }
  return versions[0]
}

function selectOneDocument(
  candidates: QualitativeDocumentCandidateRow[],
  eventId: string,
  role: QualitativeDocumentRole,
  required: boolean,
): SelectedQualitativeDocument | null {
  const eventCandidates = candidates.filter((candidate) => candidate.earnings_event_id === eventId)
  if (eventCandidates.length === 0) {
    if (required) {
      throw new Error(`Earnings event ${eventId} has no readable Exhibit 99.1 document`)
    }
    return null
  }
  if (eventCandidates.length > 1) {
    throw new Error(
      `Earnings event ${eventId} has multiple readable Exhibit 99.1 documents; `
      + 'manual source selection is required',
    )
  }

  const row = eventCandidates[0]!
  const textVersion = singleTextVersion(row)
  if (textVersion.source_content_sha256 !== row.content_sha256) {
    throw new Error(`Readable text for document ${row.id} came from a different source fingerprint`)
  }
  return { row, role, textVersion }
}

export function selectQualitativeDocuments(
  candidates: QualitativeDocumentCandidateRow[],
  currentEventId: string,
  previousEventId: string | null,
): SelectedQualitativeDocument[] {
  const current = selectOneDocument(candidates, currentEventId, 'current', true)!
  const previous = previousEventId
    ? selectOneDocument(candidates, previousEventId, 'previous', false)
    : null
  return previous ? [current, previous] : [current]
}

async function downloadReadableText(
  client: SupabaseClient,
  selected: SelectedQualitativeDocument,
): Promise<QualitativeSourceDocument> {
  const { row, role, textVersion } = selected
  const { data, error } = await client.storage
    .from(StorageConfig.secDocumentsBucket)
    .download(textVersion.storage_path)
  if (error) {
    throw new Error(`Could not download readable text for document ${row.id}: ${error.message}`)
  }

  const bytes = new Uint8Array(await data.arrayBuffer())
  if (calculateContentSha256(bytes) !== textVersion.content_sha256) {
    throw new Error(`Readable text for document ${row.id} does not match its fingerprint`)
  }

  let text: string
  try {
    text = decodeUtf8Text(bytes)
  } catch {
    throw new Error(`Readable text for document ${row.id} is not valid UTF-8`)
  }

  return {
    documentId: row.id,
    role,
    documentType: row.document_type,
    publishedAt: row.published_at,
    firstSeenAt: row.first_seen_at,
    sourceContentSha256: row.content_sha256,
    textExtractionVersion: textVersion.extraction_version,
    textContentSha256: textVersion.content_sha256,
    text,
  }
}

export async function loadPreparedQualitativeExtractionInput(
  client: SupabaseClient,
  earningsEventId: string,
  cutoffAt: string,
): Promise<PreparedQualitativeExtractionInput> {
  const { data: eventData, error: eventError } = await client
    .from(DatabaseTable.earningsEvents)
    .select('id,previous_event_id')
    .eq('id', earningsEventId)
    .single()
  if (eventError) {
    throw new Error(`Could not load earnings event ${earningsEventId}: ${eventError.message}`)
  }

  const event = eventData as QualitativeEventRow
  const eventIds = [event.id, event.previous_event_id].filter(
    (eventId): eventId is string => Boolean(eventId),
  )
  const { data: documentData, error: documentError } = await client
    .from(DatabaseTable.documents)
    .select(`
      id,
      earnings_event_id,
      document_type,
      published_at,
      first_seen_at,
      content_sha256,
      document_text_versions!inner(
        extraction_version,
        source_content_sha256,
        storage_path,
        content_sha256
      )
    `)
    .in('earnings_event_id', eventIds)
    .eq('document_type', SecDocumentType.earningsExhibit)
    .lte('published_at', cutoffAt)
    .lte('first_seen_at', cutoffAt)
    .eq('document_text_versions.extraction_version', documentTextExtractionVersion)
    .order('published_at')
    .order('id')
  if (documentError) {
    throw new Error(`Could not load qualitative source documents: ${documentError.message}`)
  }

  const selectedDocuments = selectQualitativeDocuments(
    documentData as unknown as QualitativeDocumentCandidateRow[],
    event.id,
    event.previous_event_id,
  )
  const sourceDocuments: QualitativeSourceDocument[] = []
  for (const selectedDocument of selectedDocuments) {
    sourceDocuments.push(await downloadReadableText(client, selectedDocument))
  }

  return prepareQualitativeExtractionInput(earningsEventId, cutoffAt, sourceDocuments)
}
