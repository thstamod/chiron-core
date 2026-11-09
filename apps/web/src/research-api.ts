export interface ResearchEvaluation {
  id: string
  horizonDays: number
  plannedExitSession: string
  stockEntryPrice: number
  stockExitPrice: number
  marketEntryPrice: number
  marketExitPrice: number
  sectorEntryPrice: number | null
  sectorExitPrice: number | null
  stockReturn: number
  marketReturn: number
  sectorReturn: number | null
  stockMinusMarketReturn: number
  stockMinusSectorReturn: number | null
  stockEntryPriceObservationId: string
  stockExitPriceObservationId: string
  marketEntryPriceObservationId: string
  marketExitPriceObservationId: string
  sectorEntryPriceObservationId: string | null
  sectorExitPriceObservationId: string | null
  methodologyVersion: string
  reconstructionRuleVersion: string | null
  calculatedAt: string
  recordedAt: string
  snapshotFingerprint: string
}

export interface ResearchHistoricalPredictionResult {
  predictionId: string
  eventId: string
  companyName: string
  ticker: string
  sector: string | null
  periodEnd: string | null
  score: number
  ruleVersion: string
  experimentVersion: string
  featureSetVersion: string
  simulatedCutoffAt: string
  recordedAt: string
  plannedEntrySession: string
  evaluations: ResearchEvaluation[]
}

