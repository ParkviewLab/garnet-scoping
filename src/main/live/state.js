// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Live state (R8): what Claude Code says about each running session, turned
// into the five states the app shows. Pure functions; src/main/live/index.js
// reads the sources. This module and that one are the only places that know
// the live-state format (R6.1, P10).

import { classify } from '../transcript/records.js'
import { describeAction } from '../transcript/session.js'

export const STATES = ['working', 'idle', 'waiting', 'not-running', 'unknown']
const STATUSES = new Set(['busy', 'idle', 'waiting'])
const WRAP_TOOL = 'mcp__ccd_turn__wrap_up'
const QUESTION_TOOL = 'AskUserQuestion'

// One `~/.claude/sessions/<pid>.json`, or null where it carries nothing the
// app recognises.
export function parseSessionFile(raw) {
  if (!raw || typeof raw !== 'object') return null
  const { pid, sessionId, status } = raw
  if (!Number.isInteger(pid) || typeof sessionId !== 'string' || !STATUSES.has(status)) return null
  return {
    pid,
    sessionId,
    kind: raw.kind === 'bg' || raw.kind === 'background' ? 'background' : 'interactive',
    status,
    waitingFor: typeof raw.waitingFor === 'string' ? raw.waitingFor : null,
    since: Number.isFinite(raw.statusUpdatedAt) ? raw.statusUpdatedAt : null,
    procStart: typeof raw.procStart === 'string' ? raw.procStart : null,
  }
}

// The rows of `claude agents --json`, in the same shape; rows it does not
// recognise are left out.
export function parseAgents(rows) {
  if (!Array.isArray(rows)) return []
  return rows
    .map((r) => parseSessionFile({ ...r, statusUpdatedAt: r?.statusUpdatedAt ?? null }))
    .filter(Boolean)
}

// What the end of a transcript says a waiting session waits on: the last
// tool call with no result yet, and the question left in the desktop app's
// next-step box. `lines` are the parsed records of the transcript's tail.
export function pendingFromTail(lines) {
  const calls = new Map()
  let lastAsk = null
  let spokeLast = false
  for (const raw of lines) {
    const r = classify(raw)
    if (r.kind === 'assistant') {
      if (r.parts.some((p) => p.type === 'text' && p.text)) spokeLast = true
      for (const p of r.parts) {
        if (p.type !== 'tool') continue
        calls.set(p.id, { name: p.name, input: p.input, at: r.at ?? null })
        if (p.name === WRAP_TOOL) lastAsk = p.input?.ask ? { text: String(p.input.ask), at: r.at ?? null } : null
      }
    } else if (r.kind === 'tool-results') {
      for (const res of r.results) calls.delete(res.id)
    } else if (r.kind === 'human') {
      lastAsk = null
      spokeLast = false
    }
  }
  const open = [...calls.values()].filter((c) => c.name !== WRAP_TOOL)
  const call = open.at(-1) ?? null
  let pending = null
  if (call?.name === QUESTION_TOOL) {
    const q = call.input?.questions?.[0] ?? {}
    pending = { type: 'question', text: String(q.question ?? 'A question'), options: (q.options ?? []).map((o) => String(o?.label ?? o)).slice(0, 6), at: call.at }
  } else if (call) {
    pending = { type: 'permission', text: describeAction(call.name, call.input ?? {}).text, tool: call.name, at: call.at }
  }
  return { pending, ask: lastAsk, spokeLast }
}

// The state shown for one session (R8.1, R8.2). `live` is its parsed session
// file or listing row, or null; `available` says whether any live source
// could be read at all; `hold` is the board's hold; `tail` is pendingFromTail's
// answer, which also says whether the agent spoke last (R2.4).
export function sessionState({ live = null, available = true, hold = 'off', tail = null } = {}) {
  if (!available) return { state: 'unknown' }
  if (!live) return { state: 'not-running' }
  const background = live.kind === 'background'
  const base = { background, since: live.since }
  if (hold === 'requested' || hold === 'holding') return { ...base, state: 'waiting', reason: { type: 'hold', text: hold === 'holding' ? 'On hold' : 'Hold requested' } }
  if (live.status === 'waiting') {
    const reason = tail?.pending ?? (live.waitingFor ? { type: 'other', text: live.waitingFor } : { type: 'other', text: 'Waiting' })
    return { ...base, state: 'waiting', reason }
  }
  if (live.status === 'busy') return { ...base, state: 'working' }
  if (tail?.ask) return { ...base, state: 'waiting', reason: { type: 'next-step', text: tail.ask.text, at: tail.ask.at } }
  return { ...base, state: 'idle', yourTurn: Boolean(tail?.spokeLast) }
}

// The sessions waiting for the person (R8.3's count).
export const waitingCount = (states) => Object.values(states).filter((s) => s?.state === 'waiting').length
