import { ApiEnvironmentVariable, ApiServerConfig } from './constants.js'

export interface ApiConfig {
  supabaseUrl: string
  supabaseSecretKey: string
  port: number
}

function requiredEnvironmentValue(variableName: string): string {
  const value = process.env[variableName]?.trim()
  if (!value) throw new Error(`Missing required environment variable: ${variableName}`)
  return value
}

function apiPort(): number {
  const configuredPort = process.env[ApiEnvironmentVariable.port]?.trim()
  if (!configuredPort) return ApiServerConfig.defaultPort

  const parsedPort = Number(configuredPort)
  if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65_535) {
    throw new Error(`${ApiEnvironmentVariable.port} must be an integer from 1 to 65535`)
  }
  return parsedPort
}

export function loadApiConfig(): ApiConfig {
  return {
    supabaseUrl: requiredEnvironmentValue(ApiEnvironmentVariable.supabaseUrl),
    supabaseSecretKey: requiredEnvironmentValue(ApiEnvironmentVariable.supabaseSecretKey),
    port: apiPort(),
  }
}