export interface ResearchScoreComponent {
  code: string
  category: 'financial' | 'qualitative'
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

export interface ResearchOverview {
  predictionEvents: ResearchEarningsEvent[]
  unpredictedEvents: ResearchEarningsEvent[]
  watchlistCompanies: ResearchCompany[]
  historicalPredictionResults: ResearchHistoricalPredictionResult[]
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

export interface ResearchEvidenceSource {
  documentId: string
  role: 'current' | 'previous'
  documentType: string
  publishedAt: string
  sourceUrl: string
}

export interface ResearchQualitativeEvidence {
  fieldPath: string
  category: 'guidance' | 'margin_direction' | 'management_tone' | 'key_positive' | 'key_risk'
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
  extractionAudit: ResearchQualitativeExtractionAudit
}

export interface ResearchQualitativeExtractionAudit {
  promptVersion: string
  requestedModelName: string
  resolvedModelName: string | null
  providerName: string
  inputSelectionVersion: string
  finishedAt: string
  tokenUsageJson: string
  validationStatus: string
  originalSchemaVersion: string
  originalOutputFingerprint: string
  originalOutputJson: string
  reviewDecision: string
  reviewerLabel: string
  reviewNotes: string
  reviewVersion: string
  reviewedAt: string
  effectiveSource: string
  effectiveSchemaVersion: string
  effectiveOutputFingerprint: string
  effectiveOutputJson: string
}

interface GraphQlError {
  message: string
}

interface ResearchOverviewResponse {
  data?: {
    recentPredictionEvents: ResearchEarningsEvent[]
    recentUnpredictedEvents: ResearchEarningsEvent[]
    watchlistCompanies: ResearchCompany[]
    historicalPredictionResults: ResearchHistoricalPredictionResult[]
  }
  errors?: GraphQlError[]
}

interface PredictionEvidenceResponse {
  data?: { predictionEvidence: ResearchPredictionEvidence | null }
  errors?: GraphQlError[]
}

interface EventDetailsResponse {
  data?: { earningsEventDetails: ResearchEventDetails | null }
  errors?: GraphQlError[]
}

const ResearchApiConfig = {
  endpoint: '/graphql',
  recentEventsLimit: 25,
  recentUnpredictedEventsLimit: 25,
  historicalResultsLimit: 25,
} as const

const ResearchOverviewQuery = /* GraphQL */ `
  query ResearchOverview($predictionLimit: Int!, $unpredictedLimit: Int!, $historicalLimit: Int!) {
    watchlistCompanies {
      id
      legalName
      ticker
      exchange
      sector
      isActive
    }
    recentUnpredictedEvents(limit: $unpredictedLimit) {
      id
      companyId
      companyName
      ticker
      sector
      periodEnd
      detectedAt
      status
    }
    recentPredictionEvents(limit: $predictionLimit) {
      id
      companyId
      companyName
      ticker
      sector
      periodEnd
      detectedAt
      status
      latestPrediction {
        id
        score
        financialScore
        qualitativeScore
        uncappedCombinedScore
        scoreComponents {
          code
          category
          points
          explanation
        }
        ruleVersion
        cutoffAt
        recordedAt
        plannedEntrySession
        plannedDay1Session
        plannedDay5Session
        plannedDay20Session
        summary
        guidanceDirection
        guidanceSummary
        marginDirection
        managementTone
        mainRisk
        evaluations {
          id
          horizonDays
          plannedExitSession
          stockEntryPrice
          stockExitPrice
          marketEntryPrice
          marketExitPrice
          sectorEntryPrice
          sectorExitPrice
          stockReturn
          marketReturn
          sectorReturn
          stockMinusMarketReturn
          stockMinusSectorReturn
          stockEntryPriceObservationId
          stockExitPriceObservationId
          marketEntryPriceObservationId
          marketExitPriceObservationId
          sectorEntryPriceObservationId
          sectorExitPriceObservationId
          methodologyVersion
          reconstructionRuleVersion
          calculatedAt
          recordedAt
          snapshotFingerprint
        }
      }
    }
    historicalPredictionResults(limit: $historicalLimit) {
      predictionId
      eventId
      companyName
      ticker
      sector
      periodEnd
      score
      ruleVersion
      experimentVersion
      featureSetVersion
      simulatedCutoffAt
      recordedAt
      plannedEntrySession
      evaluations {
        id
        horizonDays
        plannedExitSession
        stockEntryPrice
        stockExitPrice
        marketEntryPrice
        marketExitPrice
        sectorEntryPrice
        sectorExitPrice
        stockReturn
        marketReturn
        sectorReturn
        stockMinusMarketReturn
        stockMinusSectorReturn
        stockEntryPriceObservationId
        stockExitPriceObservationId
        marketEntryPriceObservationId
        marketExitPriceObservationId
        sectorEntryPriceObservationId
        sectorExitPriceObservationId
        methodologyVersion
        reconstructionRuleVersion
        calculatedAt
        recordedAt
        snapshotFingerprint
      }
    }
  }
`

const PredictionEvidenceQuery = /* GraphQL */ `
  query PredictionEvidence($predictionId: ID!) {
    predictionEvidence(predictionId: $predictionId) {
      predictionId
      extractionSchemaVersion
      evidence {
        fieldPath
        category
        claim
        passageId
        quote
        startCharacter
        endCharacter
        source {
          documentId
          role
          documentType
          publishedAt
          sourceUrl
        }
      }
      extractionAudit {
        promptVersion
        requestedModelName
        resolvedModelName
        providerName
        inputSelectionVersion
        finishedAt
        tokenUsageJson
        validationStatus
        originalSchemaVersion
        originalOutputFingerprint
        originalOutputJson
        reviewDecision
        reviewerLabel
        reviewNotes
        reviewVersion
        reviewedAt
        effectiveSource
        effectiveSchemaVersion
        effectiveOutputFingerprint
        effectiveOutputJson
      }
    }
  }
`

const EventDetailsQuery = /* GraphQL */ `
  query EventDetails($eventId: ID!) {
    earningsEventDetails(eventId: $eventId) {
      eventId
      documents {
        id
        documentType
        sourceUrl
        publishedAt
        firstSeenAt
        contentSha256
        contentSizeBytes
      }
      reportedMetrics {
        id
        metricCode
        value
        unit
        accountingBasis
        periodStart
        periodEnd
        sourceDocumentId
        extractionVersion
        xbrlConcept
        sourceText
        createdAt
      }
      derivedMetrics {
        id
        metricCode
        value
        unit
        calculationExpression
        calculationVersion
        createdAt
      }
    }
  }
`

export async function loadResearchOverview(): Promise<ResearchOverview> {
  const response = await fetch(ResearchApiConfig.endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      query: ResearchOverviewQuery,
      variables: {
        predictionLimit: ResearchApiConfig.recentEventsLimit,
        unpredictedLimit: ResearchApiConfig.recentUnpredictedEventsLimit,
        historicalLimit: ResearchApiConfig.historicalResultsLimit,
      },
    }),
  })

  if (!response.ok) throw new Error(`Research API returned HTTP ${response.status}`)
  const result = await response.json() as ResearchOverviewResponse
  if (result.errors?.length) throw new Error(result.errors.map((error) => error.message).join('; '))
  if (!result.data) throw new Error('Research API returned no data')
  return {
    predictionEvents: result.data.recentPredictionEvents,
    unpredictedEvents: result.data.recentUnpredictedEvents,
    watchlistCompanies: result.data.watchlistCompanies,
    historicalPredictionResults: result.data.historicalPredictionResults,
  }
}

export async function loadPredictionEvidence(
  predictionId: string,
): Promise<ResearchPredictionEvidence> {
  const response = await fetch(ResearchApiConfig.endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      query: PredictionEvidenceQuery,
      variables: { predictionId },
    }),
  })

  if (!response.ok) throw new Error(`Research API returned HTTP ${response.status}`)
  const result = await response.json() as PredictionEvidenceResponse
  if (result.errors?.length) throw new Error(result.errors.map((error) => error.message).join('; '))
  if (!result.data?.predictionEvidence) throw new Error('Prediction evidence was not found')
  return result.data.predictionEvidence
}

export async function loadEventDetails(eventId: string): Promise<ResearchEventDetails> {
  const response = await fetch(ResearchApiConfig.endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      query: EventDetailsQuery,
      variables: { eventId },
    }),
  })

  if (!response.ok) throw new Error(`Research API returned HTTP ${response.status}`)
  const result = await response.json() as EventDetailsResponse
  if (result.errors?.length) throw new Error(result.errors.map((error) => error.message).join('; '))
  if (!result.data?.earningsEventDetails) throw new Error('Earnings event details were not found')
  return result.data.earningsEventDetails
}
