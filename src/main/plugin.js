// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The garnet-scoping plugin for Claude Code (P5). At each start the app writes
// a local plugin marketplace to its own folder, holding the plugin at the
// app's own version; the person installs from it with Claude Code's plugin
// commands (Set-up Info). The app never writes in the Claude configuration
// directory (R5.1): `pluginStatus` only reads what Claude Code has installed.

import { readFile, writeFile, readdir, mkdir, rename, rm } from 'node:fs/promises'
import { join, dirname, relative } from 'node:path'
import { homedir } from 'node:os'

export const MARKET = 'garnet-scoping'
export const PLUGIN = 'garnet-scoping'
export const PLUGIN_ID = `${PLUGIN}@${MARKET}`
export const MARKET_DIR = join(homedir(), '.garnet-scoping', 'claude-plugin')

async function filesUnder(dir) {
  const out = []
  for (const d of await readdir(dir, { withFileTypes: true, recursive: true }))
    if (d.isFile()) out.push(relative(dir, join(d.parentPath, d.name)))
  return out
}

// Writes a file by a temporary name moved over the old one, so that nothing
// reads it half written.
async function put(file, data) {
  await mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}`
  await writeFile(tmp, data)
  await rename(tmp, file)
}

// Writes the marketplace from the shipped plugin folder `from`, the plugin
// given `version`. Files no longer shipped are removed.
export async function writeMarketplace(from, version, to = MARKET_DIR) {
  const plugin = join(to, PLUGIN)
  const shipped = await filesUnder(from)
  for (const f of shipped) {
    let data = await readFile(join(from, f))
    if (f === join('.claude-plugin', 'plugin.json')) data = JSON.stringify({ ...JSON.parse(data), version }, null, 2) + '\n'
    await put(join(plugin, f), data)
  }
  for (const f of await filesUnder(plugin).catch(() => [])) if (!shipped.includes(f)) await rm(join(plugin, f), { force: true })
  const market = { name: MARKET, owner: { name: 'garnet-scoping' }, plugins: [{ name: PLUGIN, source: `./${PLUGIN}`, description: 'garnet-scoping inside Claude Code: the signal watcher, the board tools and the rules', version }] }
  await put(join(to, '.claude-plugin', 'marketplace.json'), JSON.stringify(market, null, 2) + '\n')
}

const readJson = async (file) => {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return null
  }
}

// What Claude Code has installed, against this app's `version` (P5). Reads
// only. `state` is 'ok', 'missing', 'disabled' or 'version'; `earlier` lists
// what is left of the installation before the plugin, which would run a
// second watcher.
export async function pluginStatus(version, claudeDir = join(homedir(), '.claude')) {
  const installed = await readJson(join(claudeDir, 'plugins', 'installed_plugins.json'))
  const entries = installed?.plugins?.[PLUGIN_ID]
  const entry = Array.isArray(entries) ? (entries.find((e) => e?.scope === 'user') ?? entries[0]) : null
  const settings = await readJson(join(claudeDir, 'settings.json'))
  let state = 'ok'
  if (!entry) state = 'missing'
  else if (settings?.enabledPlugins?.[PLUGIN_ID] === false) state = 'disabled'
  else if (entry.version !== version) state = 'version'

  const earlier = []
  const hooks = JSON.stringify(settings?.hooks ?? {})
  if (/\.claude\/hooks\/garnet-(rewake|session-start|watch)\.sh/.test(hooks)) earlier.push('the garnet hooks in ~/.claude/settings.json')
  for (const f of ['garnet-watch.sh', 'garnet-rewake.sh', 'garnet-session-start.sh'])
    if (await readFile(join(claudeDir, 'hooks', f)).then(() => true, () => false)) {
      earlier.push('the scripts in ~/.claude/hooks')
      break
    }
  if (await readdir(join(claudeDir, 'mods', 'garnet-board')).then(() => true, () => false)) earlier.push('~/.claude/mods/garnet-board')
  const md = await readFile(join(claudeDir, 'CLAUDE.md'), 'utf8').catch(() => '')
  if (/^## garnet-scoping signals\s*$/m.test(md)) earlier.push('the "garnet-scoping signals" section in ~/.claude/CLAUDE.md')
  return { state, installedVersion: entry?.version ?? null, version, earlier, ok: state === 'ok' && !earlier.length }
}
