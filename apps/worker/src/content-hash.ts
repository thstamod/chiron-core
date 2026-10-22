import { createHash } from 'node:crypto'
import { ContentHash } from './constants.js'

export function calculateContentSha256(content: Uint8Array): string {
  return createHash(ContentHash.algorithm)
    .update(content)
    .digest(ContentHash.outputEncoding)
}
