/** Everything the app derives from a FloorPlan. Pure, no three.js. */
export type { Compass } from '../poly.ts'
export { DOOR_CLEAR, DOOR_HEAD, EXTERIOR_WALL, INTERIOR_WALL, OUTSIDE, WINDOW_HEAD, WINDOW_SILL, walls } from './walls.ts'
export type { Wall, WallOpening, WallPiece } from './walls.ts'
export { cornersOf, doorsOf, freeAlong, largestRoom, longestEdge, planBounds, roomAt, roomCenter, wallSegmentsOf, windowsOf } from './rooms.ts'
export type { RoomCorner, RoomOpening, RoomWall, Stretch } from './rooms.ts'
export { connectRooms, entry } from './entry.ts'
export type { Pose } from './entry.ts'
