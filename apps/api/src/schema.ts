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
      recentPredictionEvents(limit: Int = 25): [EarningsEvent!]!
    }

    type ApiHealth {
      service: String!
      ready: Boolean!
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
  `,
  resolvers: {
    Query: {
      health: () => ({ service: 'chiron-api', ready: true }),
      recentPredictionEvents: (
        _parent: unknown,
        argumentsValue: { limit?: number | null },
        context: ApiContext,
      ) => context.repository.getRecentPredictionEvents(normalizedEventLimit(argumentsValue.limit)),
    },
  },
})
