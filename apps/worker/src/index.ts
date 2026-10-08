import './load-env.js'
import type { WorkerHealth } from '@chiron/shared'
import { loadConfig } from './config.js'
import {
  checkDatabase,
  createDatabaseClient,
  getActiveCompanies,
  getFilingsForDocumentSync,
  getStoredPrimaryDocumentFilingIds,
  saveFilingCandidates,
  updateFilingClassification,
} from './database.js'
import { downloadAndStorePrimaryDocument } from './documents.js'
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
    service: 'chiron-worker',
    phase: 'ingestion',
    ready: true,
    checkedAt: new Date().toISOString(),
    companyCount,
  }

  console.log(JSON.stringify(health, null, 2))
}

async function syncFilings(): Promise<void> {
  const config = loadConfig()
  const client = createDatabaseClient(config)
  const companies = await getActiveCompanies(client)
  const cutoff = new Date(Date.now() - config.secLookbackDays * 86_400_000)
    .toISOString()
    .slice(0, 10)

  console.log(`Checking SEC filings for ${companies.length} companies since ${cutoff}`)

  for (const company of companies) {
    const filings = await fetchRecentFilings(company, config.secUserAgent, cutoff)
    await saveFilingCandidates(client, filings)
    console.log(`${company.ticker}: ${filings.length} matching filing records checked`)
  }
}

async function syncDocuments(): Promise<void> {
  const config = loadConfig()
  const client = createDatabaseClient(config)
  const filings = await getFilingsForDocumentSync(client)
  const storedFilingIds = await getStoredPrimaryDocumentFilingIds(client)
  let earningsRelatedCount = 0
  let downloadedCount = 0

  console.log(`Classifying ${filings.length} SEC filings with ${earningsClassificationRuleVersion}`)

  for (const filing of filings) {
    const classification = classifyEarningsFiling(filing.formType, filing.items)
    if (filing.earningsClassification?.ruleVersion !== earningsClassificationRuleVersion) {
      await updateFilingClassification(client, filing.id, classification)
    }

    if (!classification.isEarningsRelated) continue
    earningsRelatedCount += 1

    if (storedFilingIds.has(filing.id)) continue

    await downloadAndStorePrimaryDocument(client, filing, config.secUserAgent)
    downloadedCount += 1
    console.log(`${filing.ticker}: stored ${filing.formType} ${filing.accessionNumber}`)
    await new Promise((resolve) => setTimeout(resolve, 125))
  }

  console.log(
    `Document sync complete: ${earningsRelatedCount} earnings-related, ${downloadedCount} newly stored`,
  )
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'health'

  switch (command) {
    case 'health':
      await runHealthCheck()
      break
    case 'sync-filings':
      await syncFilings()
      break
    case 'sync-documents':
      await syncDocuments()
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
