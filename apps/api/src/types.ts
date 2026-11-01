export interface ResearchEvaluation {
  horizonDays: number
  stockReturn: number
  marketReturn: number
  sectorReturn: number | null
  stockMinusMarketReturn: number
  stockMinusSectorReturn: number | null
  calculatedAt: string
}

export type ResearchScoreComponentCategory = 'financial' | 'qualitative'

export interface ResearchScoreComponent {
  code: string
  category: ResearchScoreComponentCategory
  points: number
  explanation: string
}

export interface ResearchPrediction {
  id: string
  score: number
  financialScore: number
  qualitativeScore: number
  uncappedCombinedScore: number
  scoreComponents: ResearchScoreComponent[]
  ruleVersion: string
  cutoffAt: string
  recordedAt: string
  plannedEntrySession: string
  plannedDay1Session: string
  plannedDay5Session: string
  plannedDay20Session: string
  summary: string | null
  guidanceDirection: string
  guidanceSummary: string | null
  marginDirection: string
  managementTone: string
  mainRisk: string | null
  evaluations: ResearchEvaluation[]
}

export interface ResearchEarningsEvent {
  id: string
  companyId: string
  companyName: string
  ticker: string
  sector: string | null
  periodEnd: string | null
  detectedAt: string
  status: string
  latestPrediction: ResearchPrediction | null
}

export type ResearchEvidenceCategory =
  | 'guidance'
  | 'margin_direction'
  | 'management_tone'
  | 'key_positive'
  | 'key_risk'

export interface ResearchEvidenceSource {
  documentId: string
  role: 'current' | 'previous'
  documentType: string
  publishedAt: string
  sourceUrl: string
}

export interface ResearchQualitativeEvidence {
  fieldPath: string
  category: ResearchEvidenceCategory
  claim: string
  passageId: string
  quote: string
  startCharacter: number
  endCharacter: number
  source: ResearchEvidenceSource
}

export interface ResearchPredictionEvidence {
  predictionId: string
  extractionSchemaVersion: string
  evidence: ResearchQualitativeEvidence[]
}

export interface ResearchRepository {
  getRecentPredictionEvents(limit: number): Promise<ResearchEarningsEvent[]>
  getPredictionEvidence(predictionId: string): Promise<ResearchPredictionEvidence | null>
}
