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

export interface ResearchCompany {
  id: string
  legalName: string
  ticker: string
  exchange: string | null
  sector: string | null
  isActive: boolean
}

export interface ResearchSourceDocument {
  id: string
  documentType: string
  sourceUrl: string
  publishedAt: string
  firstSeenAt: string
  contentSha256: string
  contentSizeBytes: number | null
}

export interface ResearchReportedFinancialMetric {
  id: string
  metricCode: string
  value: string
  unit: string
  accountingBasis: string
  periodStart: string | null
  periodEnd: string
  sourceDocumentId: string
  extractionVersion: string
  xbrlConcept: string
  sourceText: string
  createdAt: string
}

export interface ResearchDerivedFinancialMetric {
  id: string
  metricCode: string
  value: string
  unit: string
  calculationExpression: string
  calculationVersion: string
  createdAt: string
}

export interface ResearchEventDetails {
  eventId: string
  documents: ResearchSourceDocument[]
  reportedMetrics: ResearchReportedFinancialMetric[]
  derivedMetrics: ResearchDerivedFinancialMetric[]
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
  getWatchlistCompanies(): Promise<ResearchCompany[]>
  getRecentPredictionEvents(limit: number): Promise<ResearchEarningsEvent[]>
  getRecentUnpredictedEvents(limit: number): Promise<ResearchEarningsEvent[]>
  getEventDetails(eventId: string): Promise<ResearchEventDetails | null>
  getPredictionEvidence(predictionId: string): Promise<ResearchPredictionEvidence | null>
}
