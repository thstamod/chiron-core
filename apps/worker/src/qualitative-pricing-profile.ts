import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { z } from 'zod'
import type { QualitativePricingProfile } from './qualitative-quality-report.js'

const modelPricingSchema = z.object({
  ordinaryInputUsdPerMillionTokens: z.number().nonnegative().finite(),
  cachedInputUsdPerMillionTokens: z.number().nonnegative().finite(),
  cacheWriteUsdPerMillionTokens: z.number().nonnegative().finite(),
  outputUsdPerMillionTokens: z.number().nonnegative().finite(),
}).strict()

const pricingProfileSchema = z.object({
  name: z.string().trim().min(1).max(200),
  asOfDate: z.iso.date(),
  sourceUrl: z.url(),
  modelPricing: z.record(z.string().trim().min(1), modelPricingSchema).refine(
    (pricing) => Object.keys(pricing).length > 0,
    'At least one model price is required',
  ),
}).strict()

export function parseQualitativePricingProfile(value: unknown): QualitativePricingProfile {
  const result = pricingProfileSchema.safeParse(value)
  if (!result.success) {
    throw new Error(`Invalid qualitative pricing profile: ${z.prettifyError(result.error)}`)
  }
  return result.data
}

export async function loadQualitativePricingProfile(
  filePath: string,
): Promise<QualitativePricingProfile> {
  const absolutePath = resolve(filePath)
  let contents: string
  try {
    contents = await readFile(absolutePath, 'utf8')
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Could not read qualitative pricing profile ${absolutePath}: ${message}`)
  }

  try {
    return parseQualitativePricingProfile(JSON.parse(contents))
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Could not load qualitative pricing profile ${absolutePath}: ${message}`)
  }
}
