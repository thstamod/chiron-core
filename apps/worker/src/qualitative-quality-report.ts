import type { ComparableQualitativeExtraction } from '@chiron/shared'
import { canonicalJson } from './canonical-json.js'
import {
  QualitativeProviderStatus,
  QualitativeReviewDecision,
  QualitativeValidationStatus,
} from './constants.js'
import type { QualitativeProviderTokenUsage } from './qualitative-provider.js'

export const QualitativeQualityField = {
  guidance: 'guidance',
  marginDirection: 'marginDirection',
  managementTone: 'managementTone',
  keyPositives: 'keyPositives',
  keyRisks: 'keyRisks',
} as const

type QualitativeQualityFieldValue =
  typeof QualitativeQualityField[keyof typeof QualitativeQualityField]

export interface QualitativeQualityReview {
  decision:
    | typeof QualitativeReviewDecision.accepted
    | typeof QualitativeReviewDecision.corrected
    | typeof QualitativeReviewDecision.rejected
  correctedOutput: ComparableQualitativeExtraction | null
}

export interface QualitativeQualityRun {
  id: string
  earningsEventId: string
  inputFingerprint: string
  schemaVersion: string
  promptVersion: string
  requestedModel: string
  resolvedModel: string | null
  providerStatus: string
  validationStatus: string | null
  durationMilliseconds: number
  tokenUsage: QualitativeProviderTokenUsage
  output: ComparableQualitativeExtraction | null
  outputFingerprint: string | null
  latestReview: QualitativeQualityReview | null
}

export interface QualitativeModelPricing {
  ordinaryInputUsdPerMillionTokens: number
  cachedInputUsdPerMillionTokens: number
  cacheWriteUsdPerMillionTokens: number
  outputUsdPerMillionTokens: number
}

export interface QualitativePricingProfile {
  name: string
  asOfDate: string
  sourceUrl: string
  modelPricing: Record<string, QualitativeModelPricing>
}

interface AgreementMetric {
  agreeingRuns: number
  eligibleRuns: number
  agreementRate: number | null
}

interface TokenTotals {
  inputTokens: number
  cachedInputTokens: number
  cacheWriteTokens: number
  outputTokens: number
  reasoningTokens: number
  totalTokens: number
}

export interface QualitativeQualityReport {
  sample: {
    totalRuns: number
    providerStatusCounts: Record<string, number>
    modelCounts: Record<string, number>
    promptVersionCounts: Record<string, number>
    schemaVersionCounts: Record<string, number>
    latestReviewCounts: {
      accepted: number
      corrected: number
      rejected: number
      unreviewed: number
    }
  }
  technicalQuality: {
    schema: {
      validRuns: number
      invalidRuns: number
      assessedRuns: number
      validityRate: number | null
    }
    evidence: {
      validRuns: number
      invalidRuns: number
      assessedRuns: number
      validityRate: number | null
    }
  }
  humanReview: {
    referenceRuns: number
    correctionFrequency: number | null
    exactOutputAgreement: AgreementMetric
    fieldAgreement: Record<QualitativeQualityFieldValue, AgreementMetric>
  }
  consistency: {
    repeatedConfigurationGroups: number
    exactMatchGroups: number
    exactMatchRate: number | null
  }
  efficiency: {
    latency: {
      averageMilliseconds: number | null
      maximumMilliseconds: number | null
    }
    tokens: {
      totalsFromCompleteRuns: TokenTotals
      runsWithCompleteUsage: number
      runsWithIncompleteUsage: number
    }
    estimatedCost: {
      pricingProfile: Omit<QualitativePricingProfile, 'modelPricing'> | null
      pricedRuns: number
      unpricedRuns: number
      totalUsd: number | null
    }
  }
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator
}

function incrementCount(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1
}

function sameJson(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right)
}

function referenceOutput(run: QualitativeQualityRun): ComparableQualitativeExtraction | null {
  if (run.latestReview?.decision === QualitativeReviewDecision.accepted) {
    if (run.output === null) {
      throw new Error(`Accepted extraction run ${run.id} has no original output`)
    }
    return run.output
  }
  if (run.latestReview?.decision === QualitativeReviewDecision.corrected) {
    if (run.output === null) {
      throw new Error(`Corrected extraction run ${run.id} has no original output`)
    }
    if (run.latestReview.correctedOutput === null) {
      throw new Error(`Corrected extraction run ${run.id} has no corrected output`)
    }
    return run.latestReview.correctedOutput
  }
  return null
}

function agreementMetric(agreeingRuns: number, eligibleRuns: number): AgreementMetric {
  return {
    agreeingRuns,
    eligibleRuns,
    agreementRate: ratio(agreeingRuns, eligibleRuns),
  }
}

