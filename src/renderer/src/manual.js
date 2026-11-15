// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The manual's window (R18): a session window on the demo, with the lesson's
// bar above it and its controls below. A lesson is played on the window's own
// interface: an overlaid pointer moves to the element each step names (its
// data-ui name), the step's caption shows and its voice plays, and the step's
// action is done on the demo. The last step is the person's own try (R18.6).
// Replay and Back a step ask the main process for a fresh copy of the demo,
// which reopens this window and plays the earlier steps at once.

const el = (tag, cls, text) => {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text != null) e.textContent = text
  return e
}
const POINTER_MS = 900
const STEP_MIN_MS = 1600
const PER_CHAR_MS = 55
const REPLAY_GAP_MS = 700

// The element a step names: each name a data-ui inside the one before it.
export function find(target, root = document) {
  let scope = root
  for (const name of target) {
    const found = scope.querySelector(`[data-ui="${CSS.escape(name)}"]`)
    if (!found) return null
    scope = found
  }
  return scope === root ? null : scope
}

// Whether an element is, or is inside, an element with the step's named path;
// read when the person acts, since the Desk redraws its rows as it updates.
export function within(node, target) {
  let at = node?.closest?.(`[data-ui="${CSS.escape(target.at(-1))}"]`)
  if (!at) return false
  for (const name of target.slice(0, -1).reverse()) {
    at = at.parentElement?.closest(`[data-ui="${CSS.escape(name)}"]`)
    if (!at) return false
  }
  return true
}

// How long a step stays: its voice, or its caption read at an even pace.
export const stepMs = (caption, audioMs = 0) => Math.max(STEP_MIN_MS, audioMs, caption.length * PER_CHAR_MS)

// Whether every word typed is in the lesson's title or captions (R18.10).
export function matches(lesson, query) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const hay = [lesson.title, ...lesson.steps.map((s) => s.caption)].join(' ').toLowerCase()
  return words.every((w) => hay.includes(w))
}

function act(step, node) {
  if (!node) return
  const r = node.getBoundingClientRect()
  const opts = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, view: window }
  if (step.action === 'click') node.click()
  // A panel's toggle, pressed only where the panel is off.
  else if (step.action === 'show') node.getAttribute('aria-pressed') !== 'true' && node.click()
  else if (step.action === 'dblclick') node.dispatchEvent(new MouseEvent('dblclick', opts))
  else if (step.action === 'menu') node.dispatchEvent(new MouseEvent('contextmenu', { ...opts, button: 2 }))
  else if (step.action === 'type' && 'value' in node) {
    node.focus()
    node.value = step.text ?? ''
    node.dispatchEvent(new Event('input', { bubbles: true }))
  }
}

