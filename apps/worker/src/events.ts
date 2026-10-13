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
  const groups = new Map<string, SecFilingRecord[]>()
  const anchorByKey = new Map<string, SecFilingRecord>()

  for (const anchor of anchors) {
    const key = eventKey(anchor.companyId, anchor.reportDate!)
    const current = anchorByKey.get(key)
    if (!current || filingTimestamp(anchor) < filingTimestamp(current)) {
      anchorByKey.set(key, anchor)
    }
  }

  for (const [key, anchor] of anchorByKey) groups.set(key, [anchor])

  for (const filing of filings) {
    const isPeriodicReport = periodicSecForms.has(filing.formType)
    if (filing.reportDate && isPeriodicReport) {
      const exactGroup = groups.get(eventKey(filing.companyId, filing.reportDate))
      if (exactGroup && !exactGroup.some((member) => member.id === filing.id)) {
        exactGroup.push(filing)
        continue
      }
    }

    const classification = classifyEarningsFiling(filing.formType, filing.items)
    if (classification.category !== EarningsCategory.release) continue

    const filingTime = filingTimestamp(filing)
    const closestAnchor = [...anchorByKey.values()]
      .filter((anchor) => anchor.companyId === filing.companyId)
      .map((anchor) => ({ anchor, distance: Math.abs(filingTime - filingTimestamp(anchor)) }))
      .filter(({ distance }) => distance <= WorkerTiming.eventGroupingWindowMs)
      .sort((left, right) => left.distance - right.distance)[0]?.anchor

    if (!closestAnchor?.reportDate) continue
    const group = groups.get(eventKey(closestAnchor.companyId, closestAnchor.reportDate))
    if (group && !group.some((member) => member.id === filing.id)) group.push(filing)
  }

  return [...groups.entries()]
    .map(([key, members]) => {
      const anchor = anchorByKey.get(key)!

      return {
        companyId: anchor.companyId,
        periodEnd: anchor.reportDate!,
        anchorAccessionNumber: anchor.accessionNumber,
        filingIds: members.map((filing) => filing.id).sort(),
        ruleVersion: eventGroupingRuleVersion,
      }
    })
    .sort((left, right) => left.periodEnd.localeCompare(right.periodEnd))
}

interface ExistingEventRow {
  id: string
  company_id: string
  period_end: string
  detected_at: string
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
  saveCompletedGroupingMetadata: () => Promise<void>
}

export async function persistEarningsEventGroup(
  actions: EventGroupPersistenceActions,
): Promise<void> {
  await actions.unlinkRemovedRelationships()
  await actions.linkCurrentFilings()
  await actions.linkCurrentDocuments()
  await actions.saveCompletedGroupingMetadata()
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
      status: EarningsEventStatus.detected,
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

async function saveCompletedGroupingMetadata(
  client: SupabaseClient,
  eventId: string,
  groupingMetadata: Record<string, unknown>,
): Promise<void> {
  const { error } = await client
    .from(DatabaseTable.earningsEvents)
    .update({ grouping_metadata: groupingMetadata })
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
        .select('id,company_id,period_end,detected_at,previous_event_id,grouping_metadata')
        .order('company_id')
        .order('period_end')
        .order('id')
        .range(from, to)

      return { data: data as ExistingEventRow[] | null, error }
    },
    'Could not load earnings events',
  )
  const existingByKey = new Map(
    existingRows.map((event) => [eventKey(event.company_id, event.period_end), event]),
  )
  let changedEvents = 0
  let linkedFilings = 0

  for (const group of groups) {
    const key = eventKey(group.companyId, group.periodEnd)
    const existing = existingByKey.get(key)
    const unchanged = existing
      && existing.grouping_metadata?.ruleVersion === group.ruleVersion
      && existing.grouping_metadata.persistenceVersion === eventPersistenceVersion
      && sameFilingIds(existing.grouping_metadata.filingIds, group.filingIds)

    if (unchanged) continue

    const groupingMetadata = {
      ruleVersion: group.ruleVersion,
      persistenceVersion: eventPersistenceVersion,
      anchorAccessionNumber: group.anchorAccessionNumber,
      filingIds: group.filingIds,
      groupedAt: new Date().toISOString(),
    }
    let eventId = existing?.id

    if (!eventId) {
      const createdEvent = await createPendingEarningsEvent(client, group)
      eventId = createdEvent.eventId
      existingByKey.set(key, {
        id: eventId,
        company_id: group.companyId,
        period_end: group.periodEnd,
        detected_at: createdEvent.detectedAt,
        previous_event_id: null,
        grouping_metadata: {},
      })
    }

    const removedFilingIds = existing?.grouping_metadata?.filingIds
      ?.filter((filingId) => !group.filingIds.includes(filingId)) ?? []
    await persistEarningsEventGroup({
      unlinkRemovedRelationships: () => unlinkRemovedEventRelationships(client, removedFilingIds),
      linkCurrentFilings: () => linkCurrentFilingsToEvent(client, eventId, group.filingIds),
      linkCurrentDocuments: () => linkCurrentDocumentsToEvent(client, eventId, group.filingIds),
      saveCompletedGroupingMetadata: () => saveCompletedGroupingMetadata(
        client,
        eventId,
        groupingMetadata,
      ),
    })

    changedEvents += 1
    linkedFilings += group.filingIds.length
  }

  const refreshed = await fetchAllPages<PreviousEventRow>(
    async (from, to) => {
      const { data, error } = await client
        .from(DatabaseTable.earningsEvents)
        .select('id,company_id,period_end,previous_event_id')
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