function calculateHumanReviewMetrics(
  runs: QualitativeQualityRun[],
): QualitativeQualityReport['humanReview'] {
  const eligibleRuns = runs.flatMap((run) => {
    const reference = referenceOutput(run)
    return reference
      ? [{ original: run.output as ComparableQualitativeExtraction, reference }]
      : []
  })
  const fieldMatches: Record<QualitativeQualityFieldValue, number> = {
    guidance: 0,
    marginDirection: 0,
    managementTone: 0,
    keyPositives: 0,
    keyRisks: 0,
  }
  let exactOutputMatches = 0

  for (const { original, reference } of eligibleRuns) {
    if (sameJson(original, reference)) exactOutputMatches += 1
    for (const field of Object.values(QualitativeQualityField)) {
      if (sameJson(original[field], reference[field])) fieldMatches[field] += 1
    }
  }

  const correctedRuns = runs.filter(
    (run) => run.latestReview?.decision === QualitativeReviewDecision.corrected,
  ).length
  const referenceRuns = eligibleRuns.length

  return {
    referenceRuns,
    correctionFrequency: ratio(correctedRuns, referenceRuns),
    exactOutputAgreement: agreementMetric(exactOutputMatches, referenceRuns),
    fieldAgreement: {
      guidance: agreementMetric(fieldMatches.guidance, referenceRuns),
      marginDirection: agreementMetric(fieldMatches.marginDirection, referenceRuns),
      managementTone: agreementMetric(fieldMatches.managementTone, referenceRuns),
      keyPositives: agreementMetric(fieldMatches.keyPositives, referenceRuns),
      keyRisks: agreementMetric(fieldMatches.keyRisks, referenceRuns),
    },
  }
}

function consistencyKey(run: QualitativeQualityRun): string {
  return canonicalJson({
    earningsEventId: run.earningsEventId,
    inputFingerprint: run.inputFingerprint,
    schemaVersion: run.schemaVersion,
    promptVersion: run.promptVersion,
    model: run.resolvedModel ?? run.requestedModel,
  })
}

function calculateConsistencyMetrics(
  runs: QualitativeQualityRun[],
): QualitativeQualityReport['consistency'] {
  const groups = new Map<string, { runCount: number; fingerprints: Set<string> }>()
  for (const run of runs) {
    if (
      run.providerStatus !== QualitativeProviderStatus.completed
      || run.outputFingerprint === null
    ) continue
    const key = consistencyKey(run)
    const group = groups.get(key) ?? { runCount: 0, fingerprints: new Set<string>() }
    group.runCount += 1
    group.fingerprints.add(run.outputFingerprint)
    groups.set(key, group)
  }

  const repeatedGroups = [...groups.values()].filter((group) => group.runCount >= 2)
  const exactMatchGroups = repeatedGroups.filter((group) => (
    group.fingerprints.size === 1
  )).length

  return {
    repeatedConfigurationGroups: repeatedGroups.length,
    exactMatchGroups,
    exactMatchRate: ratio(exactMatchGroups, repeatedGroups.length),
  }
}

function emptyTokenTotals(): TokenTotals {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
  }
}

function validateAndCheckCompleteUsage(
  usage: QualitativeProviderTokenUsage,
  extractionRunId: string,
): usage is Record<keyof QualitativeProviderTokenUsage, number> {
  let isComplete = true
  for (const [tokenCategory, value] of Object.entries(usage)) {
    if (value === null) {
      isComplete = false
      continue
    }
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(
        `Extraction run ${extractionRunId} has invalid ${tokenCategory}`,
      )
    }
  }
  return isComplete
}

