import './load-env.js'
import { loadApiConfig } from './config.js'
import { ApiServerConfig } from './constants.js'
import { createApiServer } from './server.js'

const config = loadApiConfig()
const server = createApiServer(config)

server.listen(config.port, ApiServerConfig.host, () => {
  console.log(
    `Chiron API is available at http://${ApiServerConfig.host}:${config.port}${ApiServerConfig.graphqlPath}`,
  )
})
