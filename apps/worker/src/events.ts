import type { SupabaseClient } from '@supabase/supabase-js'
import type { EarningsEventGroup, SecFilingRecord } from '@chiron/shared'
import {
  DatabaseTable,
  EarningsCategory,
  EarningsEventStatus,
  periodicSecForms,
  RuleVersion,
  SecForm,
  WorkerTiming,
} from './constants.js'
import { fetchAllPages } from './pagination.js'
import { classifyEarningsFiling } from './sec.js'

export const eventGroupingRuleVersion = RuleVersion.eventGrouping
export const eventPersistenceVersion = RuleVersion.eventPersistence

function filingTimestamp(filing: SecFilingRecord): number {
  return new Date(filing.acceptedAt ?? filing.firstSeenAt).getTime()
}

function eventKey(companyId: string, periodEnd: string): string {
  return `${companyId}:${periodEnd}`
}

export function buildEarningsEventGroups(filings: SecFilingRecord[]): EarningsEventGroup[] {
  const anchors = filings.filter(
    (filing) => (
      filing.formType === SecForm.quarterlyReport
      || filing.formType === SecForm.annualReport
    ) && filing.reportDate,
  )
  const anchorByKey = new Map<string, SecFilingRecord>()

  for (const anchor of anchors) {
    const key = eventKey(anchor.companyId, anchor.reportDate!)
    const current = anchorByKey.get(key)
    if (!current || filingTimestamp(anchor) < filingTimestamp(current)) {
      anchorByKey.set(key, anchor)
    }
  }

  const groups = new Map<string, EarningsEventGroup>()
  for (const [key, anchor] of anchorByKey) {
    groups.set(key, {
      companyId: anchor.companyId,
      periodEnd: anchor.reportDate!,
      eventStatus: EarningsEventStatus.detected,
      originFilingId: anchor.id,
      originAccessionNumber: anchor.accessionNumber,
      anchorAccessionNumber: anchor.accessionNumber,
      matchingStatus: 'periodic_only',
      matchingCandidateAccessionNumbers: [],
      matchingGapHours: null,
      filingIds: [anchor.id],
      ruleVersion: eventGroupingRuleVersion,
    })
  }

  for (const filing of filings) {
    const isPeriodicReport = periodicSecForms.has(filing.formType)
    if (filing.reportDate && isPeriodicReport) {
      const exactGroup = groups.get(eventKey(filing.companyId, filing.reportDate))
      if (exactGroup && !exactGroup.filingIds.includes(filing.id)) {
        exactGroup.filingIds.push(filing.id)
        continue
      }
    }

    const classification = classifyEarningsFiling(filing.formType, filing.items)
    if (classification.category !== EarningsCategory.release) continue

    const releaseTime = filingTimestamp(filing)
    const matchingAnchors = [...anchorByKey.values()]
      .filter((anchor) => anchor.companyId === filing.companyId)
      .map((anchor) => ({ anchor, distance: filingTimestamp(anchor) - releaseTime }))
      .filter(({ distance }) => (
        distance >= 0 && distance <= WorkerTiming.eventGroupingWindowMs
      ))
      .sort((left, right) => left.distance - right.distance)

    if (matchingAnchors.length === 1) {
      const { anchor, distance } = matchingAnchors[0]!
      const group = groups.get(eventKey(anchor.companyId, anchor.reportDate!))
      if (!group) continue

      if (!group.filingIds.includes(filing.id)) group.filingIds.push(filing.id)
      if (
        group.matchingStatus !== 'matched'
        || releaseTime < filingTimestamp(
          filings.find((candidate) => candidate.id === group.originFilingId) ?? anchor,
        )
      ) {
        group.originFilingId = filing.id
        group.originAccessionNumber = filing.accessionNumber
        group.matchingGapHours = Number((distance / 3_600_000).toFixed(2))
      }
      group.matchingStatus = 'matched'
      group.matchingCandidateAccessionNumbers = [anchor.accessionNumber]
      continue
    }

    groups.set(`provisional:${filing.id}`, {
      companyId: filing.companyId,
      periodEnd: null,
      eventStatus: EarningsEventStatus.provisional,
      originFilingId: filing.id,
      originAccessionNumber: filing.accessionNumber,
      anchorAccessionNumber: null,
      matchingStatus: matchingAnchors.length === 0 ? 'unmatched' : 'ambiguous',
      matchingCandidateAccessionNumbers: matchingAnchors.map(
        ({ anchor }) => anchor.accessionNumber,
      ),
      matchingGapHours: null,
      filingIds: [filing.id],
      ruleVersion: eventGroupingRuleVersion,
    })
  }

  return [...groups.values()]
    .map((group) => ({ ...group, filingIds: group.filingIds.sort() }))
    .sort((left, right) => (
      (left.periodEnd ?? left.originAccessionNumber)
        .localeCompare(right.periodEnd ?? right.originAccessionNumber)
    ))
}

