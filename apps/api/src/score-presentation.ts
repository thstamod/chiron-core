import type {
  ResearchScoreComponent,
  ResearchScoreComponentCategory,
} from './types.js'

export interface ResearchScoreBreakdown {
  financialScore: number
  qualitativeScore: number
  uncappedCombinedScore: number
  scoreComponents: ResearchScoreComponent[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function scoreCategory(value: unknown): ResearchScoreComponentCategory | null {
  return value === 'financial' || value === 'qualitative' ? value : null
}

function presentScoreComponent(value: unknown, index: number): ResearchScoreComponent {
  if (!isRecord(value)) throw new Error(`Score component ${index} must be an object`)

  const { code, category, points, explanation } = value
  const validCategory = scoreCategory(category)
  if (typeof code !== 'string' || !code.trim()) {
    throw new Error(`Score component ${index} has an invalid code`)
  }
  if (!validCategory) throw new Error(`Score component ${index} has an invalid category`)
  if (typeof points !== 'number' || !Number.isInteger(points)) {
    throw new Error(`Score component ${index} has invalid points`)
  }
  if (typeof explanation !== 'string' || !explanation.trim()) {
    throw new Error(`Score component ${index} has an invalid explanation`)
  }

  return { code, category: validCategory, points, explanation }
}

export function presentScoreBreakdown(value: unknown): ResearchScoreBreakdown {
  if (!Array.isArray(value)) throw new Error('Prediction score components must be an array')
  const scoreComponents = value.map(presentScoreComponent)
  const financialScore = scoreComponents
    .filter((component) => component.category === 'financial')
    .reduce((total, component) => total + component.points, 0)
  const qualitativeScore = scoreComponents
    .filter((component) => component.category === 'qualitative')
    .reduce((total, component) => total + component.points, 0)

  return {
    financialScore,
    qualitativeScore,
    uncappedCombinedScore: financialScore + qualitativeScore,
    scoreComponents,
  }
}
