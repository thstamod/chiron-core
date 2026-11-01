import { createServer } from 'node:http'
import { createClient } from '@supabase/supabase-js'
import { createYoga } from 'graphql-yoga'
import type { ApiConfig } from './config.js'
import { ApiServerConfig } from './constants.js'
import { createResearchRepository } from './research-repository.js'
import { apiSchema, type ApiContext } from './schema.js'

export function createApiServer(config: ApiConfig) {
  const databaseClient = createClient(config.supabaseUrl, config.supabaseSecretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const repository = createResearchRepository(databaseClient)
  const yoga = createYoga<ApiContext>({
    schema: apiSchema,
    graphqlEndpoint: ApiServerConfig.graphqlPath,
    context: { repository },
    cors: false,
  })

  return createServer(yoga)
}