function validatePrice(value: number, description: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${description} must be a non-negative finite number`)
  }
}

function calculateRunCost(
  run: QualitativeQualityRun,
  profile: QualitativePricingProfile,
): number | null {
  if (!validateAndCheckCompleteUsage(run.tokenUsage, run.id)) return null
  const model = run.resolvedModel ?? run.requestedModel
  const pricing = profile.modelPricing[model]
  if (!pricing) return null

  validatePrice(pricing.ordinaryInputUsdPerMillionTokens, 'Ordinary input price')
  validatePrice(pricing.cachedInputUsdPerMillionTokens, 'Cached input price')
  validatePrice(pricing.cacheWriteUsdPerMillionTokens, 'Cache-write price')
  validatePrice(pricing.outputUsdPerMillionTokens, 'Output price')

  const ordinaryInputTokens = run.tokenUsage.inputTokens
    - run.tokenUsage.cachedInputTokens
    - run.tokenUsage.cacheWriteTokens
  if (ordinaryInputTokens < 0) {
    throw new Error(`Extraction run ${run.id} has inconsistent input-token categories`)
  }

  const inputCost = (
    ordinaryInputTokens * pricing.ordinaryInputUsdPerMillionTokens
    + run.tokenUsage.cachedInputTokens * pricing.cachedInputUsdPerMillionTokens
    + run.tokenUsage.cacheWriteTokens * pricing.cacheWriteUsdPerMillionTokens
  ) / 1_000_000
  const outputCost = (
    run.tokenUsage.outputTokens * pricing.outputUsdPerMillionTokens
  ) / 1_000_000
  return inputCost + outputCost
}

function calculateEfficiencyMetrics(
  runs: QualitativeQualityRun[],
  pricingProfile?: QualitativePricingProfile,
): QualitativeQualityReport['efficiency'] {
  const tokenTotals = emptyTokenTotals()
  let runsWithCompleteUsage = 0
  let totalCost = 0
  let pricedRuns = 0

  for (const run of runs) {
    if (run.durationMilliseconds < 0 || !Number.isFinite(run.durationMilliseconds)) {
      throw new Error(`Extraction run ${run.id} has an invalid duration`)
    }
    if (validateAndCheckCompleteUsage(run.tokenUsage, run.id)) {
      runsWithCompleteUsage += 1
      for (const key of Object.keys(tokenTotals) as Array<keyof TokenTotals>) {
        tokenTotals[key] += run.tokenUsage[key]
      }
    }
    if (pricingProfile) {
      const runCost = calculateRunCost(run, pricingProfile)
      if (runCost !== null) {
        totalCost += runCost
        pricedRuns += 1
      }
    }
  }

  const durations = runs.map((run) => run.durationMilliseconds)
  const profileMetadata = pricingProfile
    ? {
      name: pricingProfile.name,
      asOfDate: pricingProfile.asOfDate,
      sourceUrl: pricingProfile.sourceUrl,
    }
    : null

  return {
    latency: {
      averageMilliseconds: durations.length
        ? durations.reduce((sum, duration) => sum + duration, 0) / durations.length
        : null,
      maximumMilliseconds: durations.length ? Math.max(...durations) : null,
    },
    tokens: {
      totalsFromCompleteRuns: tokenTotals,
      runsWithCompleteUsage,
      runsWithIncompleteUsage: runs.length - runsWithCompleteUsage,
    },
    estimatedCost: {
      pricingProfile: profileMetadata,
      pricedRuns,
      unpricedRuns: runs.length - pricedRuns,
      totalUsd: pricingProfile && pricedRuns > 0 ? totalCost : null,
    },
  }
}

export function calculateQualitativeQualityReport(
  runs: QualitativeQualityRun[],
  pricingProfile?: QualitativePricingProfile,
): QualitativeQualityReport {
  const providerStatusCounts: Record<string, number> = {}
  const modelCounts: Record<string, number> = {}
  const promptVersionCounts: Record<string, number> = {}
  const schemaVersionCounts: Record<string, number> = {}
  const latestReviewCounts = {
    accepted: 0,
    corrected: 0,
    rejected: 0,
    unreviewed: 0,
  }
  let schemaValidRuns = 0
  let schemaInvalidRuns = 0
  let evidenceValidRuns = 0
  let evidenceInvalidRuns = 0

  for (const run of runs) {
    incrementCount(providerStatusCounts, run.providerStatus)
    incrementCount(modelCounts, run.resolvedModel ?? run.requestedModel)
    incrementCount(promptVersionCounts, run.promptVersion)
    incrementCount(schemaVersionCounts, run.schemaVersion)
    if (run.providerStatus === QualitativeProviderStatus.completed) schemaValidRuns += 1
    if (run.providerStatus === QualitativeProviderStatus.invalidOutput) schemaInvalidRuns += 1
    if (run.validationStatus === QualitativeValidationStatus.valid) evidenceValidRuns += 1
    if (run.validationStatus === QualitativeValidationStatus.invalid) evidenceInvalidRuns += 1

    if (run.latestReview === null) latestReviewCounts.unreviewed += 1
    else latestReviewCounts[run.latestReview.decision] += 1
  }

  const schemaAssessedRuns = schemaValidRuns + schemaInvalidRuns
  const evidenceAssessedRuns = evidenceValidRuns + evidenceInvalidRuns

  return {
    sample: {
      totalRuns: runs.length,
      providerStatusCounts,
      modelCounts,
      promptVersionCounts,
      schemaVersionCounts,
      latestReviewCounts,
    },
    technicalQuality: {
      schema: {
        validRuns: schemaValidRuns,
        invalidRuns: schemaInvalidRuns,
        assessedRuns: schemaAssessedRuns,
        validityRate: ratio(schemaValidRuns, schemaAssessedRuns),
      },
      evidence: {
        validRuns: evidenceValidRuns,
        invalidRuns: evidenceInvalidRuns,
        assessedRuns: evidenceAssessedRuns,
        validityRate: ratio(evidenceValidRuns, evidenceAssessedRuns),
      },
    },
    humanReview: calculateHumanReviewMetrics(runs),
    consistency: calculateConsistencyMetrics(runs),
    efficiency: calculateEfficiencyMetrics(runs, pricingProfile),
  }
}
