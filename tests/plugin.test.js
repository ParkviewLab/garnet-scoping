// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { writeMarketplace, pluginStatus, PLUGIN_ID } from '../src/main/plugin.js'

const shipped = join(__dirname, '..', 'setup', 'garnet-scoping')
const tmp = () => mkdtemp(join(tmpdir(), 'garnet-plugin-'))

describe('writeMarketplace', () => {
  it('writes the plugin at the app version and a marketplace naming it', async () => {
    const to = await tmp()
    await writeMarketplace(shipped, '9.8.7', to)
    expect(JSON.parse(await readFile(join(to, 'garnet-scoping', '.claude-plugin', 'plugin.json'), 'utf8')).version).toBe('9.8.7')
    const m = JSON.parse(await readFile(join(to, '.claude-plugin', 'marketplace.json'), 'utf8'))
    expect(m).toMatchObject({ name: 'garnet-scoping', plugins: [{ name: 'garnet-scoping', source: './garnet-scoping' }] })
    expect(await readFile(join(to, 'garnet-scoping', 'rules.md'), 'utf8')).toBe(await readFile(join(shipped, 'rules.md'), 'utf8'))
  })
  it('removes a file no longer shipped and leaves no temporary files', async () => {
    const to = await tmp()
    await mkdir(join(to, 'garnet-scoping', 'hooks'), { recursive: true })
    await writeFile(join(to, 'garnet-scoping', 'hooks', 'old.sh'), 'x')
    await writeMarketplace(shipped, '1.0.0', to)
    const left = await readdir(join(to, 'garnet-scoping', 'hooks'))
    expect(left).not.toContain('old.sh')
    expect(left.some((f) => f.includes('.tmp-'))).toBe(false)
  })
})

async function claudeDir({ installed, settings, files = {} } = {}) {
  const d = await tmp()
  await mkdir(join(d, 'plugins'), { recursive: true })
  if (installed) await writeFile(join(d, 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { [PLUGIN_ID]: [{ scope: 'user', version: installed }] } }))
  if (settings) await writeFile(join(d, 'settings.json'), JSON.stringify(settings))
  for (const [f, text] of Object.entries(files)) {
    await mkdir(join(d, f, '..'), { recursive: true })
    await writeFile(join(d, f), text)
  }
  return d
}

describe('pluginStatus', () => {
  it('is ok when this version is installed and nothing earlier is left', async () => {
    expect(await pluginStatus('1.2.0', await claudeDir({ installed: '1.2.0', settings: {} }))).toMatchObject({ state: 'ok', ok: true, earlier: [] })
  })
  it('says missing, disabled, or another version', async () => {
    expect((await pluginStatus('1.2.0', await claudeDir())).state).toBe('missing')
    expect((await pluginStatus('1.2.0', await claudeDir({ installed: '1.2.0', settings: { enabledPlugins: { [PLUGIN_ID]: false } } }))).state).toBe('disabled')
    expect(await pluginStatus('1.2.0', await claudeDir({ installed: '1.1.0' }))).toMatchObject({ state: 'version', installedVersion: '1.1.0', ok: false })
  })
  it('finds each piece of the earlier installation', async () => {
    const d = await claudeDir({
      installed: '1.2.0',
      settings: { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'bash ~/.claude/hooks/garnet-rewake.sh' }] }] } },
      files: { 'hooks/garnet-watch.sh': '#', 'mods/garnet-board/hooks/hooks.json': '{}', 'CLAUDE.md': '# Mine\n\n## garnet-scoping signals\n\ntext\n' },
    })
    const r = await pluginStatus('1.2.0', d)
    expect(r.ok).toBe(false)
    expect(r.earlier).toHaveLength(4)
  })
})
