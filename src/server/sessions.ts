import { execSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

export type TPane = {
  readonly sessionName: string
  readonly windowIndex: number
  readonly windowName: string
  readonly paneIndex: number
  readonly command: string
  readonly cwd: string
  readonly title: string
  readonly label: string
  readonly size: string
  readonly active: boolean
  readonly target: string
  readonly top: number
  readonly left: number
  readonly width: number
  readonly height: number
}

export type TSession = {
  readonly name: string
  readonly windows: number
  readonly attached: boolean
  readonly panes: readonly TPane[]
}

export type TExternalTerminal = {
  readonly pid: number
  readonly app: string
  readonly cwd: string
  readonly command: string
}

const CLAUDE_PROJECTS_DIR = join(homedir(), '.claude', 'projects')

export function listSessions(): readonly TSession[] {
  const panes = listPanes()
  const sessionMap = new Map<string, { windows: Set<number>; attached: boolean; panes: TPane[] }>()

  for (const pane of panes) {
    const existing = sessionMap.get(pane.sessionName)
    if (existing) {
      existing.windows.add(pane.windowIndex)
      existing.panes.push(pane)
    } else {
      sessionMap.set(pane.sessionName, {
        windows: new Set([pane.windowIndex]),
        attached: false,
        panes: [pane],
      })
    }
  }

  try {
    const output = execSync(
      `tmux list-sessions -F '#{session_name}${SEP}#{session_attached}'`,
      { encoding: 'utf-8', timeout: 5000 }
    )
    for (const line of output.trim().split('\n').filter(Boolean)) {
      const [name = '', attached = '0'] = line.split(SEP)
      const session = sessionMap.get(name)
      if (session) {
        session.attached = attached !== '0'
      }
    }
  } catch {
    // ignore
  }

  return Array.from(sessionMap.entries()).map(([name, data]) => ({
    name,
    windows: data.windows.size,
    attached: data.attached,
    panes: data.panes,
  }))
}

const SEP = '|||'

function listPanes(): TPane[] {
  try {
    const fmt = [
      '#{session_name}', '#{window_index}', '#{window_name}', '#{pane_index}',
      '#{pane_current_command}', '#{pane_width}x#{pane_height}', '#{pane_active}',
      '#{pane_current_path}', '#{pane_title}', '#{pane_pid}',
      '#{pane_top}', '#{pane_left}', '#{pane_width}', '#{pane_height}',
    ].join(SEP)
    const output = execSync(
      `tmux list-panes -a -F '${fmt}'`,
      { encoding: 'utf-8', timeout: 5000 }
    )
    const claudeTitles = resolveClaudeTitles(output)
    return output
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => parsePane(line, claudeTitles))
  } catch {
    return []
  }
}

function resolveClaudeTitles(paneOutput: string): Map<string, string> {
  const titles = new Map<string, string>()

  const claudePids = paneOutput
    .trim()
    .split('\n')
    .filter(Boolean)
    .filter((line) => line.includes(`${SEP}claude${SEP}`) || line.includes(`${SEP}node${SEP}`))
    .map((line) => {
      const parts = line.split(SEP)
      return { panePid: parts[9] ?? '', target: `${parts[0]}:${parts[1]}.${parts[3]}` }
    })
    .filter((p) => p.panePid)

  for (const { panePid, target } of claudePids) {
    try {
      const childOutput = execSync(
        `pgrep -P ${panePid} -f claude 2>/dev/null | head -1`,
        { encoding: 'utf-8', timeout: 3000 }
      ).trim()

      if (!childOutput) continue

      const args = execSync(
        `ps -p ${childOutput} -o args= 2>/dev/null`,
        { encoding: 'utf-8', timeout: 3000 }
      ).trim()

      const resumeMatch = args.match(/--resume\s+(\S+)/)
      if (!resumeMatch) continue

      const sessionRef = resumeMatch[1]
      const title = lookupClaudeTitle(sessionRef)
      if (title) {
        titles.set(target, title)
      }
    } catch {
      // ignore
    }
  }

  return titles
}

function lookupClaudeTitle(sessionRef: string): string | null {
  const isUuid = /^[a-f0-9-]{36}$/.test(sessionRef)

  if (!isUuid) {
    return sessionRef.replace(/-/g, ' ')
  }

  try {
    const projectDirs = readdirSync(CLAUDE_PROJECTS_DIR)
    for (const dir of projectDirs) {
      const jsonlPath = join(CLAUDE_PROJECTS_DIR, dir, `${sessionRef}.jsonl`)
      try {
        const content = readFileSync(jsonlPath, 'utf-8')
        const lines = content.split('\n').filter(Boolean)
        for (let i = lines.length - 1; i >= 0; i--) {
          try {
            const obj = JSON.parse(lines[i]) as { type?: string; aiTitle?: string }
            if (obj.type === 'ai-title' && obj.aiTitle) {
              return obj.aiTitle
            }
          } catch {
            // skip malformed lines
          }
        }
      } catch {
        // file doesn't exist in this project dir
      }
    }
  } catch {
    // ignore
  }

  return null
}

