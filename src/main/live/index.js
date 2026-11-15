// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Reads live state (R8, P8): watches the files Claude Code keeps per running
// process in `~/.claude/sessions/`, and falls back to `claude agents --json`
// where those cannot be read. Nothing is written there (R5.1); the listing is
// the only process the app runs, besides `ps` to check that a file's process
// is the one that wrote it.

import { watch } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { parseSessionFile, parseAgents } from './state.js'

const DEBOUNCE_MS = 200
const RECHECK_MS = 10_000
const LISTING_MS = 10_000

const run = (cmd, args, env) =>
  new Promise((resolve) => execFile(cmd, args, { timeout: 5000, env: { ...process.env, ...env } }, (err, out) => resolve(err ? null : out)))

// Whether `pid` is running and, where the file gives its start, started then.
const starts = new Map()
async function alive(live) {
  try {
    process.kill(live.pid, 0)
  } catch (e) {
    if (e.code !== 'EPERM') return false
  }
  if (!live.procStart) return true
  const key = `${live.pid} ${live.procStart}`
  if (!starts.has(key)) {
    const out = await run('ps', ['-o', 'lstart=', '-p', String(live.pid)], { TZ: 'UTC' })
    starts.set(key, out == null ? true : out.trim().replace(/\s+/g, ' ') === live.procStart.trim().replace(/\s+/g, ' '))
  }
  return starts.get(key)
}

// Starts the watch. `onChange({ available, bySession })` is called whenever
// the facts change: `bySession` maps a session id to its parsed facts.
export function watchLive(sessionsDir, onChange, { listing = () => run('claude', ['agents', '--json']) } = {}) {
  let last = ''
  let timer = null
  let poll = null
  let watcher = null

  const publish = (available, list) => {
    const bySession = {}
    for (const l of list) bySession[l.sessionId] = l
    const sig = JSON.stringify([available, bySession])
    if (sig === last) return
    last = sig
    onChange({ available, bySession })
  }

  async function fromFiles() {
    let names
    try {
      names = (await readdir(sessionsDir)).filter((n) => n.endsWith('.json'))
    } catch {
      return null
    }
    const parsed = []
    let unrecognised = 0
    for (const n of names) {
      try {
        const live = parseSessionFile(JSON.parse(await readFile(join(sessionsDir, n), 'utf8')))
        if (!live) unrecognised++
        else if (await alive(live)) parsed.push(live)
      } catch {
        unrecognised++
      }
    }
    // Files that are all unrecognised mean the format has changed (R6).
    return names.length && unrecognised === names.length ? null : parsed
  }

  async function fromListing() {
    const out = await listing()
    if (out == null) return null
    try {
      return parseAgents(JSON.parse(out))
    } catch {
      return null
    }
  }

  async function refresh() {
    const files = await fromFiles()
    if (files) {
      if (poll) clearInterval(poll), (poll = null)
      return publish(true, files)
    }
    const rows = await fromListing()
    if (!poll) poll = setInterval(refresh, LISTING_MS)
    publish(rows != null, rows ?? [])
  }

  const soon = () => {
    clearTimeout(timer)
    timer = setTimeout(refresh, DEBOUNCE_MS)
  }
  try {
    watcher = watch(sessionsDir, soon)
  } catch {}
  const recheck = setInterval(refresh, RECHECK_MS)
  refresh()
  return {
    refresh,
    close() {
      clearTimeout(timer)
      clearInterval(recheck)
      if (poll) clearInterval(poll)
      watcher?.close()
    },
  }
}
