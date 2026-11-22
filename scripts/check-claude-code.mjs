// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Step 2 of the Claude Code compatibility check (docs/claude-code-compatibility.md).
// Reads the transcripts on this machine with the app's own reader and reports
// what transcripts written by Claude Code versions newer than the checked range
// contain that older ones do not: record types the reader does not know,
// attachment types never seen before, and top-level fields new to a known type.
// It prints names and counts only, never a record's content.
//
//   node scripts/check-claude-code.mjs [--since <version>] [--dir <projects folder>]
//
// --since defaults to the highest checked version (CHECKED_VERSIONS.highest);
// --dir to ~/.claude/projects. A transcript counts as new when any of its
// records carries a version above --since; its records without a version
// (some bookkeeping types carry none) count with it.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { classify } from '../src/main/transcript/records.js'
import { CHECKED_VERSIONS, compareVersions } from '../src/main/transcript/session.js'

const args = process.argv.slice(2)
const opt = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const since = opt('--since', CHECKED_VERSIONS.highest)
const dir = opt('--dir', join(homedir(), '.claude', 'projects'))

function transcripts(root) {
  const out = []
  for (const project of readdirSync(root)) {
    const p = join(root, project)
    if (!statSync(p).isDirectory()) continue
    for (const f of readdirSync(p)) if (f.endsWith('.jsonl')) out.push(join(p, f))
  }
  return out
}

function read(file) {
  const records = []
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue
    try {
      records.push(JSON.parse(line))
    } catch {
      // a partly written last line; the app skips it too
    }
  }
  return records
}

const add = (map, key, n = 1) => map.set(key, (map.get(key) ?? 0) + n)
const fieldsOf = new Map() // 'old' | 'new' -> Map(type -> Set(field))
const attachOf = { old: new Map(), new: new Map() }
const unknown = new Map()
const versions = new Map()
let newFiles = 0
let newRecords = 0

for (const file of transcripts(dir)) {
  const records = read(file)
  const newest = records.reduce((v, r) => (typeof r.version === 'string' && (!v || compareVersions(r.version, v) > 0) ? r.version : v), null)
  if (!newest) continue
  const side = compareVersions(newest, since) > 0 ? 'new' : 'old'
  if (side === 'new') newFiles++
  if (!fieldsOf.has(side)) fieldsOf.set(side, new Map())
  const fields = fieldsOf.get(side)
  for (const r of records) {
    if (!r || typeof r !== 'object') continue
    const type = String(r.type)
    if (!fields.has(type)) fields.set(type, new Set())
    for (const k of Object.keys(r)) fields.get(type).add(k)
    if (type === 'attachment') add(attachOf[side], String(r.attachment?.type))
    if (side !== 'new') continue
    newRecords++
    if (typeof r.version === 'string') add(versions, r.version)
    const c = classify(r)
    if (c.kind === 'unknown') add(unknown, c.type)
  }
}

const list = (map) => [...map].sort((a, b) => b[1] - a[1]).map(([k, n]) => `  ${k} (${n})`)
console.log(`Checked range: ${CHECKED_VERSIONS.lowest} to ${CHECKED_VERSIONS.highest}; reporting versions above ${since}.`)
console.log(`${newFiles} transcripts, ${newRecords} records. Versions: ${[...versions.keys()].sort(compareVersions).join(', ') || 'none'}.`)
if (!newFiles) process.exit(0)

console.log('\nRecord types the reader does not know:')
console.log(unknown.size ? list(unknown).join('\n') : '  none')

console.log('\nAttachment types not seen in older transcripts:')
const newAttach = new Map([...attachOf.new].filter(([k]) => !attachOf.old.has(k)))
console.log(newAttach.size ? list(newAttach).join('\n') : '  none')

console.log('\nFields new to a known record type:')
const oldFields = fieldsOf.get('old') ?? new Map()
const lines = []
for (const [type, set] of fieldsOf.get('new') ?? []) {
  if (!oldFields.has(type)) continue // a new type is reported above
  const added = [...set].filter((k) => !oldFields.get(type).has(k))
  if (added.length) lines.push(`  ${type}: ${added.sort().join(', ')}`)
}
console.log(lines.length ? lines.sort().join('\n') : '  none')
