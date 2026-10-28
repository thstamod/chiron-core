import {
  QualitativeEvidencePassageLimit,
  RuleVersion,
} from './constants.js'
import type { QualitativeSourceDocument } from './qualitative-extraction.js'

export const qualitativeEvidencePassageVersion = RuleVersion.qualitativeEvidencePassages

export interface QualitativeEvidencePassage {
  passageId: string
  sourceDocumentId: string
  documentRole: QualitativeSourceDocument['role']
  startCharacter: number
  endCharacter: number
  text: string
}

interface CharacterRange {
  startCharacter: number
  endCharacter: number
}

function splitOversizedRange(text: string, range: CharacterRange): CharacterRange[] {
  const ranges: CharacterRange[] = []
  let startCharacter = range.startCharacter

  while (
    range.endCharacter - startCharacter
    > QualitativeEvidencePassageLimit.maximumCharacters
  ) {
    const maximumEnd = startCharacter + QualitativeEvidencePassageLimit.maximumCharacters
    const lastLineBreak = text.lastIndexOf('\n', maximumEnd)
    const endCharacter = lastLineBreak > startCharacter ? lastLineBreak : maximumEnd
    ranges.push({ startCharacter, endCharacter })
    startCharacter = text[endCharacter] === '\n' ? endCharacter + 1 : endCharacter
  }

  if (startCharacter < range.endCharacter) {
    ranges.push({ startCharacter, endCharacter: range.endCharacter })
  }
  return ranges
}

function paragraphRanges(text: string): CharacterRange[] {
  const ranges: CharacterRange[] = []
  let paragraphStart = 0

  while (paragraphStart < text.length) {
    const separatorStart = text.indexOf('\n\n', paragraphStart)
    const paragraphEnd = separatorStart === -1 ? text.length : separatorStart
    if (paragraphEnd > paragraphStart) {
      ranges.push(...splitOversizedRange(text, {
        startCharacter: paragraphStart,
        endCharacter: paragraphEnd,
      }))
    }
    if (separatorStart === -1) break
    paragraphStart = separatorStart + 2
  }
  return ranges
}

export function createQualitativeEvidencePassages(
  documents: QualitativeSourceDocument[],
): QualitativeEvidencePassage[] {
  return documents.flatMap((document) => (
    paragraphRanges(document.text).map((range, index) => ({
      passageId: `${document.role}-p${String(index + 1).padStart(4, '0')}`,
      sourceDocumentId: document.documentId,
      documentRole: document.role,
      startCharacter: range.startCharacter,
      endCharacter: range.endCharacter,
      text: document.text.slice(range.startCharacter, range.endCharacter),
    }))
  ))
}
