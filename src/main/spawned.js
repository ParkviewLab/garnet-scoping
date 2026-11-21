// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Spawned sessions (R20, P17): which session started which, read from the
// desktop app's own record of each session, `local_<id>.json` two folders
// under its claude-code-sessions folder. The record is undocumented and read
// only; a record that cannot be read, or lacks the fields, adds nothing, and
// the session is then listed at the top level (R20.3).

import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'

export const RECORDS_DIR = join(homedir(), 'Library', 'Application Support', 'Claude', 'claude-code-sessions')

// One record's fields, or null.
export function parseRecord(text) {
  let d
  try {
    d = JSON.parse(text)
  } catch {
    return null
  }
  if (!d || typeof d.sessionId !== 'string' || typeof d.cliSessionId !== 'string') return null
  const from = d.spawnedFrom && typeof d.spawnedFrom.sessionId === 'string' ? d.spawnedFrom.sessionId : null
  return { local: d.sessionId, cli: d.cliSessionId, from }
}

// For each transcript id, the transcript id of the session that started it.
export function parentsOf(records) {
  const cliOf = new Map(records.map((r) => [r.local, r.cli]))
  const out = {}
  for (const r of records) {
    const parent = r.from && cliOf.get(r.from)
    if (parent && parent !== r.cli) out[r.cli] = parent
  }
  return out
}

const cache = new Map() // file -> { mtime, record }

async function records(dir) {
  const files = []
  for (const a of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (!a.isDirectory()) continue
    for (const b of await readdir(join(dir, a.name), { withFileTypes: true }).catch(() => [])) {
      if (!b.isDirectory()) continue
      for (const f of await readdir(join(dir, a.name, b.name)).catch(() => []))
        if (f.startsWith('local_') && f.endsWith('.json')) files.push(join(dir, a.name, b.name, f))
    }
  }
  const out = []
  for (const f of files) {
    try {
      const { mtimeMs } = await stat(f)
      let c = cache.get(f)
      if (!c || c.mtime !== mtimeMs) {
        c = { mtime: mtimeMs, record: parseRecord(await readFile(f, 'utf8')) }
        cache.set(f, c)
      }
      if (c.record) out.push(c.record)
    } catch {}
  }
  for (const f of cache.keys()) if (!files.includes(f)) cache.delete(f)
  return out
}

export async function readParents(dir = RECORDS_DIR) {
  if (process.platform !== 'darwin' && dir === RECORDS_DIR) return {}
  return parentsOf(await records(dir))
}
