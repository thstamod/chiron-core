import {
  qualitativeExtractionSchema,
  type GuidanceDirection,
  type QualitativeExtraction,
} from '@chiron/shared'
import {
  FinancialDerivedMetricCode,
  RuleVersion,
  ScorableGuidanceMetric,
  ScoringComponentCategory,
  ScoringComponentCode,
  TransparentScoringPolicy,
} from './constants.js'

export interface FinancialScoringMetric {
  metricCode: string
  valueNumeric: string | number
}

export interface TransparentScoringInput {
  financialMetrics: FinancialScoringMetric[]
  qualitativeExtraction: QualitativeExtraction
}

export interface TransparentScoreComponent {
  code: typeof ScoringComponentCode[keyof typeof ScoringComponentCode]
  category: typeof ScoringComponentCategory[keyof typeof ScoringComponentCategory]
  points: number
  explanation: string
  input: unknown
}

export interface TransparentEarningsScore {
  ruleVersion: string
  financialScore: number
  qualitativeScore: number
  uncappedCombinedScore: number
  score: number
  components: TransparentScoreComponent[]
}

const scorableGuidanceMetrics = new Set<string>(Object.values(ScorableGuidanceMetric))

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function financialMetricValue(
  metrics: FinancialScoringMetric[],
  metricCode: string,
): number | null {
  const matchingMetrics = metrics.filter((metric) => metric.metricCode === metricCode)
  if (matchingMetrics.length > 1) {
    throw new Error(`Transparent scoring received duplicate ${metricCode} metrics`)
  }
  const matchingMetric = matchingMetrics[0]
  if (!matchingMetric) return null

  const value = Number(matchingMetric.valueNumeric)
  if (!Number.isFinite(value)) {
    throw new Error(`Transparent scoring received an invalid ${metricCode} value`)
  }
  return value
}

function directionalFinancialComponent(
  code:
    | typeof ScoringComponentCode.revenueGrowth
    | typeof ScoringComponentCode.reportedMarginChange,
  metricCode: string,
  metricLabel: string,
  value: number | null,
): TransparentScoreComponent {
  const category = ScoringComponentCategory.financial
  if (value === null) {
    return {
      code,
      category,
      points: 0,
      explanation: `${metricLabel} is unavailable, so it contributes zero points.`,
      input: null,
    }
  }

  const points = value > 0 ? 1 : value < 0 ? -1 : 0
  const direction = value > 0 ? 'positive' : value < 0 ? 'negative' : 'unchanged'
  return {
    code,
    category,
    points,
    explanation: `${metricLabel} is ${direction}, contributing ${points} point${Math.abs(points) === 1 ? '' : 's'}.`,
    input: { metricCode, value },
  }
}

function guidanceDirectionPoints(direction: GuidanceDirection): number {
  if (direction === 'raised') return 1
  if (direction === 'lowered' || direction === 'withdrawn') return -1
  return 0
}

function guidanceComponent(
  extraction: QualitativeExtraction,
): TransparentScoreComponent {
  const scoredItems = extraction.guidance.items
    .filter((item) => scorableGuidanceMetrics.has(item.metric))
    .map((item) => ({
      metric: item.metric,
      direction: item.direction,
      points: guidanceDirectionPoints(item.direction),
    }))
  const ignoredItems = extraction.guidance.items
    .filter((item) => !scorableGuidanceMetrics.has(item.metric))
    .map((item) => ({ metric: item.metric, direction: item.direction }))
  const uncappedPoints = scoredItems.reduce((total, item) => total + item.points, 0)
  const points = clamp(
    uncappedPoints,
    TransparentScoringPolicy.minimumGuidancePoints,
    TransparentScoringPolicy.maximumGuidancePoints,
  )

  return {
    code: ScoringComponentCode.guidanceChange,
    category: ScoringComponentCategory.qualitative,
    points,
    explanation: scoredItems.length === 0
      ? 'No directionally scorable guidance is available, so guidance contributes zero points.'
      : `Scorable guidance changes contribute ${points} point${Math.abs(points) === 1 ? '' : 's'} after the component cap.`,
    input: {
      status: extraction.guidance.status,
      scoredItems,
      ignoredItems,
      uncappedPoints,
    },
  }
}

