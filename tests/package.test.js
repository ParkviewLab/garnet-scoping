// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi } from 'vitest'
import { existsSync } from 'node:fs'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { parse } from 'yaml'

vi.mock('electron', () => ({ app: {}, BrowserWindow: class {}, shell: {} }))

const root = join(__dirname, '..')
const files = (dir) => readdirSync(dir, { withFileTypes: true, recursive: true }).filter((d) => d.isFile()).map((d) => relative(dir, join(d.parentPath, d.name)))

describe('the package', () => {
  it('ships the whole setup folder, which Set-up Info installs from', () => {
    const { extraResources } = parse(readFileSync(join(root, 'electron-builder.yml'), 'utf8'))
    const setup = extraResources.find((r) => r.from === 'setup')
    expect(setup).toMatchObject({ to: 'setup', filter: ['**/*'] })
  })
  it('ships a plugin whose hooks name scripts it holds', () => {
    const plugin = join(root, 'setup', 'garnet-scoping')
    expect(JSON.parse(readFileSync(join(plugin, '.claude-plugin', 'plugin.json'), 'utf8')).name).toBe('garnet-scoping')
    const hooks = JSON.parse(readFileSync(join(plugin, 'hooks', 'hooks.json'), 'utf8'))
    for (const m of hooks.modules) expect(existsSync(join(plugin, 'hooks', m))).toBe(true)
    const commands = Object.values(hooks.hooks).flat().flatMap((h) => h.hooks.map((x) => x.command))
    expect(commands.length).toBe(3)
    for (const c of commands) {
      const script = c.match(/hooks\/([\w-]+\.sh)/)[1]
      expect(files(plugin)).toContain(join('hooks', script))
    }
    expect(files(plugin)).toContain('rules.md')
  })
})
