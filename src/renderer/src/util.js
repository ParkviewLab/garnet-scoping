// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>
// SPDX-License-Identifier: AGPL-3.0-or-later

// "3 min ago", "2 h ago", "4 days ago"; a time or a millisecond count.
export function ago(when) {
  const t = typeof when === 'number' ? when : Date.parse(when)
  if (!Number.isFinite(t)) return ''
  const s = Math.max(0, (Date.now() - t) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  const d = Math.floor(s / 86400)
  return `${d} day${d === 1 ? '' : 's'} ago`
}

// "14:05" for today, "Oct 18 14:05" otherwise.
export function clock(when) {
  const d = new Date(when)
  if (Number.isNaN(d.getTime())) return ''
  const hm = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return d.toDateString() === new Date().toDateString() ? hm : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${hm}`
}

// A duration since a time: "4 s", "3 min", "1 h 5 min".
export function since(when) {
  const s = Math.max(0, Math.floor((Date.now() - Date.parse(when)) / 1000))
  if (s < 60) return `${s} s`
  if (s < 3600) return `${Math.floor(s / 60)} min`
  return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`
}

export const shortPath = (p, home) => (home && p.startsWith(home) ? '~' + p.slice(home.length) : p)

// A file:// address for a local path. encodeURI leaves "#" and "?" as they
// are, and the browser would then read the rest of the name as a fragment or
// a query, so those two are escaped as well.
export const fileUrl = (path) => `file://${encodeURI(path).replace(/[?#]/g, encodeURIComponent)}`

// A link or image reference in a Markdown file, as an address resolved from
// the file's own folder, as a Markdown viewer resolves it. A reference that
// names its own scheme (https:, data:) is left as it is.
export const fromFile = (ref, filePath) => (/^[a-z][a-z0-9+.-]*:/i.test(ref) ? ref : new URL(ref, fileUrl(filePath)).href)

// Spawned sessions (R20): `list` (already in display order) as rows with a
// depth, each session followed by those it started, in the same order. A
// session whose parent is not in `list` is top-level. `roots`, when given,
// limits the top level to those sessions (one project's group); `folded`
// holds the ids whose spawned sessions are hidden.
export function nest(list, { roots = null, folded = new Set() } = {}) {
  const ids = new Set(list.map((s) => s.id))
  const kids = new Map()
  for (const s of list)
    if (s.parent && ids.has(s.parent) && s.parent !== s.id) {
      if (!kids.has(s.parent)) kids.set(s.parent, [])
      kids.get(s.parent).push(s)
    }
  const top = roots ?? list.filter((s) => !(s.parent && ids.has(s.parent)))
  const out = []
  const seen = new Set()
  const walk = (s, depth) => {
    if (seen.has(s.id)) return // a cycle in the records adds nothing
    seen.add(s.id)
    const children = kids.get(s.id) ?? []
    out.push({ s, depth, children: children.length })
    if (!folded.has(s.id)) for (const c of children) walk(c, depth + 1)
  }
  for (const s of top) walk(s, 0)
  return out
}

// The sessions `matches` picks, with each one's ancestors in `all`, so that a
// spawned session shown by the filter keeps the session that started it.
export function withAncestors(all, matches) {
  const byId = new Map(all.map((s) => [s.id, s]))
  const keep = new Set()
  for (const s of all)
    if (matches(s)) {
      let x = s
      while (x && !keep.has(x.id)) {
        keep.add(x.id)
        x = x.parent ? byId.get(x.parent) : null
      }
    }
  return all.filter((s) => keep.has(s.id))
}
