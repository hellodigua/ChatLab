import express from 'express'
import cors from 'cors'

export function createApp() {
  const app = express()

  app.use(cors())
  app.use(express.json())

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' })
  })

  return app
}

const port = process.env.PORT || 3001

// Only start the server when this file is run directly (not when imported by tests)
const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith('server/index.ts') ||
    process.argv[1].endsWith('server/index.js'))

if (isDirectRun) {
  const app = createApp()
  app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`)
  })
}
