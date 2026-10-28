import './load-env.js'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { WorkerHealth } from '@chiron/shared'
import {
  loadFilingSyncConfig,
  loadDatabaseConfig,
  loadOpenAILanguageModelConfig,
  loadSecRequestConfig,
  type FilingSyncConfig,
  type SecRequestConfig,
} from './config.js'
import {
  EarningsCategory,
  JobName,
  WorkerCommand,
  WorkerCommandFlag,
  WorkerHealthConfig,
  WorkerTiming,
} from './constants.js'
import {
  checkDatabase,
  createDatabaseClient,
  getActiveCompanies,
  getPendingDocumentsForTextExtraction,
  getPendingDocumentsForFinancialMetricExtraction,
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
import {
  documentTextExtractionVersion,
  extractAndStoreDocumentText,
} from './document-text.js'
import {
  extractAndStoreFinancialMetrics,
} from './financial-metrics.js'
import {
  calculateAndStoreFinancialDerivedMetrics,
} from './financial-derived-metrics.js'
import { financialMetricExtractionVersion } from './xbrl.js'
import { buildEarningsEventGroups, saveEarningsEventGroups } from './events.js'
import { runTrackedJob } from './jobs.js'
import {
  classifyEarningsFiling,
  earningsClassificationRuleVersion,
  fetchRecentFilings,
} from './sec.js'
import { previewQualitativeExtraction } from './qualitative-preview.js'
import { createOpenAIQualitativeExtractionProvider } from './openai-qualitative-provider.js'
import { extractAndStoreQualitativeAnalysis } from './qualitative-extraction-run.js'
import {
  loadCorrectedQualitativeOutput,
  parseQualitativeReviewDecision,
  recordQualitativeExtractionReview,
} from './qualitative-extraction-review.js'

async function runHealthCheck(): Promise<void> {
  const config = loadDatabaseConfig()
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
  config: FilingSyncConfig,
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
  config: SecRequestConfig,
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

async function extractDocumentText(client: SupabaseClient): Promise<Record<string, unknown>> {
  const pendingDocuments = await getPendingDocumentsForTextExtraction(
    client,
    documentTextExtractionVersion,
  )
  let extractedDocuments = 0
  let unsupportedDocuments = 0

  console.log(
    `Checking ${pendingDocuments.length} documents with ${documentTextExtractionVersion}`,
  )

  for (const document of pendingDocuments) {
    const wasExtracted = await extractAndStoreDocumentText(client, document)
    if (wasExtracted) {
      extractedDocuments += 1
    } else {
      unsupportedDocuments += 1
    }
  }

  console.log(
    `Text extraction complete: ${extractedDocuments} extracted, `
    + `${unsupportedDocuments} unsupported documents skipped`,
  )

  return {
    pendingDocuments: pendingDocuments.length,
    extractedDocuments,
    unsupportedDocuments,
    extractionVersion: documentTextExtractionVersion,
  }
}

async function extractFinancialMetrics(
  client: SupabaseClient,
): Promise<Record<string, unknown>> {
  const pendingDocuments = await getPendingDocumentsForFinancialMetricExtraction(
    client,
    financialMetricExtractionVersion,
  )
  let extractedMetrics = 0
  let extractionWarnings = 0

  console.log(
    `Checking ${pendingDocuments.length} periodic reports with ${financialMetricExtractionVersion}`,
  )

  for (const document of pendingDocuments) {
    const extraction = await extractAndStoreFinancialMetrics(client, document)
    extractedMetrics += extraction.metrics.length
    extractionWarnings += extraction.warnings.length
    console.log(
      `${document.ticker}: extracted ${extraction.metrics.length} metrics from `
      + `${document.formType} for ${document.reportDate}`,
    )
  }

  console.log(
    `Financial metric extraction complete: ${extractedMetrics} metrics and `
    + `${extractionWarnings} warnings`,
  )

  return {
    pendingDocuments: pendingDocuments.length,
    extractedMetrics,
    extractionWarnings,
    extractionVersion: financialMetricExtractionVersion,
  }
}

async function calculateFinancialDerivedMetrics(
  client: SupabaseClient,
): Promise<Record<string, unknown>> {
  const summary = await calculateAndStoreFinancialDerivedMetrics(client)

  console.log(
    `Financial calculations complete: ${summary.pendingEvents} events processed, `
    + `${summary.calculatedMetrics} metrics calculated, and ${summary.warnings} warnings`,
  )

  return { ...summary }
}

function requireCommandOption(commandArguments: string[], optionPrefix: string): string {
  const matchingArguments = commandArguments.filter((argument) => (
    argument.startsWith(optionPrefix)
  ))
  if (matchingArguments.length !== 1) {
    throw new Error(`Expected exactly one ${optionPrefix} option`)
  }
  const value = matchingArguments[0]!.slice(optionPrefix.length).trim()
  if (!value) throw new Error(`${optionPrefix} option cannot be empty`)
  return value
}

function optionalCommandOption(
  commandArguments: string[],
  optionPrefix: string,
): string | undefined {
  const matchingArguments = commandArguments.filter((argument) => (
    argument.startsWith(optionPrefix)
  ))
  if (matchingArguments.length > 1) {
    throw new Error(`Expected at most one ${optionPrefix} option`)
  }
  const value = matchingArguments[0]?.slice(optionPrefix.length).trim()
  if (matchingArguments.length === 1 && !value) {
    throw new Error(`${optionPrefix} option cannot be empty`)
  }
  return value
}

function requireSinglePositionalArgument(
  commandArguments: string[],
  commandName: string,
): string {
  const positionalArguments = commandArguments.filter((argument) => !argument.startsWith('--'))
  if (positionalArguments.length !== 1 || !positionalArguments[0]!.trim()) {
    throw new Error(`${commandName} requires exactly one positional argument`)
  }
  return positionalArguments[0]!.trim()
}

function rejectUnknownCommandOptions(
  commandArguments: string[],
  allowedOptionPrefixes: string[],
): void {
  const unknownOptions = commandArguments.filter((argument) => (
    argument.startsWith('--')
    && !allowedOptionPrefixes.some((prefix) => argument.startsWith(prefix))
  ))
  if (unknownOptions.length > 0) {
    throw new Error(`Unknown command options: ${unknownOptions.join(', ')}`)
  }
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? WorkerCommand.health
  const commandArguments = process.argv.slice(3).filter((argument) => argument !== '--')

  if (command === WorkerCommand.health) {
    await runHealthCheck()
    return
  }

  const databaseConfig = loadDatabaseConfig()
  const client = createDatabaseClient(databaseConfig)

  switch (command) {
    case WorkerCommand.syncFilings: {
      const filingSyncConfig = loadFilingSyncConfig()
      await runTrackedJob(
        client,
        JobName.filingsSync,
        () => syncFilings(client, filingSyncConfig),
      )
      break
    }
    case WorkerCommand.syncDocuments: {
      const secRequestConfig = loadSecRequestConfig()
      await runTrackedJob(
        client,
        JobName.documentsSync,
        () => syncDocuments(client, secRequestConfig),
      )
      break
    }
    case WorkerCommand.syncEvents:
      await runTrackedJob(client, JobName.eventsSync, () => syncEvents(client))
      break
    case WorkerCommand.extractDocumentText:
      await runTrackedJob(
        client,
        JobName.documentTextExtraction,
        () => extractDocumentText(client),
      )
      break
    case WorkerCommand.extractFinancialMetrics:
      await runTrackedJob(
        client,
        JobName.financialMetricExtraction,
        () => extractFinancialMetrics(client),
      )
      break
    case WorkerCommand.calculateFinancialDerivedMetrics:
      await runTrackedJob(
        client,
        JobName.financialDerivedMetricCalculation,
        () => calculateFinancialDerivedMetrics(client),
      )
      break
    case WorkerCommand.previewQualitativeExtraction: {
      const earningsEventId = commandArguments[0]?.trim()
      if (!earningsEventId) {
        throw new Error('preview-qualitative requires an earnings event ID')
      }
      const preview = await previewQualitativeExtraction(
        client,
        earningsEventId,
        new Date().toISOString(),
      )
      console.log(JSON.stringify(preview, null, 2))
      break
    }
    case WorkerCommand.extractQualitative: {
      const earningsEventId = commandArguments.find(
        (argument) => argument !== WorkerCommandFlag.executePaidRequest,
      )?.trim()
      if (!earningsEventId) {
        throw new Error('extract-qualitative requires an earnings event ID')
      }
      if (!commandArguments.includes(WorkerCommandFlag.executePaidRequest)) {
        throw new Error(
          `extract-qualitative requires ${WorkerCommandFlag.executePaidRequest}`,
        )
      }
      const provider = createOpenAIQualitativeExtractionProvider(
        loadOpenAILanguageModelConfig(),
      )
      const summary = await runTrackedJob(
        client,
        JobName.qualitativeExtraction,
        () => extractAndStoreQualitativeAnalysis(
          client,
          provider,
          earningsEventId,
          new Date().toISOString(),
        ),
      )
      console.log(JSON.stringify(summary, null, 2))
      break
    }
    case WorkerCommand.reviewQualitativeExtraction: {
      const reviewOptionPrefixes = [
        WorkerCommandFlag.reviewDecision,
        WorkerCommandFlag.reviewerLabel,
        WorkerCommandFlag.reviewNotes,
        WorkerCommandFlag.correctedOutputFile,
      ]
      rejectUnknownCommandOptions(commandArguments, reviewOptionPrefixes)
      const extractionRunId = requireSinglePositionalArgument(
        commandArguments,
        WorkerCommand.reviewQualitativeExtraction,
      )
      const decision = parseQualitativeReviewDecision(
        requireCommandOption(commandArguments, WorkerCommandFlag.reviewDecision),
      )
      const reviewerLabel = requireCommandOption(
        commandArguments,
        WorkerCommandFlag.reviewerLabel,
      )
      const notes = requireCommandOption(commandArguments, WorkerCommandFlag.reviewNotes)
      const correctedOutputFile = optionalCommandOption(
        commandArguments,
        WorkerCommandFlag.correctedOutputFile,
      )
      const correctedOutput = correctedOutputFile
        ? await loadCorrectedQualitativeOutput(correctedOutputFile)
        : undefined
      const summary = await recordQualitativeExtractionReview(client, {
        extractionRunId,
        decision,
        reviewerLabel,
        notes,
        correctedOutput,
      })
      console.log(JSON.stringify(summary, null, 2))
      break
    }
    default:
      throw new Error(`Unknown worker command: ${command}`)
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`Chiron worker failed: ${message}`)
  process.exitCode = 1
})
