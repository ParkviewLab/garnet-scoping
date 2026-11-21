// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// A rule left open swallows every rule after it, and the browser drops them
// all without a word (it broke What's This in 0.14.0). Every block closes, and
// no rule starts inside another's block.
describe('the stylesheet', () => {
  const css = readFileSync(join(__dirname, '..', 'src', 'renderer', 'src', 'style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '))
  it('closes every block it opens, and never opens a rule inside a rule', () => {
    let depth = 0
    let atBlock = 0 // depth of an enclosing @media or @supports, where rules nest by design
    const nested = []
    for (const [i, line] of css.split('\n').entries()) {
      if (/^@(media|supports|layer|container|keyframes)\b/.test(line)) atBlock = depth + 1
      if (depth > (atBlock ? atBlock : 0) && /\{\s*$/.test(line) && !/^@/.test(line.trim())) nested.push(`${i + 1}: ${line.trim()}`)
      for (const c of line) {
        if (c === '{') depth++
        if (c === '}') depth--
      }
      if (atBlock && depth < atBlock) atBlock = 0
      expect(depth).toBeGreaterThanOrEqual(0)
    }
    expect(nested).toEqual([])
    expect(depth).toBe(0)
  })
})
