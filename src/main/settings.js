// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The app's settings, kept in its own user-data folder (never under the
// Claude configuration directory): which half of a session window the board
// takes, and the speech features (R22), each off until the person turns it on.

import { readFileSync } from 'node:fs'
import { mkdir, writeFile, rename } from 'node:fs/promises'
import { dirname } from 'node:path'

export const BOARD_SIDES = ['left', 'right', 'top', 'bottom']
export const SPEECH = { waiting: false, finished: false, board: false, readAloud: false, voice: null }
export const DEFAULTS = { boardSide: 'right', speech: SPEECH }

// Keeps only known keys with valid values, so a damaged file falls back to
// the defaults key by key.
export function clean(raw) {
  const out = { ...DEFAULTS, speech: { ...SPEECH } }
  if (raw && BOARD_SIDES.includes(raw.boardSide)) out.boardSide = raw.boardSide
  const sp = raw?.speech
  if (sp && typeof sp === 'object') {
    for (const k of ['waiting', 'finished', 'board', 'readAloud']) out.speech[k] = sp[k] === true
    if (typeof sp.voice === 'string' && /^[a-z]{1,3}_[a-z0-9]+$/.test(sp.voice)) out.speech.voice = sp.voice
  }
  return out
}

export function loadSettings(file) {
  try {
    return clean(JSON.parse(readFileSync(file, 'utf8')))
  } catch {
    return clean(null)
  }
}

export async function saveSettings(file, settings) {
  await mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  await writeFile(tmp, JSON.stringify(clean(settings), null, 2))
  await rename(tmp, file)
}
