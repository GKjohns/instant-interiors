/**
 * Yaw convention: 0 faces -z, positive turns toward -x (three.js rotation.y). A kit piece's FRONT is its
 * local +z face, so `faceToward` is the one helper for "turn its front to X"; poly.ts's `yawToward` points
 * the local -z (the camera's forward) and is for the player.
 */
import { dirOf, nearestEdge, yawToward } from '../../plan/poly.ts'
import type { Vec2 } from '../../plan/poly.ts'
import type { Cand, Site } from './types.ts'

export function normYaw(yaw: number): number {
  const y = Math.atan2(Math.sin(yaw), Math.cos(yaw))
  return Object.is(y, -0) ? 0 : y
}

/** The yaw that turns a piece's front (local +z) toward `target`. */
export function faceToward(pos: Vec2, target: Vec2): number {
  return normYaw(yawToward(pos, target) + Math.PI)
}

/** The yaw whose front points along `dir`. */
export function yawFacing(dir: Vec2): number {
  return normYaw(Math.atan2(dir[0], dir[1]))
}

/** Unit vector of a piece's front (local +z) in the plan frame. */
export function frontOf(yaw: number): Vec2 {
  return [Math.sin(yaw), Math.cos(yaw)]
}

/** Unit vector of a piece's local +x: its own left-hand side when it looks out of its front. */
export function sideOf(yaw: number): Vec2 {
  return [Math.cos(yaw), -Math.sin(yaw)]
}

/** The spot's `facing`, applied to a candidate that has already found its place. */
export function applyFacing(site: Site, c: Cand): Cand {
  const f = site.spot?.facing
  if (!f) return c
  switch (f) {
    // A piece pinned to a wall already faces straight into the room; aiming it at the centroid skewed a bed
    // off its wall into the dresser, and "move the bed to the south wall, facing the room" failed.
    case 'room': return c.pinned ? c : { ...c, yaw: faceToward(c.pos, site.center) }
    case 'wall': {
      const e = nearestEdge(c.pos, site.poly)
      return { ...c, yaw: yawFacing([-e.normal[0], -e.normal[1]]) }
    }
    case 'window': return site.windows[0] ? { ...c, yaw: faceToward(c.pos, site.windows[0].at) } : c
    case 'player': return { ...c, yaw: faceToward(c.pos, site.ctx.player.pos) }
    case 'of': return site.anchor ? { ...c, yaw: faceToward(c.pos, site.anchor.pos) } : c
    default: return { ...c, yaw: yawFacing(dirOf(f)) }
  }
}
