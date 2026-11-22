// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What's This (R21): a mode in which the pointer asks what an element is. The
// element is the nearest one with a data-ui name (the names the manual's
// lessons use, R18.11); a click shows a card with its name, what it is and
// what it is for (manual/whats-this.json) and the lessons that act on it, and never acts on
// the element itself. One click per entry; Shift keeps the mode on; Esc leaves.

const el = (tag, cls, text) => {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text != null) e.textContent = text
  return e
}

// The description of `name`: its own entry, or the entry for its prefix.
export function describe(name, texts) {
  const entry = (e) => ({ title: e[0], text: e[1], purpose: e[2] ?? '' })
  const own = texts.names?.[name]
  if (own) return entry(own)
  const prefix = Object.keys(texts.prefixes ?? {})
    .sort((a, b) => b.length - a.length)
    .find((p) => name.startsWith(p))
  return prefix ? entry(texts.prefixes[prefix]) : null
}

// The lessons for an element: those with a step that acts on it; else those
// of the panel that holds it (`panel`), marked as such.
export function lessonsFor(name, panel, lessons) {
  const own = lessons.filter((l) => l.steps.some((s) => s.target.includes(name)))
  if (own.length) return { lessons: own, ofPanel: false }
  return { lessons: panel ? lessons.filter((l) => l.panels.includes(panel)) : [], ofPanel: true }
}

// The manual's own controls (its bar, caption and search), which the mode
// leaves alone so that a lesson can be played and stepped while it is on.
const EXEMPT = '.whats-this-card, #manual-top, .manual-caption, .manual-results'

export function mountWhatsThis() {
  const btn = document.getElementById('whats-this')
  const line = document.getElementById('whats-this-line')
  if (!btn || !line) return
  let on = false
  let texts = { names: {}, prefixes: {} }
  let lessons = []
  window.garnet.whatsThis().then((t) => t && (texts = t))
  // Read aloud on the card (R22.2 C), while the setting is on and phonorheos runs.
  let aloud = false
  let up = false
  window.garnet.settings?.get().then((st) => (aloud = st?.speech?.readAloud === true))
  window.garnet.settings?.onChanged((st) => (aloud = st?.speech?.readAloud === true))
  window.garnet.speech?.status().then((st) => (up = Boolean(st?.available)))
  window.garnet.speech?.onChanged((st) => (up = Boolean(st?.available)))
  window.garnet.manual.lessons().then((l) => (lessons = l ?? []))

  const outline = el('div', 'whats-this-outline')
  const label = el('div', 'whats-this-label')
  outline.hidden = label.hidden = true
  document.body.append(outline, label)
  let card = null

  const target = (node) => {
    const t = node instanceof Element ? node.closest('[data-ui]') : null
    return t && !t.closest(EXEMPT) && t !== btn ? t : null
  }
  const closeCard = () => {
    card?.remove()
    card = null
  }
  const set = (v) => {
    on = v
    document.body.classList.toggle('whats-this', v)
    btn.classList.toggle('on', v)
    btn.setAttribute('aria-pressed', String(v))
    line.hidden = !v
    if (!v) outline.hidden = label.hidden = true
  }

  function show(t) {
    const name = t.dataset.ui
    const d = describe(name, texts) ?? { title: name, text: 'No description yet.' }
    const panelEl = t.closest('[data-ui^="panel-"], [data-ui^="pane-"]')
    const { lessons: mine, ofPanel } = lessonsFor(name, panelEl?.dataset.ui ?? null, lessons)
    closeCard()
    card = el('div', 'whats-this-card')
    const close = el('button', 'whats-this-close', '✕')
    close.type = 'button'
    close.setAttribute('aria-label', 'Close')
    close.addEventListener('click', closeCard)
    card.append(close, el('h3', null, d.title), el('p', null, d.text))
    if (d.purpose) card.append(el('p', 'whats-this-purpose', d.purpose))
    if (aloud && up) {
      const wrap = el('span', 'read-aloud')
      // data-ui is not set here: the card is the mode's own, never asked about.
      const say = el('button', null, 'Read aloud')
      const stop = el('button', null, 'Stop')
      for (const b of [say, stop]) b.type = 'button'
      say.addEventListener('click', () => window.garnet.speech.say(`${d.title}. ${d.text} ${d.purpose ?? ''}`))
      stop.addEventListener('click', () => window.garnet.speech.stop())
      wrap.append(say, stop)
      card.append(wrap)
    }
    if (mine.length) {
      card.append(el('div', 'muted small', ofPanel ? 'Lessons for this panel' : 'Lessons'))
      for (const l of mine) {
        const b = el('button', 'lesson-item')
        b.type = 'button'
        b.append(el('span', null, l.title), el('span', 'lesson-play', 'Play'))
        b.addEventListener('click', () => (closeCard(), window.garnet.manual.open(l.n)))
        card.append(b)
      }
    } else card.append(el('div', 'muted small', 'No lesson covers this yet.'))
    document.body.append(card)
    const r = t.getBoundingClientRect()
    const c = card.getBoundingClientRect()
    const left = Math.max(8, Math.min(r.left, innerWidth - c.width - 8))
    const below = r.bottom + 6
    const top = below + c.height < innerHeight - 8 ? below : Math.max(8, r.top - c.height - 6)
    card.style.left = `${left}px`
    card.style.top = `${top}px`
  }

  btn.addEventListener('click', (e) => {
    e.stopPropagation()
    closeCard()
    set(!on)
  })
  window.garnet.onWhatsThis(() => {
    closeCard()
    set(true)
  })

  document.addEventListener(
    'pointerover',
    (e) => {
      if (!on) return
      const t = target(e.target)
      if (!t) return (outline.hidden = label.hidden = true)
      const r = t.getBoundingClientRect()
      Object.assign(outline.style, { left: `${r.left - 2}px`, top: `${r.top - 2}px`, width: `${r.width + 4}px`, height: `${r.height + 4}px` })
      label.textContent = describe(t.dataset.ui, texts)?.title ?? t.dataset.ui
      Object.assign(label.style, { left: `${Math.max(4, r.left)}px`, top: `${Math.max(4, r.top - 20)}px` })
      outline.hidden = label.hidden = false
    },
    true,
  )
  // In the mode a press and a click only ask: nothing beneath them acts.
  const swallow = (e) => {
    if (!on || e.target === btn || e.target.closest?.(EXEMPT)) return
    e.preventDefault()
    e.stopPropagation()
    e.stopImmediatePropagation()
  }
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'dblclick', 'contextmenu']) document.addEventListener(type, swallow, true)
  document.addEventListener(
    'click',
    (e) => {
      if (card && !e.target.closest?.('.whats-this-card') && !on) closeCard()
      if (!on || e.target === btn || e.target.closest?.(EXEMPT)) return
      swallow(e)
      const t = target(e.target)
      if (t) show(t)
      if (!e.shiftKey) set(false)
    },
    true,
  )
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Escape' || (!on && !card)) return
      e.stopPropagation()
      closeCard()
      set(false)
    },
    true,
  )
}