export function startManual({ lesson: wanted, step: from }) {
  const top = document.getElementById('manual-top')
  const bar = document.getElementById('manual-bar')
  top.hidden = false
  bar.hidden = false
  document.body.classList.add('manual-mode')
  const pointer = el('div', 'manual-pointer')
  const caption = el('div', 'manual-caption')
  pointer.hidden = true
  caption.hidden = true
  document.body.append(pointer, caption)

  let lessons = []
  let lesson = null
  let i = 0
  let playing = false
  let timer = null
  let trying = null
  let captions = true
  let sound = true
  const audio = new Audio()

  const stop = () => {
    clearTimeout(timer)
    audio.pause()
  }
  const say = (text) => {
    caption.textContent = text
    caption.hidden = !captions || !text
  }

  function showList(query = '') {
    stop()
    lesson = null
    pointer.hidden = true
    say('')
    disarmTry()
    const input = el('input', 'manual-search')
    input.type = 'search'
    input.placeholder = 'How do I… (for example: pause the agent)'
    input.value = query
    input.dataset.ui = 'manual-search'
    const list = el('div', 'manual-results')
    const fill = () => {
      const shown = lessons.filter((l) => matches(l, input.value))
      list.replaceChildren(...(shown.length ? shown.map(row) : [el('p', 'muted', 'No lesson matches. Try other words.')]))
    }
    input.addEventListener('input', fill)
    top.replaceChildren(el('span', 'manual-name', 'Manual'), input)
    bar.replaceChildren(list)
    fill()
    input.focus()
  }
  function row(l) {
    const b = el('button', 'manual-lesson')
    b.type = 'button'
    b.append(el('span', null, `${l.n}. ${l.title}`), el('span', 'manual-play', 'Play'))
    b.addEventListener('click', () => window.garnet.manual.reset(l.n, 0))
    return b
  }

  function controls() {
    const btn = (label, ui, fn) => {
      const b = el('button', null, label)
      b.type = 'button'
      b.dataset.ui = ui
      b.addEventListener('click', fn)
      return b
    }
    const pause = btn(playing ? 'Pause' : 'Play', 'manual-pause', () => (playing ? pauseIt() : resume()))
    const back = btn('Back a step', 'manual-back', () => window.garnet.manual.reset(lesson.n, Math.max(0, i - 1)))
    const replay = btn('Replay', 'manual-replay', () => window.garnet.manual.reset(lesson.n, 0))
    const cc = btn('Captions', 'manual-captions', () => {
      captions = !captions
      caption.hidden = !captions || !caption.textContent
      cc.classList.toggle('on', captions)
    })
    cc.classList.toggle('on', captions)
    const snd = btn('Sound', 'manual-sound', () => {
      sound = !sound
      audio.muted = !sound
      snd.classList.toggle('on', sound)
    })
    snd.classList.toggle('on', sound)
    const count = el('span', 'manual-count', `Step ${Math.min(i + 1, lesson.steps.length)} of ${lesson.steps.length}`)
    const items = [pause, back, replay, cc, snd, count]
    if (trying) items.splice(5, 0, btn('Skip the try', 'manual-skip', () => finish('End of lesson. Replay, or choose another.')))
    bar.replaceChildren(...items)
  }

  function pauseIt() {
    playing = false
    stop()
    controls()
  }
  function resume() {
    playing = true
    play(i)
  }

  function movePointer(node) {
    if (!node) return (pointer.hidden = true)
    const r = node.getBoundingClientRect()
    pointer.hidden = false
    pointer.style.left = `${r.left + r.width / 2 - 8}px`
    pointer.style.top = `${r.top + r.height / 2 - 8}px`
  }

  function play(k) {
    stop()
    i = k
    const step = lesson.steps[i]
    if (!step) return
    if (step.try) return armTry(step)
    controls()
    const node = find(step.target)
    node?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    movePointer(node)
    say(step.caption)
    let audioMs = 0
    if (step.audio && sound) {
      audio.src = step.audio
      audio.play().catch(() => {})
      audioMs = Number.isFinite(audio.duration) ? audio.duration * 1000 : 0
    }
    timer = setTimeout(() => {
      if (step.action !== 'point') {
        pointer.classList.add('press')
        setTimeout(() => pointer.classList.remove('press'), 250)
        act(step, node)
      }
      timer = setTimeout(() => playing && play(i + 1), stepMs(step.caption, audioMs))
    }, POINTER_MS)
  }

  // The person's try: the pointer leaves, and the step's own action on its
  // element ends the lesson.
  function armTry(step) {
    pointer.hidden = true
    say(step.caption)
    const kind = step.action === 'point' || step.action === 'show' ? 'click' : step.action === 'menu' ? 'contextmenu' : step.action
    const done = (e) => within(e.target, step.target) && finish(lesson.done)
    trying = { kind, done }
    document.addEventListener(kind, done, true)
    controls()
  }
  function disarmTry() {
    if (trying) document.removeEventListener(trying.kind, trying.done, true)
    trying = null
  }
  function finish(text) {
    disarmTry()
    playing = false
    i = lesson.steps.length
    say(text)
    controls()
  }

  async function begin(n, skip) {
    lesson = lessons.find((l) => l.n === n)
    if (!lesson) return showList()
    const all = el('button', null, '← All lessons')
    all.type = 'button'
    all.dataset.ui = 'manual-all'
    all.addEventListener('click', () => showList())
    top.replaceChildren(all, el('span', 'manual-name', `${lesson.n}. ${lesson.title}`))
    // The steps before `skip` are done without pointer or voice, each given
    // time to take effect (a second press of Hold reads the state the first set).
    for (let k = 0; k < skip; k++) {
      const s = lesson.steps[k]
      if (s.try || s.action === 'point') continue
      act(s, find(s.target))
      await new Promise((r) => setTimeout(r, REPLAY_GAP_MS))
    }
    playing = true
    play(skip)
  }

  window.garnet.manual.onShow(({ lesson: n }) => (n == null ? showList() : window.garnet.manual.reset(n, 0)))
  window.garnet.manual.lessons().then((ls) => {
    lessons = ls
    if (wanted == null) showList()
    else setTimeout(() => begin(wanted, from ?? 0), 600)
  })
}
