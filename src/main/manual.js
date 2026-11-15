// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The manual (R18): its lessons, read from manual/lessons, and the demo
// session they play on (P16), copied afresh for each lesson so that one
// lesson's clicks never carry into the next and nothing reaches a real
// session (R18.5).

import { readdir, readFile, writeFile, rm, cp } from 'node:fs/promises'
import { join } from 'node:path'

export const DEMO_ID = '00000000-0000-4000-8000-00000000de30'

// The demo's times are moved so that its last record is this old.
const LAST_AGE_MS = 60_000

// A lesson as its file gives it, or null where the file is not a lesson.
export function cleanLesson(raw) {
  if (!raw || typeof raw !== 'object') return null
  const n = Number(raw.n)
  if (!Number.isInteger(n) || typeof raw.title !== 'string' || !Array.isArray(raw.steps) || !raw.steps.length) return null
  const steps = raw.steps
    .filter((s) => s && typeof s.caption === 'string')
    .map((s) => ({
      target: Array.isArray(s.target) ? s.target.map(String) : s.target ? [String(s.target)] : [],
      action: ['point', 'click', 'menu', 'dblclick', 'type', 'wait'].includes(s.action) ? s.action : 'point',
      text: typeof s.text === 'string' ? s.text : null,
      caption: s.caption,
      try: Boolean(s.try),
    }))
  if (!steps.length) return null
  return {
    n,
    title: raw.title,
    group: String(raw.group ?? ''),
    panels: Array.isArray(raw.panels) ? raw.panels.map(String) : [],
    platforms: Array.isArray(raw.platforms) ? raw.platforms.map(String) : null,
    done: typeof raw.done === 'string' ? raw.done : 'That is it.',
    steps,
  }
}

// The lessons for this system, in their order.
export async function listLessons(dir, platform = process.platform) {
  let names
  try {
    names = (await readdir(join(dir, 'lessons'))).filter((f) => f.endsWith('.json'))
  } catch {
    return []
  }
  const lessons = []
  for (const f of names) {
    try {
      const l = cleanLesson(JSON.parse(await readFile(join(dir, 'lessons', f), 'utf8')))
      if (l && (!l.platforms || l.platforms.includes(platform))) lessons.push(l)
    } catch {}
  }
  return lessons.sort((a, b) => a.n - b.n)
}

// The demo's transcript, with its folder filled in and its times moved so that
// the last record is a minute old.
export function rebase(text, dir, now = Date.now()) {
  const lines = text.replaceAll('__DEMO__', dir).split('\n').filter(Boolean)
  const records = lines.map((l) => JSON.parse(l))
  const times = records.map((r) => Date.parse(r.timestamp)).filter(Number.isFinite)
  const shift = times.length ? now - LAST_AGE_MS - Math.max(...times) : 0
  return (
    records
      .map((r) => {
        const t = Date.parse(r.timestamp)
        return JSON.stringify(Number.isFinite(t) ? { ...r, timestamp: new Date(t + shift).toISOString() } : r)
      })
      .join('\n') + '\n'
  )
}

// A fresh copy of the demo in `to`: the session the manual window shows.
export async function prepareDemo(from, to) {
  await rm(to, { recursive: true, force: true })
  await cp(join(from, 'demo'), to, { recursive: true })
  const file = join(to, 'session.jsonl')
  await writeFile(file, rebase(await readFile(file, 'utf8'), to))
  return {
    id: DEMO_ID,
    file,
    project: 'demo',
    title: 'Manual',
    dirs: { boards: join(to, 'boards'), memory: join(to, 'memory') },
  }
}
