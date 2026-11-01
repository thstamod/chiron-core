import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

const repositoryEnvPath = fileURLToPath(new URL('../../../.env', import.meta.url))

if (existsSync(repositoryEnvPath)) {
  dotenv.config({ path: repositoryEnvPath, quiet: true })
}
