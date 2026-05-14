import { execSync } from 'node:child_process'
import type { WebSocket } from 'ws'

type TTerminalInstance = {
  readonly target: string
  readonly pollTimer: ReturnType<typeof setInterval>
  lastLines: readonly string[]
}

const terminals = new Map<WebSocket, TTerminalInstance>()

function findTmux(): string {
  try {
    return execSync('which tmux', { encoding: 'utf-8' }).trim()
  } catch {
    return '/usr/local/bin/tmux'
  }
}

const TMUX_PATH = findTmux()

const SPECIAL_KEYS: Record<string, string> = {
  '\r': 'Enter',
  '\n': 'Enter',
  '\x7f': 'BSpace',
  '\x1b': 'Escape',
  '\t': 'Tab',
  '\x1b[A': 'Up',
  '\x1b[B': 'Down',
  '\x1b[C': 'Right',
  '\x1b[D': 'Left',
  '\x1bOA': 'Up',
  '\x1bOB': 'Down',
  '\x1bOC': 'Right',
  '\x1bOD': 'Left',
  '\x1b[H': 'Home',
  '\x1b[F': 'End',
  '\x1b[3~': 'DC',
  '\x1b[5~': 'PageUp',
  '\x1b[6~': 'PageDown',
}

function capturePane(target: string): string {
  try {
    return execSync(
      `${TMUX_PATH} capture-pane -t ${target} -p -e`,
      { encoding: 'utf-8', timeout: 3000 }
    )
  } catch {
    return ''
  }
}

function captureScrollback(target: string): string {
  try {
    return execSync(
      `${TMUX_PATH} capture-pane -t ${target} -p -e -S -`,
      { encoding: 'utf-8', timeout: 3000 }
    )
  } catch {
    return ''
  }
}

function getCursorPosition(target: string): { row: number; col: number } {
  try {
    const output = execSync(
      `${TMUX_PATH} display-message -t ${target} -p '#{cursor_y} #{cursor_x}'`,
      { encoding: 'utf-8', timeout: 3000 }
    ).trim()
    const [row = '0', col = '0'] = output.split(' ')
    return { row: parseInt(row, 10), col: parseInt(col, 10) }
  } catch {
    return { row: 0, col: 0 }
  }
}

export function attachToPane(ws: WebSocket, target: string, _cols: number, _rows: number): void {
  const scrollback = captureScrollback(target)
  const scrollLines = scrollback.replace(/\n$/, '').split('\n')
  const visible = capturePane(target)
  const visibleLines = visible.replace(/\n$/, '').split('\n')

  const scrollbackOnly = scrollLines.slice(0, Math.max(0, scrollLines.length - visibleLines.length))
  const recentScrollback = scrollbackOnly.slice(-200)
  if (recentScrollback.length > 0 && ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify({
      type: 'output',
      data: recentScrollback.join('\r\n') + '\r\n',
    }))
  }

  if (visible && ws.readyState === ws.OPEN) {
    const cursor = getCursorPosition(target)
    const frame = '\x1b[H' +
      visibleLines.join('\x1b[K\r\n') +
      '\x1b[K\x1b[J' +
      `\x1b[${cursor.row + 1};${cursor.col + 1}H`
    ws.send(JSON.stringify({ type: 'output', data: frame }))
  }

  let lastNormalized = visibleLines.map(stripAnsi)

  const pollTimer = setInterval(() => {
    if (ws.readyState !== ws.OPEN) {
      clearInterval(pollTimer)
      return
    }
    const content = capturePane(target)
    if (!content) return

    const lines = content.replace(/\n$/, '').split('\n')
    const normalized = lines.map(stripAnsi)

    let firstDiff = 0
    while (firstDiff < normalized.length && firstDiff < lastNormalized.length && normalized[firstDiff] === lastNormalized[firstDiff]) {
      firstDiff++
    }

    if (firstDiff >= normalized.length && normalized.length === lastNormalized.length) return

    const scrollAmount = detectScroll(lastNormalized, normalized)
    const cursor = getCursorPosition(target)

    if (scrollAmount > 0) {
      const newLines = lines.slice(lines.length - scrollAmount)
      const frame = `\x1b[${normalized.length};1H` +
        newLines.map((l) => '\r\n' + l + '\x1b[K').join('') +
        `\x1b[${cursor.row + 1};${cursor.col + 1}H`
      ws.send(JSON.stringify({ type: 'output', data: frame }))
    } else {
      const changedLines = lines.slice(firstDiff)
      const frame = `\x1b[${firstDiff + 1};1H` +
        changedLines.join('\x1b[K\r\n') +
        '\x1b[K\x1b[J' +
        `\x1b[${cursor.row + 1};${cursor.col + 1}H`
      ws.send(JSON.stringify({ type: 'output', data: frame }))
    }
    lastNormalized = normalized
  }, 100)

  const instance: TTerminalInstance = { target, pollTimer, lastLines: lastNormalized }
  terminals.set(ws, instance)

  ws.on('message', (raw: Buffer | string) => {
    try {
      const msg = JSON.parse(raw.toString()) as { type: string; data?: string }
      if (msg.type === 'input' && msg.data) {
        sendKeys(target, msg.data)
      }
    } catch {
      // ignore
    }
  })

  ws.on('close', () => {
    clearInterval(pollTimer)
    terminals.delete(ws)
  })
}

function sendKeys(target: string, data: string): void {
  try {
    const specialKey = SPECIAL_KEYS[data]
    if (specialKey) {
      execSync(`${TMUX_PATH} send-keys -t ${target} ${specialKey}`, {
        encoding: 'utf-8',
        timeout: 3000,
      })
      return
    }

    if (data.length === 1 && data.charCodeAt(0) < 32) {
      const ctrl = `C-${String.fromCharCode(data.charCodeAt(0) + 96)}`
      execSync(`${TMUX_PATH} send-keys -t ${target} ${ctrl}`, {
        encoding: 'utf-8',
        timeout: 3000,
      })
      return
    }

    execSync(
      `${TMUX_PATH} send-keys -t ${target} -l -- ${escapeForShell(data)}`,
      { encoding: 'utf-8', timeout: 3000 }
    )
  } catch {
    // ignore
  }
}

function detectScroll(prev: readonly string[], next: readonly string[]): number {
  if (prev.length !== next.length || prev.length === 0) return 0
  for (let shift = 1; shift <= Math.min(prev.length - 1, 20); shift++) {
    let match = true
    for (let i = 0; i < prev.length - shift; i++) {
      if (prev[i + shift] !== next[i]) {
        match = false
        break
      }
    }
    if (match) return shift
  }
  return 0
}

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').trimEnd()
}

function escapeForShell(input: string): string {
  return `'${input.replace(/'/g, "'\\''")}'`
}

export function getActiveCount(): number {
  return terminals.size
}
