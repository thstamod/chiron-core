import type { SupabaseClient } from '@supabase/supabase-js'
import { load, type CheerioAPI } from 'cheerio'
import type { DocumentTextSource } from './database.js'
import { calculateContentSha256 } from './content-hash.js'
import { persistImmutableStorageObject } from './storage.js'
import {
  DatabaseTable,
  HtmlSelector,
  HtmlStyle,
  MimeType,
  ReadableText,
  RuleVersion,
  StorageConfig,
  TextEncoding,
} from './constants.js'

export const documentTextExtractionVersion = RuleVersion.documentTextExtraction

export interface DocumentTextVersionRecord {
  document_id: string
  extraction_version: string
  source_content_sha256: string
  storage_path: string
  content_sha256: string
  content_size_bytes: number
  character_count: number
  line_count: number
}

export function documentTextVersionRecordsMatch(
  expected: DocumentTextVersionRecord,
  stored: DocumentTextVersionRecord,
): boolean {
  return expected.document_id === stored.document_id
    && expected.extraction_version === stored.extraction_version
    && expected.source_content_sha256 === stored.source_content_sha256
    && expected.storage_path === stored.storage_path
    && expected.content_sha256 === stored.content_sha256
    && expected.content_size_bytes === Number(stored.content_size_bytes)
    && expected.character_count === Number(stored.character_count)
    && expected.line_count === Number(stored.line_count)
}

export function decodeUtf8Text(content: Uint8Array): string {
  return new TextDecoder(TextEncoding.utf8, { fatal: true }).decode(content)
}

function normalizeInlineText(value: string): string {
  return value
    .replace(/\u00a0/g, ' ')
    .replace(/[\t\f\v ]+/g, ' ')
    .replace(/\s*\n\s*/g, ' ')
    .trim()
}

function removeVisuallyHiddenElements($: CheerioAPI): void {
  $('[style]').each((_index, element) => {
    const normalizedStyle = ($(element).attr('style') ?? '')
      .replace(/\s+/g, '')
      .toLowerCase()

    if (
      normalizedStyle.includes(HtmlStyle.hiddenDisplay)
      || normalizedStyle.includes(HtmlStyle.hiddenVisibility)
    ) {
      $(element).remove()
    }
  })
}

function readableTableRows($: CheerioAPI, table: ReturnType<CheerioAPI>): string[] {
  const rows: string[] = []

  table.find(HtmlSelector.tableRow).each((_rowIndex, rowElement) => {
    if ($(rowElement).closest(HtmlSelector.table).get(0) !== table.get(0)) return

    const cells = $(rowElement)
      .children(HtmlSelector.tableCell)
      .map((_cellIndex, cellElement) => normalizeInlineText($(cellElement).text()))
      .get()

    if (cells.some((cell) => cell.length > 0)) {
      rows.push(cells.join(ReadableText.tableCellSeparator))
    }
  })

  return rows
}

function normalizeReadableText(value: string): string {
  const lines = value
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .split('\n')
    .map((line) => line.replace(/[\t\f\v ]+/g, ' ').trim())

  const normalizedLines: string[] = []
  let consecutiveBlankLines = 0

  for (const line of lines) {
    if (line.length === 0) {
      consecutiveBlankLines += 1
      if (consecutiveBlankLines > ReadableText.maximumPreservedBlankLines) continue
    } else {
      consecutiveBlankLines = 0
    }
    normalizedLines.push(line)
  }

  return normalizedLines.join('\n').trim()
}

export function extractReadableTextFromHtml(html: string): string {
  const $ = load(html)

  $(HtmlSelector.nonReadableContent).remove()
  removeVisuallyHiddenElements($)

  $(HtmlSelector.table).each((_index, tableElement) => {
    const table = $(tableElement)
    if (table.parents(HtmlSelector.table).length > 0) return

    const rows = readableTableRows($, table)
    table.empty().text(rows.join('\n'))
    table.before('\n')
    table.after('\n')
  })

  $(HtmlSelector.lineBreak).replaceWith('\n')
  $(HtmlSelector.block).each((_index, element) => {
    $(element).append('\n')
  })

  return normalizeReadableText($.root().text())
}

function supportsHtmlTextExtraction(storagePath: string): boolean {
  const normalizedPath = storagePath.toLowerCase()
  return normalizedPath.endsWith('.htm') || normalizedPath.endsWith('.html')
}

function buildDerivedTextStorageLocation(document: DocumentTextSource): {
  folder: string
  filename: string
  path: string
} {
  const folder = `${StorageConfig.derivedTextFolder}/${document.id}/${documentTextExtractionVersion}`
  const filename = `${document.contentSha256}.txt`
  return { folder, filename, path: `${folder}/${filename}` }
}

