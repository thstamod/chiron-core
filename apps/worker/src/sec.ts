import type {
  SecEarningsClassification,
  SecFilingCandidate,
  TrackedCompany,
} from '@chiron/shared'
import {
  EarningsCategory,
  earningsReleaseSecForms,
  periodicSecForms,
  RuleVersion,
  SecItem,
  SecRequest,
  SecUrl,
  supportedSecForms,
  WorkerTiming,
} from './constants.js'

export const earningsClassificationRuleVersion = RuleVersion.earningsClassification

interface SecRecentFilings {
  accessionNumber?: string[]
  filingDate?: string[]
  reportDate?: string[]
  acceptanceDateTime?: string[]
  form?: string[]
  primaryDocument?: string[]
  primaryDocDescription?: string[]
  items?: string[]
}

interface SecSubmissionsResponse {
  cik?: string
  entityType?: string
  sic?: string
  sicDescription?: string
  filings?: {
    recent?: SecRecentFilings
  }
}

function valueAt(values: string[] | undefined, index: number): string {
  return values?.[index]?.trim() ?? ''
}

function nullableValueAt(values: string[] | undefined, index: number): string | null {
  const value = valueAt(values, index)
  return value.length > 0 ? value : null
}

function normalizeAcceptedAt(value: string | null): string | null {
  if (!value) return null

  const timestamp = value.endsWith('Z') ? value : `${value}Z`
  const parsed = new Date(timestamp)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

export function buildSecIndexUrl(cik: string, accessionNumber: string): string {
  const numericCik = String(Number.parseInt(cik, 10))
  const accessionPath = accessionNumber.replaceAll('-', '')
  return `${SecUrl.archiveDataBase}/${numericCik}/${accessionPath}/${accessionNumber}-index.html`
}

export function buildSecPrimaryDocumentUrl(
  cik: string,
  accessionNumber: string,
  primaryDocument: string,
): string {
  const numericCik = String(Number.parseInt(cik, 10))
  const accessionPath = accessionNumber.replaceAll('-', '')
  const encodedDocument = primaryDocument
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/')

  return `${SecUrl.archiveDataBase}/${numericCik}/${accessionPath}/${encodedDocument}`
}

export function classifyEarningsFiling(
  formType: string,
  items: string[],
  classifiedAt = new Date().toISOString(),
): SecEarningsClassification {
  if (periodicSecForms.has(formType)) {
    return {
      isEarningsRelated: true,
      category: EarningsCategory.periodicReport,
      reason: `${formType} contains the company's periodic financial report.`,
      ruleVersion: earningsClassificationRuleVersion,
      classifiedAt,
    }
  }

  if (earningsReleaseSecForms.has(formType) && items.includes(SecItem.resultsOfOperations)) {
    return {
      isEarningsRelated: true,
      category: EarningsCategory.release,
      reason: `${formType} includes SEC item ${SecItem.resultsOfOperations}, Results of Operations and Financial Condition.`,
      ruleVersion: earningsClassificationRuleVersion,
      classifiedAt,
    }
  }

  return {
    isEarningsRelated: false,
    category: EarningsCategory.notEarnings,
    reason: `${formType} does not match the versioned earnings-filing rule.`,
    ruleVersion: earningsClassificationRuleVersion,
    classifiedAt,
  }
}

export function parseRecentFilings(
  company: TrackedCompany,
  response: SecSubmissionsResponse,
  cutoffDate: string,
): SecFilingCandidate[] {
  const recent = response.filings?.recent
  const accessions = recent?.accessionNumber ?? []
  const result: SecFilingCandidate[] = []

  for (let index = 0; index < accessions.length; index += 1) {
    const accessionNumber = valueAt(recent?.accessionNumber, index)
    const formType = valueAt(recent?.form, index)
    const filingDate = valueAt(recent?.filingDate, index)

    if (!accessionNumber || !filingDate || !supportedSecForms.has(formType) || filingDate < cutoffDate) {
      continue
    }

    result.push({
      companyId: company.id,
      accessionNumber,
      formType,
      filingDate,
      acceptedAt: normalizeAcceptedAt(nullableValueAt(recent?.acceptanceDateTime, index)),
      reportDate: nullableValueAt(recent?.reportDate, index),
      primaryDocument: valueAt(recent?.primaryDocument, index),
      items: valueAt(recent?.items, index).split(',').map((item) => item.trim()).filter(Boolean),
      secIndexUrl: buildSecIndexUrl(company.cik, accessionNumber),
      metadata: {
        primaryDocumentDescription: nullableValueAt(recent?.primaryDocDescription, index),
        secEntityType: response.entityType ?? null,
        sic: response.sic ?? null,
        sicDescription: response.sicDescription ?? null,
      },
    })
  }

  return result
}

export async function fetchRecentFilings(
  company: TrackedCompany,
  userAgent: string,
  cutoffDate: string,
): Promise<SecFilingCandidate[]> {
  const paddedCik = company.cik.padStart(10, '0')
  const response = await fetch(`${SecUrl.submissionsBase}/CIK${paddedCik}.json`, {
    headers: {
      Accept: SecRequest.submissionsAccept,
      'Accept-Encoding': SecRequest.acceptedEncoding,
      'User-Agent': userAgent,
    },
    signal: AbortSignal.timeout(WorkerTiming.secRequestTimeoutMs),
  })

  if (!response.ok) {
    throw new Error(`SEC request for ${company.ticker} failed with HTTP ${response.status}`)
  }

  return parseRecentFilings(company, await response.json() as SecSubmissionsResponse, cutoffDate)
}