function qualitativeMarginComponent(
  extraction: QualitativeExtraction,
): TransparentScoreComponent {
  const direction = extraction.marginDirection.direction
  const points = direction === 'improving' ? 1 : direction === 'declining' ? -1 : 0
  return {
    code: ScoringComponentCode.qualitativeMarginDirection,
    category: ScoringComponentCategory.qualitative,
    points,
    explanation: `The reviewed qualitative margin direction is ${direction}, contributing ${points} point${Math.abs(points) === 1 ? '' : 's'}.`,
    input: { direction },
  }
}

function managementToneComponent(
  extraction: QualitativeExtraction,
): TransparentScoreComponent {
  const change = extraction.managementTone.changeFromPrevious
  const points = change === 'more_positive' ? 1 : change === 'more_negative' ? -1 : 0
  return {
    code: ScoringComponentCode.managementToneChange,
    category: ScoringComponentCategory.qualitative,
    points,
    explanation: `Reviewed management tone is ${change.replaceAll('_', ' ')}, contributing ${points} point${Math.abs(points) === 1 ? '' : 's'}.`,
    input: { changeFromPrevious: change },
  }
}

function keyDevelopmentComponent(
  code: typeof ScoringComponentCode.keyPositives | typeof ScoringComponentCode.keyRisks,
  claims: QualitativeExtraction['keyPositives'],
): TransparentScoreComponent {
  const isPositive = code === ScoringComponentCode.keyPositives
  const points = claims.length === 0 ? 0 : isPositive ? 1 : -1
  const description = isPositive ? 'positive development' : 'material risk'
  return {
    code,
    category: ScoringComponentCategory.qualitative,
    points,
    explanation: claims.length === 0
      ? `No reviewed ${description} was extracted, so this component contributes zero points.`
      : `At least one reviewed ${description} was extracted, contributing ${points} point${Math.abs(points) === 1 ? '' : 's'} regardless of list length.`,
    input: { claimCount: claims.length },
  }
}

export function calculateTransparentEarningsScore(
  input: TransparentScoringInput,
): TransparentEarningsScore {
  const qualitativeExtraction = qualitativeExtractionSchema.parse(input.qualitativeExtraction)
  const components: TransparentScoreComponent[] = [
    directionalFinancialComponent(
      ScoringComponentCode.revenueGrowth,
      FinancialDerivedMetricCode.revenueGrowthYearOverYearPercent,
      'Year-over-year revenue growth',
      financialMetricValue(
        input.financialMetrics,
        FinancialDerivedMetricCode.revenueGrowthYearOverYearPercent,
      ),
    ),
    directionalFinancialComponent(
      ScoringComponentCode.reportedMarginChange,
      FinancialDerivedMetricCode.netMarginChangeYearOverYearPercentagePoints,
      'Year-over-year net-margin change',
      financialMetricValue(
        input.financialMetrics,
        FinancialDerivedMetricCode.netMarginChangeYearOverYearPercentagePoints,
      ),
    ),
    guidanceComponent(qualitativeExtraction),
    qualitativeMarginComponent(qualitativeExtraction),
    managementToneComponent(qualitativeExtraction),
    keyDevelopmentComponent(
      ScoringComponentCode.keyPositives,
      qualitativeExtraction.keyPositives,
    ),
    keyDevelopmentComponent(
      ScoringComponentCode.keyRisks,
      qualitativeExtraction.keyRisks,
    ),
  ]

  const financialScore = components
    .filter((component) => component.category === ScoringComponentCategory.financial)
    .reduce((total, component) => total + component.points, 0)
  const qualitativeScore = components
    .filter((component) => component.category === ScoringComponentCategory.qualitative)
    .reduce((total, component) => total + component.points, 0)
  const uncappedCombinedScore = financialScore + qualitativeScore

  return {
    ruleVersion: RuleVersion.transparentEarningsScore,
    financialScore,
    qualitativeScore,
    uncappedCombinedScore,
    score: clamp(
      uncappedCombinedScore,
      TransparentScoringPolicy.minimumScore,
      TransparentScoringPolicy.maximumScore,
    ),
    components,
  }
}
