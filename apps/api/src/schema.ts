import { createSchema } from 'graphql-yoga'
import { ApiQueryLimit } from './constants.js'
import type { ResearchRepository } from './types.js'

export interface ApiContext {
  repository: ResearchRepository
}

function normalizedEventLimit(requestedLimit: number | null | undefined): number {
  if (requestedLimit === null || requestedLimit === undefined) {
    return ApiQueryLimit.defaultRecentEvents
  }
  return Math.min(
    Math.max(requestedLimit, ApiQueryLimit.minimumRecentEvents),
    ApiQueryLimit.maximumRecentEvents,
  )
}

export const apiSchema = createSchema<ApiContext>({
  typeDefs: /* GraphQL */ `
    type Query {
      health: ApiHealth!
      watchlistCompanies: [Company!]!
      recentPredictionEvents(limit: Int = 25): [EarningsEvent!]!
      recentUnpredictedEvents(limit: Int = 25): [EarningsEvent!]!
      predictionEvidence(predictionId: ID!): PredictionEvidence
    }

    type ApiHealth {
      service: String!
      ready: Boolean!
    }

    type Company {
      id: ID!
      legalName: String!
      ticker: String!
      exchange: String
      sector: String
      isActive: Boolean!
    }

    type EarningsEvent {
      id: ID!
      companyId: ID!
      companyName: String!
      ticker: String!
      sector: String
      periodEnd: String
      detectedAt: String!
      status: String!
      latestPrediction: Prediction
    }

    type Prediction {
      id: ID!
      score: Int!
      financialScore: Int!
      qualitativeScore: Int!
      uncappedCombinedScore: Int!
      scoreComponents: [ScoreComponent!]!
      ruleVersion: String!
      cutoffAt: String!
      recordedAt: String!
      plannedEntrySession: String!
      plannedDay1Session: String!
      plannedDay5Session: String!
      plannedDay20Session: String!
      summary: String
      guidanceDirection: String!
      guidanceSummary: String
      marginDirection: String!
      managementTone: String!
      mainRisk: String
      evaluations: [Evaluation!]!
    }

    type ScoreComponent {
      code: String!
      category: String!
      points: Int!
      explanation: String!
    }

    type Evaluation {
      horizonDays: Int!
      stockReturn: Float!
      marketReturn: Float!
      sectorReturn: Float
      stockMinusMarketReturn: Float!
      stockMinusSectorReturn: Float
      calculatedAt: String!
    }

    type PredictionEvidence {
      predictionId: ID!
      extractionSchemaVersion: String!
      evidence: [QualitativeEvidence!]!
    }

    type QualitativeEvidence {
      fieldPath: String!
      category: String!
      claim: String!
      passageId: String!
      quote: String!
      startCharacter: Int!
      endCharacter: Int!
      source: EvidenceSource!
    }

    type EvidenceSource {
      documentId: ID!
      role: String!
      documentType: String!
      publishedAt: String!
      sourceUrl: String!
    }
  `,
  resolvers: {
    Query: {
      health: () => ({ service: 'chiron-api', ready: true }),
      watchlistCompanies: (
        _parent: unknown,
        _argumentsValue: Record<string, never>,
        context: ApiContext,
      ) => context.repository.getWatchlistCompanies(),
      recentPredictionEvents: (
        _parent: unknown,
        argumentsValue: { limit?: number | null },
        context: ApiContext,
      ) => context.repository.getRecentPredictionEvents(normalizedEventLimit(argumentsValue.limit)),
      recentUnpredictedEvents: (
        _parent: unknown,
        argumentsValue: { limit?: number | null },
        context: ApiContext,
      ) => context.repository.getRecentUnpredictedEvents(
        normalizedEventLimit(argumentsValue.limit),
      ),
      predictionEvidence: (
        _parent: unknown,
        argumentsValue: { predictionId: string },
        context: ApiContext,
      ) => context.repository.getPredictionEvidence(argumentsValue.predictionId),
    },
  },
})
