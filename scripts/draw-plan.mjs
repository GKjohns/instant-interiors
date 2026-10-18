/**
 * Draw every sample FloorPlan as a listing-style plan: public/samples/<id>.svg and .png. These PNGs are the
 * ground truth for scripts/bench-extract.mjs (the reader gets the picture, the score uses the numbers).
 *   npm run draw:plans
 * SVG → PNG goes through Playwright's chromium (no rsvg-convert on this machine; sips can't read SVG).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright'
import { SAMPLES } from '../shared/plan/samples.ts'
import { bounds, centroid } from '../shared/plan/poly.ts'

const PX = 70 // px per metre
const MARGIN = 40
const EXT = 0.25
const INT = 0.12

const FILL = {
  living: '#f3e9d8', dining: '#f3e9d8', bedroom: '#efe3d2', kitchen: '#e9e4da', bathroom: '#e3e8ea', office: '#efe6d8',
  hall: '#f1ece3', closet: '#ebe6dd', laundry: '#e8e6e0', garage: '#e1e1de', balcony: '#dcdcd6', other: '#ece9e2'
}

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
const fmt = n => +n.toFixed(2)

/** 3.48 m → 11'5" */
function feetInches(m) {
  const totalIn = Math.round(m / 0.0254)
  const ft = Math.floor(totalIn / 12)
  const inch = totalIn % 12
  return `${ft}'${inch}"`
}

/** Edge key independent of direction, so two rooms sharing a wall agree. */
const key = (a, b) => [a, b].map(p => `${fmt(p[0])},${fmt(p[1])}`).sort().join('|')

function edges(room) {
  const out = []
  for (let i = 0; i < room.polygon.length; i++) out.push([room.polygon[i], room.polygon[(i + 1) % room.polygon.length]])
  return out
}

/** Is segment [a,b] (axis-aligned) covered by any other room's edge along the same line? Partial overlaps count as shared for that stretch. */
function sharedStretches(a, b, rooms, self) {
  const vertical = Math.abs(a[0] - b[0]) < 1e-6
  const line = vertical ? a[0] : a[1]
  const lo = Math.min(vertical ? a[1] : a[0], vertical ? b[1] : b[0])
  const hi = Math.max(vertical ? a[1] : a[0], vertical ? b[1] : b[0])
  const spans = []
  for (const r of rooms) {
    if (r === self) continue
    for (const [c, d] of edges(r)) {
      const v2 = Math.abs(c[0] - d[0]) < 1e-6
      if (v2 !== vertical) continue
      const line2 = vertical ? c[0] : c[1]
      if (Math.abs(line2 - line) > 1e-3) continue
      const l2 = Math.min(vertical ? c[1] : c[0], vertical ? d[1] : d[0])
      const h2 = Math.max(vertical ? c[1] : c[0], vertical ? d[1] : d[0])
      const s = Math.max(lo, l2)
      const e = Math.min(hi, h2)
      if (e - s > 1e-3) spans.push([s, e])
    }
  }
  return { vertical, line, lo, hi, spans }
}