interface ExistingEventRow {
  id: string
  company_id: string
  period_end: string | null
  origin_filing_id: string | null
  detected_at: string
  status: string
  previous_event_id: string | null
  grouping_metadata: {
    ruleVersion?: string
    persistenceVersion?: string
    filingIds?: string[]
  } | null
}

interface PreviousEventRow {
  id: string
  company_id: string
  period_end: string
  previous_event_id: string | null
}

function sameFilingIds(left: string[] | undefined, right: string[]): boolean {
  if (!left || left.length !== right.length) return false
  return [...left].sort().every((value, index) => value === right[index])
}

export interface EventGroupPersistenceActions {
  unlinkRemovedRelationships: () => Promise<void>
  linkCurrentFilings: () => Promise<void>
  linkCurrentDocuments: () => Promise<void>
  completeEarningsEvent: () => Promise<void>
}

export async function persistEarningsEventGroup(
  actions: EventGroupPersistenceActions,
): Promise<void> {
  await actions.unlinkRemovedRelationships()
  await actions.linkCurrentFilings()
  await actions.linkCurrentDocuments()
  await actions.completeEarningsEvent()
}

async function createPendingEarningsEvent(
  client: SupabaseClient,
  group: EarningsEventGroup,
): Promise<{ eventId: string; detectedAt: string }> {
  const detectedAt = new Date().toISOString()
  const { data: insertedEvent, error: insertError } = await client
    .from(DatabaseTable.earningsEvents)
    .insert({
      company_id: group.companyId,
      fiscal_year: null,
      fiscal_quarter: null,
      period_end: group.periodEnd,
      detected_at: detectedAt,
      status: EarningsEventStatus.groupingPending,
      origin_filing_id: group.originFilingId,
    })
    .select('id')
    .single()

  if (insertError) throw new Error(`Could not create earnings event: ${insertError.message}`)
  return { eventId: insertedEvent.id as string, detectedAt }
}

async function unlinkRemovedEventRelationships(
  client: SupabaseClient,
  removedFilingIds: string[],
): Promise<void> {
  if (removedFilingIds.length === 0) return

  const { error: unlinkFilingsError } = await client
    .from(DatabaseTable.secFilings)
    .update({ earnings_event_id: null })
    .in('id', removedFilingIds)
  if (unlinkFilingsError) {
    throw new Error(`Could not unlink SEC filings: ${unlinkFilingsError.message}`)
  }

  const { error: unlinkDocumentsError } = await client
    .from(DatabaseTable.documents)
    .update({ earnings_event_id: null })
    .in('filing_id', removedFilingIds)
  if (unlinkDocumentsError) {
    throw new Error(`Could not unlink documents: ${unlinkDocumentsError.message}`)
  }
}

async function linkCurrentFilingsToEvent(
  client: SupabaseClient,
  eventId: string,
  filingIds: string[],
): Promise<void> {
  const { error } = await client
    .from(DatabaseTable.secFilings)
    .update({ earnings_event_id: eventId })
    .in('id', filingIds)
  if (error) throw new Error(`Could not link SEC filings: ${error.message}`)
}

async function linkCurrentDocumentsToEvent(
  client: SupabaseClient,
  eventId: string,
  filingIds: string[],
): Promise<void> {
  const { error } = await client
    .from(DatabaseTable.documents)
    .update({ earnings_event_id: eventId })
    .in('filing_id', filingIds)
  if (error) throw new Error(`Could not link documents: ${error.message}`)
}

async function completeEarningsEvent(
  client: SupabaseClient,
  eventId: string,
  group: EarningsEventGroup,
  groupingMetadata: Record<string, unknown>,
): Promise<void> {
  const { error } = await client
    .from(DatabaseTable.earningsEvents)
    .update({
      period_end: group.periodEnd,
      origin_filing_id: group.originFilingId,
      status: group.eventStatus,
      grouping_metadata: groupingMetadata,
    })
    .eq('id', eventId)
  if (error) throw new Error(`Could not complete earnings event grouping: ${error.message}`)
}

