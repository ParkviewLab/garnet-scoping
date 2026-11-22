// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The Settings window: a change applies at once to every session window.

const radios = [...document.querySelectorAll('input[name="side"]')]
let settings = await window.garnet.settings.get()
const save = (next) => window.garnet.settings.set(next).then((s) => (settings = s))
for (const r of radios) {
  r.checked = r.value === settings.boardSide
  r.addEventListener('change', () => r.checked && save({ ...settings, boardSide: r.value }))
}

// Speech (R22): each feature off until turned on, and usable only while
// phonorheos runs; the voices are those phonorheos lists.
const EXAMPLE = {
  waiting: 'Garnet-Scoping Development is waiting: permission to run npm test.',
  finished: 'macOS LAN co-op RTS game has finished; your turn.',
  board: 'Garnet-Scoping Development answered your question on the board.',
}
const boxes = [...document.querySelectorAll('.speech-opt input[data-key]')]
const tries = [...document.querySelectorAll('[data-try]')]
const voice = document.getElementById('voice')
const statusEl = document.getElementById('speech-status')
const noteEl = document.getElementById('voice-note')
for (const b of boxes) {
  b.checked = settings.speech?.[b.dataset.key] === true
  b.addEventListener('change', () => save({ ...settings, speech: { ...settings.speech, [b.dataset.key]: b.checked } }))
}
for (const t of tries) t.addEventListener('click', (e) => (e.preventDefault(), window.garnet.speech.say(EXAMPLE[t.dataset.try])))
voice.addEventListener('change', () => save({ ...settings, speech: { ...settings.speech, voice: voice.value || null } }))

function show(st) {
  const up = Boolean(st?.available)
  statusEl.textContent = up ? `phonorheos ${st.version ?? ''}, ${st.ready === false ? 'starting' : 'ready'} (found on this computer)` : 'phonorheos is not running: speech is unavailable until it starts.'
  statusEl.classList.toggle('ok', up)
  for (const el of [...boxes, ...tries, voice]) el.disabled = !up
  const voices = st?.voices ?? []
  const def = voices.find((v) => v.default)
  const opts = [new Option(`phonorheos's default${def ? `: ${def.name}` : ''}`, '')]
  for (const v of voices) opts.push(new Option(v.label, v.id))
  voice.replaceChildren(...opts)
  voice.value = voices.some((v) => v.id === settings.speech?.voice) ? settings.speech.voice : ''
  noteEl.textContent = up && !voices.length ? 'This phonorheos lists no voices; its default is used.' : "One of phonorheos's voices."
}
window.garnet.speech.onChanged(show)
show(await window.garnet.speech.status())
window.garnet.speech.check()
addEventListener('keydown', (e) => e.key === 'Escape' && window.close())
