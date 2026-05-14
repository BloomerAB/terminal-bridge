const { Terminal } = window
const { FitAddon } = window.FitAddon
const { WebLinksAddon } = window.WebLinksAddon

const state = {
  currentTarget: null,
  ws: null,
  terminal: null,
  fitAddon: null,
  reconnectTimer: null,
  sessions: [],
  externalTerminals: [],
}

const $ = (sel) => document.querySelector(sel)
const $sidebar = $('#sidebar')
const $overlay = document.createElement('div')
$overlay.className = 'overlay'
document.body.appendChild($overlay)

function toggleSidebar(open) {
  const isOpen = open ?? !$sidebar.classList.contains('open')
  $sidebar.classList.toggle('open', isOpen)
  $overlay.classList.toggle('visible', isOpen)
}

$('#btn-sidebar').addEventListener('click', () => toggleSidebar(true))
$('#btn-close-sidebar').addEventListener('click', () => toggleSidebar(false))
$overlay.addEventListener('click', () => toggleSidebar(false))

async function fetchSessions() {
  try {
    const [sessionsRes, terminalsRes] = await Promise.all([
      fetch('/api/sessions'),
      fetch('/api/terminals'),
    ])
    state.sessions = await sessionsRes.json()
    state.externalTerminals = await terminalsRes.json()
  } catch {
    // Keep previous state on failure
  }
  renderSessions()
}

const WINDOW_COLORS = ['#7aa2f7', '#bb9af7', '#9ece6a', '#e0af68', '#7dcfff', '#f7768e']

function groupPanesByWindow(panes) {
  const windows = new Map()
  for (const pane of panes) {
    const key = pane.windowIndex
    if (!windows.has(key)) {
      windows.set(key, { index: key, name: pane.windowName, panes: [] })
    }
    windows.get(key).panes.push(pane)
  }
  return Array.from(windows.values())
}

