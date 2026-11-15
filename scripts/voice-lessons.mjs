// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Voices the manual's lessons (R18.8, P14): each caption, and each lesson's
// closing line, is spoken by phonorheos in the voice bf_emma into a WAV file,
// which macOS's afconvert compresses to AAC (.m4a, about 4 KB a second).
// Only captions whose text changed since they were last voiced are made
// again; manual/audio/index.json records each file's caption hash, which the
// tests check. Runs on macOS, with phonorheos 0.10.0 or later running.
// Run: node scripts/voice-lessons.mjs

import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { voiceKeys, captionHash, VOICE } from '../src/main/voice.js'

const MANUAL = join(import.meta.dirname, '..', 'manual')
const AUDIO = join(MANUAL, 'audio')
const INDEX = join(AUDIO, 'index.json')
mkdirSync(AUDIO, { recursive: true })
const index = existsSync(INDEX) ? JSON.parse(readFileSync(INDEX, 'utf8')) : {}
const tmp = join(tmpdir(), 'garnet-voice')
mkdirSync(tmp, { recursive: true })

const wanted = {}
for (const f of readdirSync(join(MANUAL, 'lessons')).filter((f) => f.endsWith('.json')).sort()) {
  const lesson = JSON.parse(readFileSync(join(MANUAL, 'lessons', f), 'utf8'))
  for (const { key, text } of voiceKeys(lesson)) wanted[key] = text
}

let made = 0
for (const [key, text] of Object.entries(wanted)) {
  const hash = captionHash(text)
  const out = join(AUDIO, `${key}.m4a`)
  if (index[key] === hash && existsSync(out)) continue
  const wav = join(tmp, `${key}.wav`)
  execFileSync('phonorheos', ['say', '--voice', VOICE, '--to-file', wav, '--', text], { stdio: 'inherit' })
  execFileSync('afconvert', ['-f', 'm4af', '-d', 'aac', '-b', '32000', wav, out])
  index[key] = hash
  made++
  console.log(`voiced ${key}`)
}
// Files no caption needs any longer go.
for (const key of Object.keys(index)) {
  if (wanted[key]) continue
  rmSync(join(AUDIO, `${key}.m4a`), { force: true })
  delete index[key]
}
writeFileSync(INDEX, JSON.stringify(Object.fromEntries(Object.entries(index).sort()), null, 2) + '\n')
rmSync(tmp, { recursive: true, force: true })
console.log(`${made} voiced, ${Object.keys(wanted).length} in all`)
