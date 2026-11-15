// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The manual's voice-over (R18.8, P14): which texts of a lesson are voiced,
// under which file names, and the hash that ties each file to its text, so
// that a changed caption cannot ship with its old voice (R18.11).

import { createHash } from 'node:crypto'

export const VOICE = 'bf_emma'

// Each voiced text of a lesson: its captions in order (<n>-<k>), and its
// closing line (<n>-done).
export function voiceKeys(lesson) {
  const keys = (lesson.steps ?? []).map((s, k) => ({ key: `${lesson.n}-${k + 1}`, text: s.caption }))
  if (lesson.done) keys.push({ key: `${lesson.n}-done`, text: lesson.done })
  return keys.filter((k) => typeof k.text === 'string' && k.text.trim())
}

export const captionHash = (text) => createHash('sha256').update(`${VOICE}\n${text}`).digest('hex').slice(0, 16)