function parsePane(line: string, claudeTitles: Map<string, string>): TPane {
  const parts = line.split(SEP)
  const [sessionName = '', windowIndex = '0', windowName = '', paneIndex = '0', command = '', size = '', active = '0', cwd = '', title = ''] = parts
  const wi = parseInt(windowIndex, 10)
  const pi = parseInt(paneIndex, 10)
  const dirName = cwd.split('/').pop() ?? cwd
  const target = `${sessionName}:${wi}.${pi}`
  const claudeTitle = claudeTitles.get(target)
  return {
    sessionName,
    windowIndex: wi,
    windowName,
    paneIndex: pi,
    command,
    cwd,
    title,
    label: buildLabel(command, claudeTitle, dirName),
    size,
    active: active === '1',
    target,
    top: parseInt(parts[10] ?? '0', 10),
    left: parseInt(parts[11] ?? '0', 10),
    width: parseInt(parts[12] ?? '80', 10),
    height: parseInt(parts[13] ?? '24', 10),
  }
}

function buildLabel(command: string, claudeTitle: string | undefined, dirName: string): string {
  if (command === 'claude' && claudeTitle) {
    return `${claudeTitle} (${dirName})`
  }
  if (command === 'claude') {
    return `Claude Code (${dirName})`
  }
  return `${command} (${dirName})`
}

export function createSession(name: string, cwd?: string): TSession {
  const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '')
  if (!safeName) {
    throw new Error('Invalid session name')
  }

  try {
    const cwdFlag = cwd ? ` -c ${escapeShellArg(cwd)}` : ''
    execSync(`tmux new-session -d -s ${safeName}${cwdFlag}`, {
      encoding: 'utf-8',
      timeout: 5000,
    })
  } catch (error) {
    throw new Error(`Failed to create session: ${error}`)
  }

  const sessions = listSessions()
  const session = sessions.find(s => s.name === safeName)
  if (!session) {
    throw new Error('Session created but not found')
  }
  return session
}

export function paneExists(target: string): boolean {
  return listPanes().some(p => p.target === target)
}

export function sessionExists(name: string): boolean {
  return listSessions().some(s => s.name === name)
}

export function listExternalTerminals(): readonly TExternalTerminal[] {
  try {
    const tmuxPids = new Set<string>()
    try {
      const tmuxOutput = execSync(
        `tmux list-panes -a -F '#{pane_pid}'`,
        { encoding: 'utf-8', timeout: 3000 }
      )
      for (const line of tmuxOutput.trim().split('\n').filter(Boolean)) {
        tmuxPids.add(line.trim())
      }
    } catch {
      // no tmux sessions
    }

    const psOutput = execSync(
      `ps -eo pid,ppid,command`,
      { encoding: 'utf-8', timeout: 3000 }
    )

    const processes = new Map<string, { ppid: string; command: string }>()
    for (const line of psOutput.trim().split('\n').slice(1)) {
      const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/)
      if (match) {
        processes.set(match[1], { ppid: match[2], command: match[3] })
      }
    }

    const shells: TExternalTerminal[] = []

    for (const [pid, proc] of processes) {
      const isShell = /^-?(zsh|bash|fish)$/.test(proc.command.split('/').pop()?.split(' ')[0] ?? '')
      if (!isShell) continue
      if (tmuxPids.has(pid)) continue

      const app = resolveParentApp(pid, processes)
      if (!app) continue

      let cwd = ''
      try {
        cwd = execSync(`lsof -p ${pid} -Fn 2>/dev/null | grep '^n/' | grep cwd | head -1`, {
          encoding: 'utf-8',
          timeout: 2000,
        }).trim().replace(/^n/, '').replace('cwd', '')

        if (!cwd) {
          cwd = execSync(`lsof -d cwd -p ${pid} -Fn 2>/dev/null | tail -1`, {
            encoding: 'utf-8',
            timeout: 2000,
          }).trim().replace(/^n/, '')
        }
      } catch {
        // skip
      }

      shells.push({
        pid: parseInt(pid, 10),
        app,
        cwd: cwd || '~',
        command: proc.command.split('/').pop()?.split(' ')[0] ?? proc.command,
      })
    }

    return shells
  } catch {
    return []
  }
}

function escapeShellArg(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`
}

function resolveParentApp(pid: string, processes: Map<string, { ppid: string; command: string }>): string | null {
  let current = pid
  const visited = new Set<string>()

  while (current && !visited.has(current)) {
    visited.add(current)
    const proc = processes.get(current)
    if (!proc) return null

    const cmd = proc.command.toLowerCase()
    if (cmd.includes('visual studio code') || cmd.includes('electron') && cmd.includes('code')) {
      return 'VS Code'
    }
    if (cmd.includes('iterm2') || cmd.includes('iterm')) {
      return 'iTerm2'
    }
    if (cmd.includes('terminal.app') || (cmd.includes('login') && proc.ppid === '1')) {
      return 'Terminal.app'
    }

    current = proc.ppid
  }

  return null
}
