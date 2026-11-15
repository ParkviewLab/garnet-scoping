// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The manual (R18): its lessons, read from manual/lessons, and the demo
// session they play on (P16), copied afresh for each lesson so that one
// lesson's clicks never carry into the next and nothing reaches a real
// session (R18.5).

import { readdir, readFile, writeFile, rm, cp } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

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
      action: ['point', 'click', 'show', 'menu', 'dblclick', 'type', 'key', 'wait', 'agent', 'window'].includes(s.action) ? s.action : 'point',
      text: typeof s.text === 'string' ? s.text : null,
      // For an `agent` step: what the agent writes, as its request to the board.
      request: s.request && typeof s.request === 'object' ? s.request : null,
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

// A lesson with its voice-over's files, where they exist (R18.8).
function withAudio(lesson, dir) {
  const url = (key) => {
    const file = join(dir, `${key}.m4a`)
    return existsSync(file) ? pathToFileURL(file).href : null
  }
  return { ...lesson, doneAudio: url(`${lesson.n}-done`), steps: lesson.steps.map((s, k) => ({ ...s, audio: url(`${lesson.n}-${k + 1}`) })) }
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
      if (l && (!l.platforms || l.platforms.includes(platform))) lessons.push(withAudio(l, join(dir, 'audio')))
    } catch {}
  }
  return lessons.sort((a, b) => a.n - b.n)
}

// The demo's transcript, with its folder filled in and its times moved so that
// the last record is a minute old.
export function rebase(text, dir, now = Date.now(), age = LAST_AGE_MS) {
  const lines = text.replaceAll('__DEMO__', dir).split('\n').filter(Boolean)
  const records = lines.map((l) => JSON.parse(l))
  const times = records.map((r) => Date.parse(r.timestamp)).filter(Number.isFinite)
  const shift = times.length ? now - age - Math.max(...times) : 0
  return (
    records
      .map((r) => {
        const t = Date.parse(r.timestamp)
        return JSON.stringify(Number.isFinite(t) ? { ...r, timestamp: new Date(t + shift).toISOString() } : r)
      })
      .join('\n') + '\n'
  )
}

// What an `agent` step writes into the demo's copy, as the agent would: a
// request to its board, or an answer to the person's last aside. `$last` in
// "discussed" stands for the last request still open, and `$lastQuestion` in
// "answers" for the last question still open.
export async function agentStep(boards, request) {
  const state = JSON.parse(await readFile(join(boards, `${DEMO_ID}.state.json`), 'utf8').catch(() => '{}'))
  if (typeof request.aside === 'string') {
    const last = (state.asides ?? []).filter((a) => !a.answeredAt).at(-1)
    if (last) await writeFile(join(boards, `${DEMO_ID}.asides.json`), JSON.stringify({ [last.id]: { answer: request.aside } }))
    return
  }
  const open = (state.discuss ?? []).filter((m) => m.status === 'open')
  const discussed = Array.isArray(request.discussed) ? request.discussed.map((d) => (d.id === '$last' ? { ...d, id: open.at(-1)?.id ?? null } : d)).filter((d) => d.id) : undefined
  // __DEMO__ in a request (an image's path) is the copy's folder.
  // `$lastQuestion` in "answers" stands for the last question still open.
  const question = (state.questions ?? []).filter((q) => q.status === 'open').at(-1)
  const answers = Array.isArray(request.answers) ? request.answers.map((a) => (a.id === '$lastQuestion' ? { ...a, id: question?.id ?? null } : a)).filter((a) => a.id) : undefined
  const text = JSON.stringify({ ...request, ...(discussed ? { discussed } : {}), ...(answers ? { answers } : {}) }).replaceAll('__DEMO__', dirname(boards))
  await writeFile(join(boards, `${DEMO_ID}.request.json`), text)
}

// A fresh copy of the demo in `to`: the session the manual window shows.
export async function prepareDemo(from, to) {
  await rm(to, { recursive: true, force: true })
  await cp(join(from, 'demo'), to, { recursive: true })
  const file = join(to, 'session.jsonl')
  const now = Date.now()
  await writeFile(file, rebase(await readFile(file, 'utf8'), to, now))
  const dirs = { boards: join(to, 'boards'), memory: join(to, 'memory') }
  // The other sessions its Sessions panel lists, each dated by its own age.
  const others = JSON.parse(await readFile(join(to, 'others.json'), 'utf8').catch(() => '[]'))
  for (const o of others) {
    o.file = join(to, 'others', `${o.id}.jsonl`)
    o.cwd = join(to, o.folder)
    o.modified = now - o.age * 60_000
    await writeFile(o.file, rebase(await readFile(o.file, 'utf8'), to, now, o.age * 60_000))
  }
  return { id: DEMO_ID, file, project: 'demo', title: 'Manual', dirs, others, cwd: join(to, 'csv-parser'), modified: now - LAST_AGE_MS }
}

// The demo sessions as the Sessions panel lists them.
export const demoList = (demo) => [
  { id: demo.id, title: 'Demo: a CSV parser', cwd: demo.cwd, project: 'demo', file: demo.file, modified: demo.modified },
  ...demo.others.map((o) => ({ id: o.id, title: o.title, cwd: o.cwd, project: 'demo', file: o.file, modified: o.modified })),
]

// The live state the manual gives each other demo session.
export function demoState(o, now = Date.now()) {
  const since = now - o.age * 60_000
  if (o.state === 'waiting') return { state: 'waiting', since, reason: { type: 'question', text: o.question, options: o.options ?? [], at: since } }
  if (o.state === 'idle') return { state: 'idle', since, yourTurn: true }
  return { state: 'not-running' }
}
