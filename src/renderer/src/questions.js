// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Questions on the board (R13): the geometry of a speech balloon whose arm is
// part of its outline, drawn as the balloon (a rounded rectangle) and two
// locked line elements over its edge: a filled wedge that covers the
// rectangle's border where the arm leaves it, and the arm's two sides.

const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
const HALF = 12 // half the width of the arm where it leaves the balloon
const INSET = 2 // the wedge reaches this far inside, over the border

// The side of the rectangle the arm leaves from, or null where the tip is
// inside the rectangle.
export function armSide(r, tip) {
  if (tip.x > r.x && tip.x < r.x + r.width && tip.y > r.y && tip.y < r.y + r.height) return null
  const dx = tip.x - (r.x + r.width / 2)
  const dy = tip.y - (r.y + r.height / 2)
  return Math.abs(dx) / r.width > Math.abs(dy) / r.height ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'bottom' : 'top'
}

// The arm's points in scene coordinates: `sides` (base, tip, base) and
// `wedge` (a closed polygon with its base just inside the rectangle).
export function armGeometry(r, tip, radius = 16) {
  const side = armSide(r, tip)
  if (!side) return null
  const horiz = side === 'top' || side === 'bottom'
  const lo = (horiz ? r.x : r.y) + radius + HALF
  const hi = (horiz ? r.x + r.width : r.y + r.height) - radius - HALF
  const c = lo <= hi ? clamp(horiz ? tip.x : tip.y, lo, hi) : horiz ? r.x + r.width / 2 : r.y + r.height / 2
  const edge = { top: r.y, bottom: r.y + r.height, left: r.x, right: r.x + r.width }[side]
  const inward = side === 'top' || side === 'left' ? INSET : -INSET
  const at = (along, off) => (horiz ? { x: along, y: edge + off } : { x: edge + off, y: along })
  const a = at(c - HALF, 0)
  const b = at(c + HALF, 0)
  return { side, sides: [a, tip, b], wedge: [at(c - HALF, inward), tip, at(c + HALF, inward), at(c - HALF, inward)] }
}

// A line element's position and points for scene coordinates.
export function asLine(pts) {
  const x = pts[0].x
  const y = pts[0].y
  const points = pts.map((p) => [p.x - x, p.y - y])
  const xs = points.map((p) => p[0])
  const ys = points.map((p) => p[1])
  return { x, y, points, width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) }
}

// The point a balloon's arm reaches: a fixed place on the shape it was
// pointed at (moving with it), the nearest point of the answer it follows,
// or a fixed point of the board.
export function tipOf(tip, target, balloon) {
  if (target && tip.edge) {
    const cx = target.x + target.width / 2
    const cy = target.y + target.height / 2
    const bx = balloon.x + balloon.width / 2
    const by = balloon.y + balloon.height / 2
    const dx = bx - cx
    const dy = by - cy
    if (!dx && !dy) return { x: cx, y: cy }
    const s = Math.min(Math.abs(target.width / 2 / (dx || 1e-9)), Math.abs(target.height / 2 / (dy || 1e-9)))
    return { x: cx + dx * s, y: cy + dy * s }
  }
  if (target) return { x: target.x + tip.fx * target.width, y: target.y + tip.fy * target.height }
  return { x: tip.x, y: tip.y }
}
