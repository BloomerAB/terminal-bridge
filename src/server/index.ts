import express from 'express'
import { WebSocketServer } from 'ws'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { listSessions, createSession, paneExists, listExternalTerminals } from './sessions.js'
import { attachToPane, getActiveCount } from './terminal.js'
import { serveVendorAssets } from './static.js'

const PORT = parseInt(process.env.PORT ?? '7681', 10)
const HOST = process.env.HOST ?? '0.0.0.0'

const app = express()
const server = createServer(app)
const wss = new WebSocketServer({ server, path: '/ws' })

const __dirname = dirname(fileURLToPath(import.meta.url))

app.use(express.json())
serveVendorAssets(app)
app.use(express.static(join(__dirname, '..', 'client')))

type TSessionCache = {
  sessions: ReturnType<typeof listSessions>
  terminals: ReturnType<typeof listExternalTerminals>
  timestamp: number
}

let sessionCache: TSessionCache | null = null
const CACHE_TTL_MS = 2000

function getCachedData(): TSessionCache {
  const now = Date.now()
  if (sessionCache && now - sessionCache.timestamp < CACHE_TTL_MS) {
    return sessionCache
  }
  sessionCache = {
    sessions: listSessions(),
    terminals: listExternalTerminals(),
    timestamp: now,
  }
  return sessionCache
}

app.get('/api/sessions', (_req, res) => {
  res.json(getCachedData().sessions)
})

app.get('/api/terminals', (_req, res) => {
  res.json(getCachedData().terminals)
})

app.post('/api/sessions', (req, res) => {
  const { name, cwd } = req.body as { name?: string; cwd?: string }
  if (!name || typeof name !== 'string') {
    res.status(400).json({ error: 'name is required' })
    return
  }
  try {
    const session = createSession(name, cwd)
    sessionCache = null
    res.status(201).json(session)
  } catch (error) {
    res.status(400).json({ error: String(error) })
  }
})

app.get('/api/status', (_req, res) => {
  res.json({
    sessions: listSessions().length,
    activeConnections: getActiveCount(),
    uptime: process.uptime(),
  })
})

wss.on('connection', (ws, req) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`)
  const target = url.searchParams.get('target')
  const cols = parseInt(url.searchParams.get('cols') ?? '80', 10)
  const rows = parseInt(url.searchParams.get('rows') ?? '24', 10)

  if (!target) {
    ws.send(JSON.stringify({ type: 'error', message: 'target parameter required (e.g. main:0.1)' }))
    ws.close()
    return
  }

  if (!paneExists(target)) {
    ws.send(JSON.stringify({ type: 'error', message: `pane "${target}" not found` }))
    ws.close()
    return
  }

  attachToPane(ws, target, cols, rows)
})

server.listen(PORT, HOST, () => {
  console.log(`terminal-bridge listening on http://${HOST}:${PORT}`)
})
