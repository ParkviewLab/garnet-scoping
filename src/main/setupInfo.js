// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The Set-up Info window: copyable text for starting to use garnet-scoping
// with Claude Code. The commands that install and update the garnet-scoping
// plugin (P5); text that has Claude remove the installation that came before
// the plugin; and the channel's configuration and the terminal command that
// loads it.

import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { mkdir, cp, writeFile } from 'node:fs/promises'
import { writeMarketplace, MARKET, MARKET_DIR, PLUGIN_ID } from './plugin.js'

// The channel's scripts are copied to the app's own folder at start, so that
// Claude Code finds them at one path whatever the install: an AppImage runs
// from a mount whose path changes on every launch. Its configuration is
// written there too.
export const CHANNEL_DIR = join(homedir(), '.garnet-scoping', 'channel')
const MCP_PATH = join(homedir(), '.garnet-scoping', 'channel.mcp.json')
export async function installChannel() {
  const from = join(resources(), 'channel')
  await mkdir(CHANNEL_DIR, { recursive: true })
  await cp(from, CHANNEL_DIR, { recursive: true, force: true })
  await writeFile(MCP_PATH, channelConfig() + '\n')
}

// The plugin's marketplace, written at each start at the app's own version
// (P5).
export const installPlugin = () => writeMarketplace(join(resources(), 'setup', 'garnet-scoping'), app.getVersion())

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

// The app's shipped files: Resources in the packaged app, the repository in
// development.
const resources = () => (app.isPackaged ? process.resourcesPath : join(__dirname, '../..'))

function channelConfig() {
  // The binary that runs the channel: the AppImage itself when the app runs
  // from one; otherwise the app's executable (in development, where the
  // installed app would be: the macOS bundle, or the Ubuntu package under /opt).
  const installed = process.platform === 'darwin' ? '/Applications/garnet-scoping.app/Contents/MacOS/garnet-scoping' : '/opt/garnet-scoping/garnet-scoping'
  const binary = process.env.APPIMAGE || (app.isPackaged ? process.execPath : installed)
  const channelScript = join(CHANNEL_DIR, 'garnet-channel.mjs')
  return JSON.stringify({ mcpServers: { garnet: { command: binary, args: [channelScript], env: { ELECTRON_RUN_AS_NODE: '1' } } } }, null, 2)
}

export function setupTexts() {
  const market = MARKET_DIR.replace(homedir(), '~')
  const install = `claude plugin marketplace add ${market}\nclaude plugin install ${PLUGIN_ID}`
  const update = `claude plugin marketplace update ${MARKET}\nclaude plugin update ${PLUGIN_ID}`
  const earlier = `Please remove the earlier installation of garnet-scoping from my Claude Code set-up; the garnet-scoping plugin (${PLUGIN_ID}) replaces it. Read each file before changing it.

1. If \`claude plugin list\` does not show ${PLUGIN_ID} enabled, run \`claude plugin marketplace add ${market}\` and \`claude plugin install ${PLUGIN_ID}\` first.
2. In ~/.claude/settings.json, remove every hook whose command runs ~/.claude/hooks/garnet-rewake.sh or ~/.claude/hooks/garnet-session-start.sh, keeping every other hook.
3. Delete ~/.claude/hooks/garnet-watch.sh, ~/.claude/hooks/garnet-rewake.sh and ~/.claude/hooks/garnet-session-start.sh.
4. Delete the folder ~/.claude/mods/garnet-board.
5. In ~/.claude/CLAUDE.md, remove the section headed "## garnet-scoping signals", up to the next heading of the same or a higher level; the plugin now gives each session these rules.
The plugin's hooks and board tools take effect in sessions started from then on.`
  const command = `claude --mcp-config ${MCP_PATH.replace(homedir(), '~')} --dangerously-load-development-channels server:garnet`
  return { install, update, earlier, mcp: channelConfig(), mcpPath: MCP_PATH, command }
}

let win = null
export function openSetupInfo() {
  if (win && !win.isDestroyed()) return win.focus()
  const t = setupTexts()
  const block = (id, text) => `<div class="block"><pre id="${id}">${esc(text)}</pre><button data-copy="${id}">Copy</button></div>`
  const html = `<!doctype html><meta charset="utf-8"><title>Set-up Info</title><style>
  :root{--bg:#1e1f22;--panel:#17181a;--fg:#dcddde;--muted:#8b8e94;--line:#2a2c30;--accent:#d0607a}
  *{box-sizing:border-box}
  html,body{margin:0;background:var(--bg);color:var(--fg);font:13px/1.55 system-ui,sans-serif}
  main{padding:18px 24px 26px}
  h1{margin:0 0 4px;font-size:16px}
  h2{margin:22px 0 6px;font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
  p{margin:0 0 8px;max-width:46em}
  .block{position:relative}
  pre{margin:0;padding:10px 12px;background:var(--panel);border:1px solid var(--line);border-radius:6px;white-space:pre-wrap;word-break:break-word;font:12px/1.5 ui-monospace,Menlo,monospace;-webkit-user-select:text;user-select:text}
  button{position:absolute;top:6px;right:6px;font:inherit;font-size:12px;color:var(--fg);background:#26282c;border:1px solid var(--line);border-radius:5px;padding:2px 10px;cursor:pointer}
  button:hover{border-color:var(--accent)}
  code{font-family:ui-monospace,Menlo,monospace}
  a{color:var(--accent)}
</style><main>
<h1>Set-up Info</h1>
<p>garnet-scoping shows each session; these steps let your signals (Review on the board, Discuss on a row, Hold) reach Claude even when you send no message.</p>
<h2>1. Install the garnet-scoping plugin (once)</h2>
<p>The plugin brings the watcher, the board tools and the rules for answering your signals into every Claude Code session. Run these two commands in a terminal; the plugin takes effect in sessions started afterwards, and is listed on the Claude app's Plugins page.</p>
${block('install', t.install)}
<h2>2. After each update of garnet-scoping</h2>
<p>When a session window says the plugin is of another version, run these:</p>
${block('update', t.update)}
<h2>3. If you set up garnet-scoping before the plugin</h2>
<p>Versions up to 0.12 installed the watcher's hooks, the rules in your <code>~/.claude/CLAUDE.md</code> and the garnet-board extension one by one. Left beside the plugin they run a second watcher. Paste this into any Claude Code session to have Claude remove them:</p>
${block('earlier', t.earlier)}
<h2>4. The channel, for terminal sessions (optional)</h2>
<p>A channel delivers the signals at once, without the watcher. Claude Code supports channels only in the terminal for now, as a research preview; the desktop app does not load them yet. The app writes this configuration to <code>${esc(t.mcpPath)}</code>:</p>
${block('mcp', t.mcp)}
<p>Start a terminal session with the channel by running this, and confirm the prompt about development channels:</p>
${block('command', t.command)}
</main>
<script>
document.addEventListener('click', (e) => {
  const id = e.target.dataset && e.target.dataset.copy
  if (!id) return
  const r = document.createRange(); r.selectNodeContents(document.getElementById(id))
  const s = getSelection(); s.removeAllRanges(); s.addRange(r)
  document.execCommand('copy'); s.removeAllRanges()
  e.target.textContent = 'Copied'; setTimeout(() => (e.target.textContent = 'Copy'), 1200)
})
addEventListener('keydown', (e) => { if (e.key === 'Escape') window.close() })
</script>`
  win = new BrowserWindow({ width: 760, height: 720, minWidth: 480, title: 'Set-up Info', backgroundColor: '#1e1f22', webPreferences: { contextIsolation: true, sandbox: true } })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  win.on('closed', () => (win = null))
}
