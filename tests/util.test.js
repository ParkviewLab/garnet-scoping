// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from 'vitest'
import { pathToFileURL } from 'node:url'
import { fileUrl, fromFile } from '../src/renderer/src/util.js'

describe('fileUrl', () => {
  it('escapes "#" and "?" so the whole name stays in the path', () => {
    expect(fileUrl('/x/chart #2.png')).toBe('file:///x/chart%20%232.png')
    expect(fileUrl('/x/what now?.pdf')).toBe('file:///x/what%20now%3F.pdf')
  })
  it('gives the address Node gives for awkward names', () => {
    for (const p of ['/x/chart #2 what now?.pdf', '/x/100% done.png', '/x/café – draft.jpg', '/x/plain.png']) {
      expect(new URL(fileUrl(p)).pathname).toBe(pathToFileURL(p).pathname)
    }
  })
})

describe('fromFile', () => {
  it('resolves a Markdown file\'s relative images from its own folder', () => {
    expect(fromFile('chart.png', '/x/report #1/notes.md')).toBe('file:///x/report%20%231/chart.png')
    expect(fromFile('../img/a%20b.png', '/x/docs/notes.md')).toBe('file:///x/img/a%20b.png')
    expect(fromFile('/abs/c.png', '/x/docs/notes.md')).toBe('file:///abs/c.png')
  })
  it('leaves an address with its own scheme alone', () => {
    expect(fromFile('https://example.org/a.png', '/x/notes.md')).toBe('https://example.org/a.png')
    expect(fromFile('data:image/png;base64,AAAA', '/x/notes.md')).toBe('data:image/png;base64,AAAA')
  })
})

import { armSide, armGeometry, tipOf, asLine } from '../src/renderer/src/questions.js'
describe('question balloons (R13)', () => {
  const r = { x: 100, y: 100, width: 200, height: 80 }
  it('leaves from the side facing the tip, and not at all from inside', () => {
    expect(armSide(r, { x: 50, y: 140 })).toBe('left')
    expect(armSide(r, { x: 200, y: 300 })).toBe('bottom')
    expect(armSide(r, { x: 200, y: 140 })).toBeNull()
  })
  it('draws the arm from the edge to the tip, its wedge just inside the edge', () => {
    const g = armGeometry(r, { x: 150, y: 20 })
    expect(g.side).toBe('top')
    expect(g.sides[1]).toEqual({ x: 150, y: 20 })
    expect(g.sides[0].y).toBe(100)
    expect(g.wedge[0].y).toBe(102)
  })
  it('keeps the tip on the shape it points at as that shape moves', () => {
    expect(tipOf({ fx: 0.5, fy: 0.5 }, { x: 0, y: 0, width: 100, height: 40 }, r)).toEqual({ x: 50, y: 20 })
    expect(tipOf({ fx: 0.5, fy: 0.5 }, { x: 300, y: 0, width: 100, height: 40 }, r)).toEqual({ x: 350, y: 20 })
  })
  it('points a follow-up at the nearest edge of the answer', () => {
    const note = { x: 100, y: 300, width: 200, height: 60 }
    expect(tipOf({ edge: true }, note, { x: 100, y: 450, width: 200, height: 60 }).y).toBe(360)
  })
  it('turns points into a line element', () => {
    expect(asLine([{ x: 10, y: 10 }, { x: 20, y: 0 }])).toEqual({ x: 10, y: 10, points: [[0, 0], [10, -10]], width: 10, height: 10 })
  })
})