export async function saveEarningsEventGroups(
  client: SupabaseClient,
  groups: EarningsEventGroup[],
): Promise<{ changedEvents: number; linkedFilings: number }> {
  const existingRows = await fetchAllPages<ExistingEventRow>(
    async (from, to) => {
      const { data, error } = await client
        .from(DatabaseTable.earningsEvents)
        .select(
          'id,company_id,period_end,origin_filing_id,detected_at,status,'
          + 'previous_event_id,grouping_metadata',
        )
        .order('company_id')
        .order('period_end')
        .order('id')
        .range(from, to)

      return { data: data as ExistingEventRow[] | null, error }
    },
    'Could not load earnings events',
  )
  const existingByPeriodKey = new Map<string, ExistingEventRow>(
    existingRows
      .filter((event): event is ExistingEventRow & { period_end: string } => Boolean(event.period_end))
      .map((event) => [eventKey(event.company_id, event.period_end), event]),
  )
  const existingByOriginFilingId = new Map<string, ExistingEventRow>(
    existingRows
      .filter(
        (event): event is ExistingEventRow & { origin_filing_id: string } => (
          Boolean(event.origin_filing_id)
        ),
      )
      .map((event) => [event.origin_filing_id, event]),
  )
  let changedEvents = 0
  let linkedFilings = 0

  for (const group of groups) {
    const periodKey = group.periodEnd ? eventKey(group.companyId, group.periodEnd) : null
    const existingForPeriod = periodKey ? existingByPeriodKey.get(periodKey) : undefined
    const existingForOrigin = existingByOriginFilingId.get(group.originFilingId)
    if (existingForPeriod && existingForOrigin && existingForPeriod.id !== existingForOrigin.id) {
      throw new Error(
        `Could not safely merge duplicate earnings events for ${group.originAccessionNumber}`,
      )
    }
    const existing = existingForPeriod ?? existingForOrigin
    const unchanged = existing
      && existing.grouping_metadata?.ruleVersion === group.ruleVersion
      && existing.grouping_metadata.persistenceVersion === eventPersistenceVersion
      && existing.period_end === group.periodEnd
      && existing.origin_filing_id === group.originFilingId
      && existing.status === group.eventStatus
      && sameFilingIds(existing.grouping_metadata.filingIds, group.filingIds)

    if (unchanged) continue

    const groupingMetadata = {
      ruleVersion: group.ruleVersion,
      persistenceVersion: eventPersistenceVersion,
      eventStatus: group.eventStatus,
      originAccessionNumber: group.originAccessionNumber,
      anchorAccessionNumber: group.anchorAccessionNumber,
      matchingStatus: group.matchingStatus,
      matchingCandidateAccessionNumbers: group.matchingCandidateAccessionNumbers,
      matchingGapHours: group.matchingGapHours,
      filingIds: group.filingIds,
      groupedAt: new Date().toISOString(),
    }
    let eventId = existing?.id
    let eventDetectedAt = existing?.detected_at

    if (!eventId) {
      const createdEvent = await createPendingEarningsEvent(client, group)
      eventId = createdEvent.eventId
      eventDetectedAt = createdEvent.detectedAt
      const createdEventRow: ExistingEventRow = {
        id: eventId,
        company_id: group.companyId,
        period_end: group.periodEnd,
        origin_filing_id: group.originFilingId,
        detected_at: createdEvent.detectedAt,
        status: EarningsEventStatus.groupingPending,
        previous_event_id: null,
        grouping_metadata: {},
      }
      existingByOriginFilingId.set(group.originFilingId, createdEventRow)
      if (periodKey) existingByPeriodKey.set(periodKey, createdEventRow)
    }

    const removedFilingIds = existing?.grouping_metadata?.filingIds
      ?.filter((filingId) => !group.filingIds.includes(filingId)) ?? []
    await persistEarningsEventGroup({
      unlinkRemovedRelationships: () => unlinkRemovedEventRelationships(client, removedFilingIds),
      linkCurrentFilings: () => linkCurrentFilingsToEvent(client, eventId, group.filingIds),
      linkCurrentDocuments: () => linkCurrentDocumentsToEvent(client, eventId, group.filingIds),
      completeEarningsEvent: () => completeEarningsEvent(
        client,
        eventId,
        group,
        groupingMetadata,
      ),
    })

    const completedEventRow: ExistingEventRow = {
      id: eventId,
      company_id: group.companyId,
      period_end: group.periodEnd,
      origin_filing_id: group.originFilingId,
      detected_at: eventDetectedAt!,
      status: group.eventStatus,
      previous_event_id: existing?.previous_event_id ?? null,
      grouping_metadata: groupingMetadata,
    }
    existingByOriginFilingId.set(group.originFilingId, completedEventRow)
    if (periodKey) existingByPeriodKey.set(periodKey, completedEventRow)

    changedEvents += 1
    linkedFilings += group.filingIds.length
  }

  const refreshed = await fetchAllPages<PreviousEventRow>(
    async (from, to) => {
      const { data, error } = await client
        .from(DatabaseTable.earningsEvents)
        .select('id,company_id,period_end,previous_event_id')
        .not('period_end', 'is', null)
        .order('company_id')
        .order('period_end')
        .order('id')
        .range(from, to)

      return { data, error }
    },
    'Could not refresh earnings events',
  )

  const previousByCompany = new Map<string, string>()
  for (const event of refreshed) {
    const expectedPreviousId = previousByCompany.get(event.company_id) ?? null
    if (event.previous_event_id !== expectedPreviousId) {
      const { error: previousError } = await client
        .from(DatabaseTable.earningsEvents)
        .update({ previous_event_id: expectedPreviousId })
        .eq('id', event.id)
      if (previousError) throw new Error(`Could not link previous earnings event: ${previousError.message}`)
    }
    previousByCompany.set(event.company_id, event.id)
  }

  return { changedEvents, linkedFilings }
}