export async function extractAndStoreDocumentText(
  client: SupabaseClient,
  document: DocumentTextSource,
): Promise<boolean> {
  if (!supportsHtmlTextExtraction(document.storagePath)) return false

  const storageBucket = client.storage.from(StorageConfig.secDocumentsBucket)
  const { data: sourceDocumentFile, error: sourceDownloadError } = await storageBucket
    .download(document.storagePath)

  if (sourceDownloadError) {
    throw new Error(`Could not download source document ${document.id}: ${sourceDownloadError.message}`)
  }

  const sourceDocumentBytes = new Uint8Array(await sourceDocumentFile.arrayBuffer())
  if (calculateContentSha256(sourceDocumentBytes) !== document.contentSha256) {
    throw new Error(`Source document ${document.id} does not match its recorded fingerprint`)
  }

  let sourceDocumentHtml: string
  try {
    sourceDocumentHtml = decodeUtf8Text(sourceDocumentBytes)
  } catch {
    throw new Error(`Source document ${document.id} is not valid UTF-8`)
  }

  const readableText = extractReadableTextFromHtml(sourceDocumentHtml)
  if (readableText.length === 0) {
    throw new Error(`Text extraction produced no readable content for document ${document.id}`)
  }

  const readableTextBytes = new TextEncoder().encode(readableText)
  const readableTextSha256 = calculateContentSha256(readableTextBytes)
  const derivedTextStorageLocation = buildDerivedTextStorageLocation(document)
  await persistImmutableStorageObject({
    storageObjectExists: async () => {
      const { data: storedObjects, error: storageListError } = await storageBucket.list(
        derivedTextStorageLocation.folder,
        {
          limit: StorageConfig.objectSearchLimit,
          search: derivedTextStorageLocation.filename,
        },
      )

      if (storageListError) {
        throw new Error(`Could not check extracted text for document ${document.id}: ${storageListError.message}`)
      }

      return storedObjects.some(
        ({ name }) => name === derivedTextStorageLocation.filename,
      )
    },
    verifyExistingStorageObject: async () => {
      const {
        data: storedReadableTextFile,
        error: storedReadableTextError,
      } = await storageBucket.download(derivedTextStorageLocation.path)
      if (storedReadableTextError) {
        throw new Error(`Could not verify extracted text for document ${document.id}: ${storedReadableTextError.message}`)
      }

      const storedReadableTextBytes = new Uint8Array(
        await storedReadableTextFile.arrayBuffer(),
      )
      if (calculateContentSha256(storedReadableTextBytes) !== readableTextSha256) {
        throw new Error(`Stored extracted text does not match document ${document.id}`)
      }
    },
    uploadNewStorageObject: async () => {
      const { error: uploadError } = await storageBucket.upload(
        derivedTextStorageLocation.path,
        readableTextBytes,
        {
          contentType: `${MimeType.plainText}; charset=${TextEncoding.utf8}`,
          upsert: false,
        },
      )
      if (uploadError) {
        throw new Error(`Could not store extracted text for document ${document.id}: ${uploadError.message}`)
      }
    },
  })

  const documentTextVersionRecord: DocumentTextVersionRecord = {
    document_id: document.id,
    extraction_version: documentTextExtractionVersion,
    source_content_sha256: document.contentSha256,
    storage_path: derivedTextStorageLocation.path,
    content_sha256: readableTextSha256,
    content_size_bytes: readableTextBytes.byteLength,
    character_count: readableText.length,
    line_count: readableText.split('\n').length,
  }

  const { error: textVersionUpsertError } = await client
    .from(DatabaseTable.documentTextVersions)
    .upsert(
      documentTextVersionRecord,
      {
        onConflict: 'storage_path',
        ignoreDuplicates: true,
      },
    )

  if (textVersionUpsertError) {
    throw new Error(`Could not record extracted text for document ${document.id}: ${textVersionUpsertError.message}`)
  }

  const { data: storedTextVersion, error: textVersionVerificationError } = await client
    .from(DatabaseTable.documentTextVersions)
    .select(`
      document_id,
      extraction_version,
      source_content_sha256,
      storage_path,
      content_sha256,
      content_size_bytes,
      character_count,
      line_count
    `)
    .eq('storage_path', derivedTextStorageLocation.path)
    .single()

  if (textVersionVerificationError) {
    throw new Error(`Could not verify extracted-text metadata for document ${document.id}: ${textVersionVerificationError.message}`)
  }

  if (!documentTextVersionRecordsMatch(
    documentTextVersionRecord,
    storedTextVersion as DocumentTextVersionRecord,
  )) {
    throw new Error(`Stored extracted-text metadata does not match document ${document.id}`)
  }

  return true
}
