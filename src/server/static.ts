import { type Express } from 'express'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

export function serveVendorAssets(app: Express): void {
  const require = createRequire(import.meta.url)

  const xtermDir = dirname(require.resolve('@xterm/xterm/package.json'))
  const fitDir = dirname(require.resolve('@xterm/addon-fit/package.json'))
  const webLinksDir = dirname(require.resolve('@xterm/addon-web-links/package.json'))

  app.get('/vendor/xterm.css', (_req, res) => {
    res.sendFile(join(xtermDir, 'css', 'xterm.css'))
  })

  app.get('/vendor/xterm.js', (_req, res) => {
    res.sendFile(join(xtermDir, 'lib', 'xterm.js'))
  })

  app.get('/vendor/xterm.js.map', (_req, res) => {
    res.sendFile(join(xtermDir, 'lib', 'xterm.js.map'))
  })

  app.get('/vendor/xterm-addon-fit.js', (_req, res) => {
    res.sendFile(join(fitDir, 'lib', 'addon-fit.js'))
  })

  app.get('/vendor/xterm-addon-fit.js.map', (_req, res) => {
    res.sendFile(join(fitDir, 'lib', 'addon-fit.js.map'))
  })

  app.get('/vendor/xterm-addon-web-links.js', (_req, res) => {
    res.sendFile(join(webLinksDir, 'lib', 'addon-web-links.js'))
  })

  app.get('/vendor/xterm-addon-web-links.js.map', (_req, res) => {
    res.sendFile(join(webLinksDir, 'lib', 'addon-web-links.js.map'))
  })
}
