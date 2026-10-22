export type GuidanceChange = 'raised' | 'maintained' | 'lowered' | 'unclear'
export type EventStatus = 'tracking' | 'complete'

export interface DemoEarningsEvent {
  id: string
  company: string
  ticker: string
  period: string
  score: number
  guidance: GuidanceChange
  summary: string
  mainRisk: string
  status: EventStatus
  marketComparison: number | null
}

export interface WorkerHealth {
  service: string
  phase: 'foundation' | 'ingestion' | 'extraction' | 'evaluation'
  ready: boolean
  checkedAt: string
}

export interface TrackedCompany {
  id: string
  cik: string
  legalName: string
  ticker: string
  exchange: string | null
  sector: string | null
  isActive: boolean
}

export interface SecFilingCandidate {
  companyId: string
  accessionNumber: string
  formType: string
  filingDate: string
  acceptedAt: string | null
  reportDate: string | null
  primaryDocument: string
  items: string[]
  secIndexUrl: string
  metadata: Record<string, unknown>
}

export type SecEarningsCategory = 'earnings_release' | 'periodic_report' | 'not_earnings'

export interface SecEarningsClassification {
  isEarningsRelated: boolean
  category: SecEarningsCategory
  reason: string
  ruleVersion: string
  classifiedAt: string
}

export interface SecFilingRecord {
  id: string
  companyId: string
  cik: string
  ticker: string
  accessionNumber: string
  formType: string
  filingDate: string
  acceptedAt: string | null
  firstSeenAt: string
  reportDate: string | null
  primaryDocument: string
  items: string[]
  secIndexUrl: string
  earningsClassification: SecEarningsClassification | null
  exhibitDiscoveryVersion: string | null
  earningsEventId: string | null
}

export interface EarningsEventGroup {
  companyId: string
  periodEnd: string | null
  eventStatus: 'provisional' | 'detected'
  originFilingId: string
  originAccessionNumber: string
  anchorAccessionNumber: string | null
  matchingStatus: 'periodic_only' | 'matched' | 'unmatched' | 'ambiguous'
  matchingCandidateAccessionNumbers: string[]
  matchingGapHours: number | null
  filingIds: string[]
  ruleVersion: string
}
