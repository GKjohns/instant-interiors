/** Spot → metres: the public face of the placement resolver. */
export { hashSeed, rng } from '../../math.ts'
export { faceToward, frontOf, sideOf, yawFacing } from './facing.ts'
export { itemLayer, layerOf, overlapArea } from './fit.ts'
export { describeSel, poseBefore, resolveSpot } from './resolve.ts'
export type { Layer, LayoutOpts, LayoutResult, Placed } from './types.ts'