function shortLabel(label) {
  const m = label.match(/^(.+?)\s*\(/)
  const name = m ? m[1] : label
  if (name.length > 18) return name.slice(0, 16) + '..'
  return name
}

function renderMinimap(panes, color) {
  if (panes.length <= 1) return ''

  const totalW = Math.max(...panes.map((p) => p.left + p.width))
  const totalH = Math.max(...panes.map((p) => p.top + p.height))

  const cells = panes
    .map((pane) => {
      const x = ((pane.left / totalW) * 100).toFixed(1)
      const y = ((pane.top / totalH) * 100).toFixed(1)
      const w = ((pane.width / totalW) * 100).toFixed(1)
      const h = ((pane.height / totalH) * 100).toFixed(1)
      const isActive = pane.target === state.currentTarget
      return `<div class="minimap-cell ${isActive ? 'active' : ''}" data-target="${pane.target}"
        style="left:${x}%;top:${y}%;width:${w}%;height:${h}%;border-color:${color}">
        <span class="minimap-label">${shortLabel(pane.label)}</span>
      </div>`
    })
    .join('')

  return `<div class="minimap" style="--map-color:${color}">${cells}</div>`
}

function renderSessions() {
  const $list = $('#session-list')

  if (state.sessions.length === 0) {
    $list.innerHTML = '<div class="empty-state"><span class="hint">No tmux sessions running</span></div>'
    return
  }

  const filtered = state.sessions.filter((s) => !s.name.startsWith('bridge-'))
  const vscodeSessions = filtered.filter((s) => s.name.startsWith('vscode-'))
  const otherSessions = filtered.filter((s) => !s.name.startsWith('vscode-'))

  function renderSessionWindows(session, windowOffset) {
    const windows = groupPanesByWindow(session.panes)
    const showWindowHeaders = windows.length > 1

    return windows
      .map((win) => {
        const color = WINDOW_COLORS[(win.index + windowOffset) % WINDOW_COLORS.length]
        const minimap = renderMinimap(win.panes, color)

        const singlePane = win.panes.length === 1
        const panesHtml = singlePane
          ? win.panes
              .map(
                (pane) => `
            <div class="pane-item ${pane.target === state.currentTarget ? 'active' : ''}" data-target="${pane.target}">
              <span class="window-stripe" style="background: ${color}"></span>
              <span class="pane-indicator ${pane.active ? 'active' : ''}"></span>
              <span class="pane-command">${pane.label}</span>
            </div>
          `
              )
              .join('')
          : ''

        const header = showWindowHeaders
          ? `<div class="window-header">
              <span class="window-dot" style="background: ${color}"></span>
              <span class="window-name">${win.name || `window ${win.index}`}</span>
            </div>`
          : ''

        return header + minimap + (singlePane ? `<div class="pane-list">${panesHtml}</div>` : '')
      })
      .join('')
  }

  let html = ''

  if (vscodeSessions.length > 0) {
    const allPanes = vscodeSessions.flatMap((s) => s.panes)
    const anyAttached = vscodeSessions.some((s) => s.attached)

    let windowOffset = 0
    const sessionsHtml = vscodeSessions
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((session) => {
        const color = WINDOW_COLORS[windowOffset % WINDOW_COLORS.length]
        windowOffset++

        const allPanesInSession = session.panes
        const windows = groupPanesByWindow(allPanesInSession)

        const firstPane = allPanesInSession[0]
        const sessionLabel = firstPane
          ? (firstPane.cwd.split('/').pop() || session.name)
          : session.name

        const windowsContent = windows
          .map((win) => {
            const minimap = renderMinimap(win.panes, color)
            const panesHtml = win.panes.length === 1
              ? win.panes
                  .map(
                    (pane) => `
                <div class="pane-item ${pane.target === state.currentTarget ? 'active' : ''}" data-target="${pane.target}">
                  <span class="window-stripe" style="background: ${color}"></span>
                  <span class="pane-indicator ${pane.active ? 'active' : ''}"></span>
                  <span class="pane-command">${pane.label}</span>
                </div>
              `
                  )
                  .join('')
              : ''
            return minimap + (win.panes.length === 1 ? `<div class="pane-list">${panesHtml}</div>` : '')
          })
          .join('')

        return `
          <div class="window-header">
            <span class="window-dot" style="background: ${color}"></span>
            <span class="window-name">${sessionLabel}</span>
          </div>
          ${windowsContent}`
      })
      .join('')

    html += `
      <div class="session-group">
        <div class="session-header">
          <span class="session-dot ${anyAttached ? 'attached' : 'detached'}"></span>
          <span class="session-name">VS Code</span>
          <span class="session-count">${allPanes.length} panes</span>
        </div>
        ${sessionsHtml}
      </div>
    `
  }

  html += otherSessions
    .map((session) => `
      <div class="session-group">
        <div class="session-header">
          <span class="session-dot ${session.attached ? 'attached' : 'detached'}"></span>
          <span class="session-name">${session.name}</span>
          <span class="session-count">${session.panes.length} panes</span>
        </div>
        ${renderSessionWindows(session, 0)}
      </div>
    `)
    .join('')

  $list.innerHTML = html

  const grouped = new Map()
  for (const t of state.externalTerminals) {
    const terminals = grouped.get(t.app) ?? []
    terminals.push(t)
    grouped.set(t.app, terminals)
  }

  if (grouped.size > 0) {
    const extHtml = Array.from(grouped.entries())
      .map(([app, terminals]) => {
        const items = terminals
          .map((t) => {
            const dir = t.cwd.split('/').pop() || t.cwd
            return `
              <div class="pane-item" data-ext-cwd="${t.cwd.replace(/"/g, '&quot;')}">
                <span class="pane-indicator"></span>
                <span class="pane-command">${t.command} (${dir})</span>
              </div>`
          })
          .join('')

        return `
          <div class="session-group">
            <div class="session-header">
              <span class="session-dot detached"></span>
              <span class="session-name">${app}</span>
              <span class="session-count">${terminals.length} shells</span>
            </div>
            <div class="pane-list">${items}</div>
          </div>`
      })
      .join('')

    $list.innerHTML += extHtml
  }

  $list.querySelectorAll('[data-target]').forEach((el) => {
    el.addEventListener('click', () => {
      const target = el.dataset.target
      if (target) {
        connectToPane(target)
        toggleSidebar(false)
      }
    })
  })

  $list.querySelectorAll('[data-ext-cwd]').forEach((el) => {
    el.addEventListener('click', async () => {
      const cwd = el.dataset.extCwd
      const dir = cwd.split('/').pop() || 'shell'
      const name = `vscode-${dir}`.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 30)
      try {
        const res = await fetch('/api/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, cwd }),
        })
        if (res.ok) {
          await fetchSessions()
          connectToPane(`${name}:0.0`)
          toggleSidebar(false)
        }
      } catch {
        // ignore
      }
    })
  })
}

$('#new-session-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const input = $('#new-session-name')
  const name = input.value.trim()
  if (!name) return

  try {
    const res = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    if (res.ok) {
      input.value = ''
      await fetchSessions()
      connectToPane(`${name}:0.0`)
      toggleSidebar(false)
    }
  } catch {
    // ignore
  }
})

