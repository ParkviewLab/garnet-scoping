// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Background work and scheduled jobs as Claude Code reports them at the end
// of each turn (R10): the Stop hook's input, kept by the watcher's hook in
// the app's own folder as `<session>.work.json`.

const str = (v, n = 300) => (typeof v === 'string' ? v.slice(0, n) : null)

// The report, or null where the file holds nothing recognised (R6).
export function parseWork(raw, at = null) {
  if (!raw || typeof raw !== 'object') return null
  const tasks = Array.isArray(raw.background_tasks) ? raw.background_tasks : null
  const crons = Array.isArray(raw.session_crons) ? raw.session_crons : null
  if (!tasks && !crons) return null
  return {
    at,
    tasks: (tasks ?? []).filter((t) => t && t.id != null).map((t) => ({ id: String(t.id), type: str(t.type, 40), status: str(t.status, 40) ?? 'running', text: str(t.description) ?? str(t.type, 40) ?? 'Background work' })),
    crons: (crons ?? []).filter((c) => c && typeof c.schedule === 'string').map((c) => ({ id: String(c.id ?? c.schedule), schedule: c.schedule, recurring: Boolean(c.recurring), prompt: str(c.prompt, 4000) ?? '' })),
  }
}

// One field of a five-field cron schedule as the set of values it allows.
function field(spec, lo, hi) {
  const out = new Set()
  for (const part of spec.split(',')) {
    const [range, stepS] = part.split('/')
    const step = stepS ? Number(stepS) : 1
    let a = lo
    let b = hi
    if (range !== '*') {
      const [x, y] = range.split('-').map(Number)
      a = x
      b = y ?? (stepS ? hi : x)
    }
    if (![a, b, step].every(Number.isInteger) || step < 1) return null
    for (let v = a; v <= b; v += step) out.add(v)
  }
  return out
}

// The next time, after `from`, that a cron schedule fires (local time), or
// null where the schedule is not one this reads.
export function nextRun(schedule, from = Date.now()) {
  const parts = String(schedule).trim().split(/\s+/)
  if (parts.length !== 5) return null
  const [mi, ho, dm, mo, dw] = [field(parts[0], 0, 59), field(parts[1], 0, 23), field(parts[2], 1, 31), field(parts[3], 1, 12), field(parts[4], 0, 7)]
  if (![mi, ho, dm, mo, dw].every(Boolean)) return null
  if (dw.has(7)) dw.add(0)
  const d = new Date(from)
  d.setSeconds(0, 0)
  d.setMinutes(d.getMinutes() + 1)
  const anyDay = parts[2] === '*'
  const anyWeek = parts[4] === '*'
  for (let i = 0; i < 366 * 24 * 60; i++) {
    const dayOk = anyDay && anyWeek ? true : anyDay ? dw.has(d.getDay()) : anyWeek ? dm.has(d.getDate()) : dm.has(d.getDate()) || dw.has(d.getDay())
    if (mo.has(d.getMonth() + 1) && dayOk && ho.has(d.getHours()) && mi.has(d.getMinutes())) return d.getTime()
    d.setMinutes(d.getMinutes() + 1)
  }
  return null
}
