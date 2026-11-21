// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from 'vitest'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { parseRecord, parentsOf, readParents } from '../src/main/spawned.js'
import { nest, withAncestors } from '../src/renderer/src/util.js'

const rec = (local, cli, from) => JSON.stringify({ sessionId: local, cliSessionId: cli, ...(from ? { spawnedFrom: { sessionId: from, taskId: 't' } } : {}) })

describe('parseRecord', () => {
  it('takes the ids and the parent record', () => {
    expect(parseRecord(rec('local_b', 'cli-b', 'local_a'))).toEqual({ local: 'local_b', cli: 'cli-b', from: 'local_a' })
    expect(parseRecord(rec('local_a', 'cli-a'))).toEqual({ local: 'local_a', cli: 'cli-a', from: null })
  })
  it('gives null for a record it does not recognise', () => {
    expect(parseRecord('{')).toBeNull()
    expect(parseRecord('{"sessionId":"local_a"}')).toBeNull()
  })
})

describe('parentsOf', () => {
  it('maps a spawned transcript to its parent transcript', () => {
    const r = [parseRecord(rec('local_a', 'cli-a')), parseRecord(rec('local_b', 'cli-b', 'local_a')), parseRecord(rec('local_c', 'cli-c', 'local_gone'))]
    expect(parentsOf(r)).toEqual({ 'cli-b': 'cli-a' })
  })
})

describe('readParents', () => {
  it('reads the records two folders down', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'garnet-spawned-'))
    await mkdir(join(dir, 'acct', 'org'), { recursive: true })
    await writeFile(join(dir, 'acct', 'org', 'local_a.json'), rec('local_a', 'cli-a'))
    await writeFile(join(dir, 'acct', 'org', 'local_b.json'), rec('local_b', 'cli-b', 'local_a'))
    await writeFile(join(dir, 'acct', 'org', 'other.json'), rec('local_x', 'cli-x', 'local_a'))
    expect(await readParents(dir)).toEqual({ 'cli-b': 'cli-a' })
  })
  it('gives nothing where the folder is missing', async () => {
    expect(await readParents(join(tmpdir(), 'garnet-no-such-folder'))).toEqual({})
  })
})

const S = (id, parent = null) => ({ id, parent })

describe('nest', () => {
  it('places spawned sessions beneath their parent, in list order', () => {
    const list = [S('c', 'a'), S('a'), S('b'), S('d', 'c')]
    expect(nest(list).map((r) => `${r.s.id}${r.depth}:${r.children}`)).toEqual(['a0:1', 'c1:1', 'd2:0', 'b0:0'])
  })
  it('lists a session whose parent is absent at the top level', () => {
    expect(nest([S('x', 'gone')]).map((r) => r.depth)).toEqual([0])
  })
  it('hides the spawned sessions of a folded parent but still counts them', () => {
    const rows = nest([S('a'), S('b', 'a')], { folded: new Set(['a']) })
    expect(rows.map((r) => [r.s.id, r.children])).toEqual([['a', 1]])
  })
  it('limits the top level to the roots given', () => {
    expect(nest([S('a'), S('b', 'a'), S('z')], { roots: [S('a')] }).map((r) => r.s.id)).toEqual(['a', 'b'])
  })
  it('survives a cycle', () => {
    expect(nest([S('a', 'b'), S('b', 'a')], { roots: [S('a', 'b')] }).length).toBeLessThanOrEqual(2)
  })
})

describe('withAncestors', () => {
  it('keeps the parent of a spawned session the filter matched', () => {
    const all = [S('a'), S('b', 'a'), S('z')]
    expect(withAncestors(all, (s) => s.id === 'b').map((s) => s.id)).toEqual(['a', 'b'])
  })
})
