interface QualitativePresentation {
  summary: string | null
  guidanceDirection: string
  guidanceSummary: string | null
  marginDirection: string
  managementTone: string
  mainRisk: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function recordValue(record: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const value = record[key]
  return isRecord(value) ? value : null
}

function textValue(record: Record<string, unknown> | null, key: string): string | null {
  const value = record?.[key]
  return typeof value === 'string' && value.trim() ? value : null
}

function qualitativeOutput(snapshot: unknown): Record<string, unknown> | null {
  if (!isRecord(snapshot)) return null
  const qualitative = recordValue(snapshot, 'qualitative')
  const effectiveExtraction = qualitative && recordValue(qualitative, 'effectiveExtraction')
  const effective = effectiveExtraction && recordValue(effectiveExtraction, 'effective')
  return effective && recordValue(effective, 'output')
}

function guidanceDirection(guidance: Record<string, unknown> | null): string {
  if (!guidance) return 'unavailable'
  const items = guidance.items
  if (Array.isArray(items)) {
    const directions = items
      .filter(isRecord)
      .map((item) => textValue(item, 'direction'))
      .filter((direction): direction is string => direction !== null)

    for (const priority of ['lowered', 'withdrawn', 'raised', 'introduced', 'maintained']) {
      if (directions.includes(priority)) return priority
    }
  }
  return textValue(guidance, 'status') ?? 'unavailable'
}

function firstClaimStatement(output: Record<string, unknown>, key: string): string | null {
  const claims = output[key]
  if (!Array.isArray(claims)) return null
  const firstClaim = claims.find(isRecord)
  return firstClaim ? textValue(firstClaim, 'statement') : null
}

export function presentQualitativePrediction(snapshot: unknown): QualitativePresentation {
  const output = qualitativeOutput(snapshot)
  if (!output) {
    return {
      summary: null,
      guidanceDirection: 'unavailable',
      guidanceSummary: null,
      marginDirection: 'unavailable',
      managementTone: 'unavailable',
      mainRisk: null,
    }
  }

  const guidance = recordValue(output, 'guidance')
  const margin = recordValue(output, 'marginDirection')
  const tone = recordValue(output, 'managementTone')
  return {
    summary: textValue(output, 'summary'),
    guidanceDirection: guidanceDirection(guidance),
    guidanceSummary: textValue(guidance, 'summary'),
    marginDirection: textValue(margin, 'direction') ?? 'unavailable',
    managementTone: textValue(tone, 'currentTone') ?? 'unavailable',
    mainRisk: firstClaimStatement(output, 'keyRisks'),
  }
}
