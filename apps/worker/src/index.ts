import './load-env.js'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { WorkerHealth } from '@chiron/shared'
import { loadConfig, type WorkerConfig } from './config.js'
import {
  EarningsCategory,
  JobName,
  WorkerCommand,
  WorkerHealthConfig,
  WorkerTiming,
} from './constants.js'
import {
  checkDatabase,
  createDatabaseClient,
  getActiveCompanies,
  getFilingsForDocumentSync,
  getStoredDocumentSourceUrls,
  saveFilingCandidates,
  updateExhibitDiscovery,
  updateFilingClassification,
} from './database.js'
import {
  downloadAndStoreDocument,
  exhibitDiscoveryRuleVersion,
  fetchEarningsReleaseExhibits,
  primaryDocumentCandidate,
} from './documents.js'
import { buildEarningsEventGroups, saveEarningsEventGroups } from './events.js'
import { runTrackedJob } from './jobs.js'
import {
  classifyEarningsFiling,
  earningsClassificationRuleVersion,
  fetchRecentFilings,
} from './sec.js'

async function runHealthCheck(): Promise<void> {
  const config = loadConfig()
  const client = createDatabaseClient(config)
  const companyCount = await checkDatabase(client)
  const health: WorkerHealth & { companyCount: number } = {
    service: WorkerHealthConfig.service,
    phase: WorkerHealthConfig.phase,
    ready: true,
    checkedAt: new Date().toISOString(),
    companyCount,
  }

  console.log(JSON.stringify(health, null, 2))
}

async function syncFilings(
  client: SupabaseClient,
  config: WorkerConfig,
): Promise<Record<string, unknown>> {
  const companies = await getActiveCompanies(client)
  const cutoff = new Date(
    Date.now() - config.secLookbackDays * WorkerTiming.millisecondsPerDay,
  )
    .toISOString()
    .slice(0, 10)

  console.log(`Checking SEC filings for ${companies.length} companies since ${cutoff}`)

  let checkedFilings = 0
  let newFilings = 0
  for (const company of companies) {
    const filings = await fetchRecentFilings(company, config.secUserAgent, cutoff)
    newFilings += await saveFilingCandidates(client, filings)
    checkedFilings += filings.length
    console.log(`${company.ticker}: ${filings.length} matching filing records checked`)
  }

  return { companies: companies.length, checkedFilings, newFilings, cutoff }
}

async function syncDocuments(
  client: SupabaseClient,
  config: WorkerConfig,
): Promise<Record<string, unknown>> {
  const filings = await getFilingsForDocumentSync(client)
  const storedSourceUrls = await getStoredDocumentSourceUrls(client)
  let earningsRelatedCount = 0
  let primaryDocumentsStored = 0
  let exhibitsStored = 0
  let exhibitsFound = 0

  console.log(`Classifying ${filings.length} SEC filings with ${earningsClassificationRuleVersion}`)

  for (const filing of filings) {
    const classification = classifyEarningsFiling(filing.formType, filing.items)
    if (filing.earningsClassification?.ruleVersion !== earningsClassificationRuleVersion) {
      await updateFilingClassification(client, filing.id, classification)
    }

    if (!classification.isEarningsRelated) continue
    earningsRelatedCount += 1

    const primaryDocument = primaryDocumentCandidate(filing)
    if (!storedSourceUrls.has(primaryDocument.sourceUrl)) {
      await downloadAndStoreDocument(client, filing, primaryDocument, config.secUserAgent)
      storedSourceUrls.add(primaryDocument.sourceUrl)
      primaryDocumentsStored += 1
      console.log(`${filing.ticker}: stored ${filing.formType} ${filing.accessionNumber}`)
      await new Promise((resolve) => setTimeout(resolve, WorkerTiming.secRequestDelayMs))
    }

    if (
      classification.category === EarningsCategory.release
      && filing.exhibitDiscoveryVersion !== exhibitDiscoveryRuleVersion
    ) {
      const exhibits = await fetchEarningsReleaseExhibits(filing, config.secUserAgent)
      exhibitsFound += exhibits.length

      for (const exhibit of exhibits) {
        if (storedSourceUrls.has(exhibit.sourceUrl)) continue
        await downloadAndStoreDocument(client, filing, exhibit, config.secUserAgent)
        storedSourceUrls.add(exhibit.sourceUrl)
        exhibitsStored += 1
        console.log(`${filing.ticker}: stored Exhibit 99.1 ${exhibit.filename}`)
        await new Promise((resolve) => setTimeout(resolve, WorkerTiming.secRequestDelayMs))
      }

      await updateExhibitDiscovery(client, filing.id, {
        ruleVersion: exhibitDiscoveryRuleVersion,
        checkedAt: new Date().toISOString(),
        foundCount: exhibits.length,
        sourceUrls: exhibits.map((exhibit) => exhibit.sourceUrl),
      })
    }
  }

  console.log(
    `Document sync complete: ${earningsRelatedCount} earnings-related, `
    + `${primaryDocumentsStored} primary documents and ${exhibitsStored} exhibits newly stored`,
  )

  return {
    checkedFilings: filings.length,
    earningsRelatedFilings: earningsRelatedCount,
    primaryDocumentsStored,
    exhibitsFound,
    exhibitsStored,
  }
}

async function syncEvents(client: SupabaseClient): Promise<Record<string, unknown>> {
  const filings = await getFilingsForDocumentSync(client)
  const groups = buildEarningsEventGroups(filings)
  const result = await saveEarningsEventGroups(client, groups)

  console.log(
    `Event sync complete: ${groups.length} groups, ${result.changedEvents} created or updated`,
  )

  return { eventGroups: groups.length, ...result }
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? WorkerCommand.health

  if (command === WorkerCommand.health) {
    await runHealthCheck()
    return
  }

  const config = loadConfig()
  const client = createDatabaseClient(config)

  switch (command) {
    case WorkerCommand.syncFilings:
      await runTrackedJob(client, JobName.filingsSync, () => syncFilings(client, config))
      break
    case WorkerCommand.syncDocuments:
      await runTrackedJob(client, JobName.documentsSync, () => syncDocuments(client, config))
      break
    case WorkerCommand.syncEvents:
      await runTrackedJob(client, JobName.eventsSync, () => syncEvents(client))
      break
    default:
      throw new Error(`Unknown worker command: ${command}`)
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`Chiron worker failed: ${message}`)
  process.exitCode = 1
})