function drawPlan(plan) {
  const all = plan.rooms.flatMap(r => r.polygon)
  const bb = bounds(all)
  const W = Math.ceil(bb.size[0] * PX + MARGIN * 2 + EXT * PX)
  const H = Math.ceil(bb.size[1] * PX + MARGIN * 2 + EXT * PX + 30)
  const X = x => MARGIN + EXT * PX / 2 + (x - bb.min[0]) * PX
  const Z = z => MARGIN + EXT * PX / 2 + (z - bb.min[1]) * PX
  const parts = [`<rect width="${W}" height="${H}" fill="#ffffff"/>`]

  // floors
  for (const r of plan.rooms) {
    const pts = r.polygon.map(p => `${X(p[0])},${Z(p[1])}`).join(' ')
    parts.push(`<polygon points="${pts}" fill="${FILL[r.type] ?? FILL.other}" stroke="none"/>`)
  }

  // walls: one strip per edge stretch; shared stretches thin, exterior thick, drawn once via a seen-set
  const seen = new Set()
  const wallRects = []
  for (const r of plan.rooms) {
    for (const [a, b] of edges(r)) {
      const k = key(a, b)
      const { vertical, line, lo, hi, spans } = sharedStretches(a, b, plan.rooms, r)
      // split [lo,hi] into shared / exterior pieces
      const cuts = [lo, hi, ...spans.flat()].sort((p, q) => p - q)
      for (let i = 0; i < cuts.length - 1; i++) {
        const s = cuts[i]
        const e = cuts[i + 1]
        if (e - s < 1e-3) continue
        const mid = (s + e) / 2
        const shared = spans.some(([p, q]) => mid > p && mid < q)
        const sk = `${k}:${fmt(s)}-${fmt(e)}:${vertical ? 'v' : 'h'}:${fmt(line)}`
        if (seen.has(sk)) continue
        seen.add(sk)
        const t = shared ? INT : EXT
        wallRects.push({ vertical, line, s, e, t })
      }
    }
  }

  // openings cut gaps out of the wall strips: collect per opening the stretch along its wall
  const gaps = plan.openings.map((o) => {
    // find the wall line this opening sits on: nearest edge of its first room
    const room = plan.rooms.find(r => r.id === o.rooms[0]) ?? plan.rooms.find(r => r.id === o.rooms[1])
    let best = null
    for (const [a, b] of edges(room)) {
      const vertical = Math.abs(a[0] - b[0]) < 1e-6
      const d = vertical ? Math.abs(o.at[0] - a[0]) : Math.abs(o.at[1] - a[1])
      const along = vertical ? o.at[1] : o.at[0]
      const lo = Math.min(vertical ? a[1] : a[0], vertical ? b[1] : b[0])
      const hi = Math.max(vertical ? a[1] : a[0], vertical ? b[1] : b[0])
      if (along < lo - 0.01 || along > hi + 0.01) continue
      if (!best || d < best.d) best = { d, vertical, line: vertical ? a[0] : a[1] }
    }
    const half = o.width / 2
    const along = best.vertical ? o.at[1] : o.at[0]
    return { ...o, vertical: best.vertical, line: best.line, s: along - half, e: along + half }
  })

  for (const w of wallRects) {
    // subtract gaps on the same line
    let pieces = [[w.s, w.e]]
    for (const g of gaps) {
      if (g.vertical !== w.vertical || Math.abs(g.line - w.line) > 1e-3) continue
      pieces = pieces.flatMap(([s, e]) => {
        if (g.e <= s || g.s >= e) return [[s, e]]
        const out = []
        if (g.s > s) out.push([s, g.s])
        if (g.e < e) out.push([g.e, e])
        return out
      })
    }
    for (const [s, e] of pieces) {
      const t = w.t * PX
      if (w.vertical) parts.push(`<rect x="${X(w.line) - t / 2}" y="${Z(s)}" width="${t}" height="${(e - s) * PX}" fill="#2b2b2e"/>`)
      else parts.push(`<rect x="${X(s)}" y="${Z(w.line) - t / 2}" width="${(e - s) * PX}" height="${t}" fill="#2b2b2e"/>`)
    }
  }

  // openings: windows (double line), doors (leaf + arc), cased openings (nothing: the gap reads as one)
  for (const g of gaps) {
    const thick = (g.rooms.includes('outside') ? EXT : INT) * PX
    if (g.kind === 'window') {
      const off = thick * 0.28
      if (g.vertical) {
        const x = X(g.line)
        parts.push(`<line x1="${x - off}" y1="${Z(g.s)}" x2="${x - off}" y2="${Z(g.e)}" stroke="#2b2b2e" stroke-width="1.5"/>`)
        parts.push(`<line x1="${x + off}" y1="${Z(g.s)}" x2="${x + off}" y2="${Z(g.e)}" stroke="#2b2b2e" stroke-width="1.5"/>`)
        parts.push(`<rect x="${x - thick / 2}" y="${Z(g.s) - 1}" width="${thick}" height="2" fill="#2b2b2e"/><rect x="${x - thick / 2}" y="${Z(g.e) - 1}" width="${thick}" height="2" fill="#2b2b2e"/>`)
      } else {
        const z = Z(g.line)
        parts.push(`<line x1="${X(g.s)}" y1="${z - off}" x2="${X(g.e)}" y2="${z - off}" stroke="#2b2b2e" stroke-width="1.5"/>`)
        parts.push(`<line x1="${X(g.s)}" y1="${z + off}" x2="${X(g.e)}" y2="${z + off}" stroke="#2b2b2e" stroke-width="1.5"/>`)
        parts.push(`<rect x="${X(g.s) - 1}" y="${z - thick / 2}" width="2" height="${thick}" fill="#2b2b2e"/><rect x="${X(g.e) - 1}" y="${z - thick / 2}" width="2" height="${thick}" fill="#2b2b2e"/>`)
      }
    } else if (g.kind === 'door') {
      // swing into the first room (or the only interior room): pick the side whose centroid is on that side of the wall
      const into = plan.rooms.find(r => r.id === g.rooms[0] && r.id !== 'outside') ?? plan.rooms.find(r => r.id === g.rooms[1])
      const c = centroid(into.polygon)
      const w = g.width * PX
      if (g.vertical) {
        const x = X(g.line)
        const dir = c[0] > g.line ? 1 : -1 // swings toward +x or -x
        const hy = Z(g.s)
        // hinge at s end, leaf perpendicular to the wall, arc back to the wall at e end
        parts.push(`<line x1="${x}" y1="${hy}" x2="${x + dir * w}" y2="${hy}" stroke="#2b2b2e" stroke-width="1.5"/>`)
        parts.push(`<path d="M ${x + dir * w} ${hy} A ${w} ${w} 0 0 ${dir > 0 ? 1 : 0} ${x} ${hy + w}" fill="none" stroke="#2b2b2e" stroke-width="1"/>`)
      } else {
        const z = Z(g.line)
        const dir = c[1] > g.line ? 1 : -1
        const hx = X(g.s)
        parts.push(`<line x1="${hx}" y1="${z}" x2="${hx}" y2="${z + dir * w}" stroke="#2b2b2e" stroke-width="1.5"/>`)
        parts.push(`<path d="M ${hx} ${z + dir * w} A ${w} ${w} 0 0 ${dir > 0 ? 0 : 1} ${hx + w} ${z}" fill="none" stroke="#2b2b2e" stroke-width="1"/>`)
      }
    }
  }

  // labels
  for (const r of plan.rooms) {
    const c = centroid(r.polygon)
    const b = bounds(r.polygon)
    const small = b.size[0] * b.size[1] < 4
    const fs = small ? 11 : 15
    parts.push(`<text x="${X(c[0])}" y="${Z(c[1]) - (small ? 2 : 4)}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="${fs}" fill="#1c1a18">${esc(r.name)}</text>`)
    if (!small || b.size[0] > 1.6) parts.push(`<text x="${X(c[0])}" y="${Z(c[1]) + (small ? 10 : 14)}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="${small ? 9 : 12}" fill="#3b3129">${feetInches(b.size[0])} x ${feetInches(b.size[1])}</text>`)
  }

  // north arrow (top is north rotated by plan.north)
  const nx = W - 28
  const ny = 30
  parts.push(`<g transform="translate(${nx},${ny}) rotate(${-(plan.north ?? 0)})"><line x1="0" y1="14" x2="0" y2="-12" stroke="#1c1a18" stroke-width="1.5"/><polygon points="0,-16 -5,-6 5,-6" fill="#1c1a18"/><text x="0" y="28" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="11" fill="#1c1a18">N</text></g>`)
  parts.push(`<text x="${MARGIN}" y="${H - 12}" font-family="Helvetica, Arial, sans-serif" font-size="12" fill="#6b6560">${esc(plan.name)} · ${feetInches(bb.size[0])} x ${feetInches(bb.size[1])}</text>`)

  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join('\n')}</svg>`, W, H }
}

const outDir = resolve(import.meta.dirname, '../public/samples')
mkdirSync(outDir, { recursive: true })
const browser = await chromium.launch()
try {
  for (const plan of SAMPLES) {
    const { svg, W, H } = drawPlan(plan)
    const svgPath = resolve(outDir, `${plan.id}.svg`)
    const pngPath = resolve(outDir, `${plan.id}.png`)
    writeFileSync(svgPath, svg)
    const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })
    await page.setContent(`<!doctype html><html><body style="margin:0;background:#fff">${svg}</body></html>`)
    await page.locator('svg').screenshot({ path: pngPath })
    await page.close()
    console.log(`${plan.id}: ${plan.rooms.length} rooms, ${plan.openings.length} openings → ${svgPath}, ${pngPath} (${W}×${H}, ${PX} px/m)`)
  }
} finally {
  await browser.close()
}
