// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { parse } from 'yaml'

vi.mock('electron', () => ({ app: {}, BrowserWindow: class {}, shell: {} }))
const { BOARD_FILES } = await import('../src/main/setupInfo.js')

const root = join(__dirname, '..')
const files = (dir) => readdirSync(dir, { withFileTypes: true, recursive: true }).filter((d) => d.isFile()).map((d) => relative(dir, join(d.parentPath, d.name)))

describe('the package', () => {
  it('ships the whole setup folder, which Set-up Info installs from', () => {
    const { extraResources } = parse(readFileSync(join(root, 'electron-builder.yml'), 'utf8'))
    const setup = extraResources.find((r) => r.from === 'setup')
    expect(setup).toMatchObject({ to: 'setup', filter: ['**/*'] })
  })
  it('compares every file of the garnet-board extension', () => {
    expect([...BOARD_FILES].sort()).toEqual(files(join(root, 'setup', 'garnet-board')).sort())
  })
})