function initTerminal() {
  if (state.terminal) {
    state.terminal.dispose()
  }

  const container = $('#terminal-container')
  container.innerHTML = ''

  const terminal = new Terminal({
    fontSize: 14,
    fontFamily: "'SF Mono', 'Menlo', 'Monaco', monospace",
    theme: {
      background: '#1a1b26',
      foreground: '#c0caf5',
      cursor: '#c0caf5',
      selectionBackground: '#33467c',
      black: '#15161e',
      red: '#f7768e',
      green: '#9ece6a',
      yellow: '#e0af68',
      blue: '#7aa2f7',
      magenta: '#bb9af7',
      cyan: '#7dcfff',
      white: '#a9b1d6',
      brightBlack: '#414868',
      brightRed: '#f7768e',
      brightGreen: '#9ece6a',
      brightYellow: '#e0af68',
      brightBlue: '#7aa2f7',
      brightMagenta: '#bb9af7',
      brightCyan: '#7dcfff',
      brightWhite: '#c0caf5',
    },
    cursorBlink: true,
    scrollback: 5000,
    allowProposedApi: true,
  })

  const fitAddon = new FitAddon()
  terminal.loadAddon(fitAddon)
  terminal.loadAddon(new WebLinksAddon())

  terminal.open(container)
  fitAddon.fit()
  setupTouchScroll(terminal)

  state.terminal = terminal
  state.fitAddon = fitAddon

  return { terminal, fitAddon }
}

function setStatus(status) {
  const $indicator = $('#status-indicator')
  $indicator.className = `status-indicator ${status}`
}

function connectToPane(target) {
  if (state.ws) {
    state.ws.close()
    state.ws = null
  }

  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer)
    state.reconnectTimer = null
  }

  state.currentTarget = target
  const pane = state.sessions.flatMap((s) => s.panes).find((p) => p.target === target)
  $('#current-session').textContent = pane ? pane.label : target
  setStatus('connecting')

  const { terminal, fitAddon } = initTerminal()

  const cols = terminal.cols
  const rows = terminal.rows
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const ws = new WebSocket(`${protocol}//${location.host}/ws?target=${encodeURIComponent(target)}&cols=${cols}&rows=${rows}`)

  state.ws = ws

  ws.addEventListener('open', () => {
    setStatus('connected')
    terminal.focus()

    terminal.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }))
      }
    })

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit()
    })
    resizeObserver.observe($('#terminal-container'))
  })

  ws.addEventListener('message', (event) => {
    try {
      const msg = JSON.parse(event.data)
      if (msg.type === 'output') {
        terminal.write(msg.data)
      } else if (msg.type === 'exit') {
        setStatus('disconnected')
        fetchSessions()
      } else if (msg.type === 'error') {
        terminal.write(`\r\n\x1b[31mError: ${msg.message}\x1b[0m\r\n`)
        setStatus('disconnected')
      }
    } catch {
      // ignore
    }
  })

  ws.addEventListener('close', () => {
    setStatus('disconnected')
    state.reconnectTimer = setTimeout(() => {
      if (state.currentTarget === target) {
        connectToPane(target)
      }
    }, 3000)
  })

  ws.addEventListener('error', () => {
    setStatus('disconnected')
  })

  fetchSessions()
}

function handleResize() {
  if (state.fitAddon) {
    state.fitAddon.fit()
  }
}

function setupTouchScroll(terminal) {
  const el = terminal.element
  if (!el) return

  let touchStartY = 0
  let accumulated = 0
  const LINE_HEIGHT = 20

  el.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
      touchStartY = e.touches[0].clientY
      accumulated = 0
    }
  }, { passive: true })

  el.addEventListener('touchmove', (e) => {
    if (e.touches.length !== 1) return
    const dy = touchStartY - e.touches[0].clientY
    touchStartY = e.touches[0].clientY
    accumulated += dy

    const lines = Math.trunc(accumulated / LINE_HEIGHT)
    if (lines !== 0) {
      accumulated -= lines * LINE_HEIGHT
      terminal.scrollLines(lines)
    }
    e.preventDefault()
  }, { passive: false })
}

window.addEventListener('resize', handleResize)

if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', () => {
    document.documentElement.style.height = `${window.visualViewport.height}px`
    handleResize()
  })
}

function showEmptyState() {
  const container = $('#terminal-container')
  container.innerHTML = `
    <div class="empty-state">
      <span style="font-size: 24px; color: var(--text-dim);">terminal-bridge</span>
      <span class="hint">Select a pane or create a new session</span>
    </div>
  `
}

fetchSessions()
showEmptyState()
setInterval(fetchSessions, 5000)
