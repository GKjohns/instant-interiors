/**
 * The furniture catalog: every kind the model may name, with the facts the kernel needs to place it
 * (footprint, height, where it naturally goes, which way it faces) and the facts the renderer needs to
 * draw it (default colours). The kit (app/home/kit/*) builds one `Build` per kind listed here; the intent
 * digest lists these names to the model. Adding a kind = one row here + one builder in the kit.
 *
 * Footprints are [length, width] in metres: length along the thing's front, width (depth) from front to
 * back. Fronts face +z in the kit's local frame (toward the viewer when yaw = 0 faces -z... see layout.ts:
 * a thing with `face: 'room'` is turned so its front looks into the room).
 */
import type { RoomType } from '../plan/schema.ts'
import type { Arrangement, Spot } from './ops.ts'

/** Where a kind naturally lives when the sentence doesn't say. */
export type NaturalPlace = 'wall' | 'center' | 'corner' | 'free' | 'ceiling' | 'wall_mounted' | 'window'
/** What its front turns toward once placed: into the room, back to the wall, nowhere in particular, or the thing it was placed near (anchor). */
export type NaturalFace = 'room' | 'wall' | 'none' | 'anchor'

export const TAGS = ['seating', 'table', 'storage', 'light', 'bed', 'plant', 'art', 'appliance', 'fixture', 'desk', 'decor', 'textile'] as const
export type Tag = typeof TAGS[number]

export interface KindDescriptor {
  kind: string
  label: string
  footprint: [number, number]
  height: number
  place: NaturalPlace
  face: NaturalFace
  tags: Tag[]
  /** Rooms this kind usually appears in (the furnish defaults and the digest's hints use it). */
  rooms: RoomType[]
  color: string
  trim?: string
  /** Emits light when lit (lamps, pendants, sconces, the TV's glow). */
  light?: boolean
  /** `length` / `width` props resize the footprint (rugs, tables, beds, counters, shelves). */
  sized?: boolean
  /** Hangs on a wall at `hang` metres (art, mirror, TV, sconce, shelf). */
  hang?: number
}

const K = (kind: string, label: string, footprint: [number, number], height: number, place: NaturalPlace, face: NaturalFace, tags: Tag[], rooms: RoomType[], color: string, extra: Partial<KindDescriptor> = {}): KindDescriptor =>
  ({ kind, label, footprint, height, place, face, tags, rooms, color, ...extra })

export const CATALOG: KindDescriptor[] = [
  // seating
  K('sofa', 'sofa', [2.1, 0.9], 0.85, 'wall', 'room', ['seating'], ['living', 'office'], '#6b7b8c', { trim: '#3b3129', sized: true }),
  K('loveseat', 'loveseat', [1.5, 0.9], 0.85, 'wall', 'room', ['seating'], ['living', 'bedroom'], '#8a7f74', { trim: '#3b3129' }),
  K('sectional', 'sectional sofa', [2.8, 1.8], 0.85, 'corner', 'room', ['seating'], ['living'], '#7a8a7a', { trim: '#3b3129', sized: true }),
  K('armchair', 'armchair', [0.9, 0.9], 0.9, 'free', 'room', ['seating'], ['living', 'bedroom', 'office'], '#a0623d', { trim: '#3b3129' }),
  K('ottoman', 'ottoman', [0.7, 0.7], 0.42, 'free', 'none', ['seating'], ['living'], '#9c8b7a'),
  K('bench', 'bench', [1.3, 0.45], 0.45, 'wall', 'room', ['seating'], ['hall', 'bedroom', 'dining'], '#9a7b5b'),
  K('dining_chair', 'dining chair', [0.48, 0.52], 0.9, 'free', 'anchor', ['seating'], ['dining', 'kitchen'], '#8a6a4a'),
  K('bar_stool', 'bar stool', [0.4, 0.4], 0.75, 'free', 'none', ['seating'], ['kitchen'], '#3b3129', { trim: '#b08968' }),
  K('office_chair', 'office chair', [0.6, 0.6], 1.0, 'free', 'wall', ['seating'], ['office'], '#2b2b2e'),
  K('stool', 'stool', [0.35, 0.35], 0.45, 'free', 'none', ['seating'], ['bathroom', 'bedroom', 'kitchen'], '#b08968'),
  // tables and desks
  K('coffee_table', 'coffee table', [1.1, 0.6], 0.42, 'center', 'none', ['table'], ['living'], '#7a5a3a', { sized: true }),
  K('side_table', 'side table', [0.5, 0.5], 0.55, 'free', 'none', ['table'], ['living', 'bedroom'], '#7a5a3a'),
  K('console_table', 'console table', [1.2, 0.35], 0.8, 'wall', 'wall', ['table'], ['hall', 'living'], '#5a4030'),
  K('dining_table', 'dining table', [1.8, 0.9], 0.75, 'center', 'none', ['table'], ['dining', 'kitchen'], '#8b6a48', { sized: true }),
  K('round_table', 'round table', [1.2, 1.2], 0.75, 'center', 'none', ['table'], ['dining', 'kitchen'], '#8b6a48', { sized: true }),
  K('desk', 'desk', [1.4, 0.7], 0.75, 'wall', 'wall', ['desk', 'table'], ['office', 'bedroom'], '#9a7a58', { sized: true }),
  K('nightstand', 'nightstand', [0.5, 0.4], 0.6, 'wall', 'wall', ['table', 'storage'], ['bedroom'], '#8a6a4a'),
  K('vanity_table', 'vanity table', [1.1, 0.5], 0.75, 'wall', 'wall', ['table'], ['bedroom'], '#d9cfc2'),
  // beds
  K('bed', 'bed (queen)', [1.6, 2.05], 0.55, 'wall', 'wall', ['bed'], ['bedroom'], '#d8d2c6', { trim: '#5a4030', sized: true }),
  K('king_bed', 'bed (king)', [1.95, 2.1], 0.55, 'wall', 'wall', ['bed'], ['bedroom'], '#d8d2c6', { trim: '#5a4030', sized: true }),
  K('single_bed', 'bed (single)', [1.0, 2.0], 0.5, 'wall', 'wall', ['bed'], ['bedroom'], '#cfd6dd', { trim: '#6a5040' }),
  K('bunk_bed', 'bunk bed', [1.0, 2.0], 1.7, 'wall', 'wall', ['bed'], ['bedroom'], '#c9b9a5', { trim: '#5a4030' }),
  K('crib', 'crib', [0.7, 1.3], 0.9, 'wall', 'wall', ['bed'], ['bedroom'], '#efe6da', { trim: '#8a6a4a' }),
  // storage
  K('bookshelf', 'bookshelf', [0.9, 0.35], 2.0, 'wall', 'wall', ['storage'], ['living', 'office', 'bedroom'], '#6a4a30', { sized: true }),
  K('wardrobe', 'wardrobe', [1.5, 0.6], 2.1, 'wall', 'wall', ['storage'], ['bedroom', 'closet'], '#a88a68', { sized: true }),
  K('dresser', 'dresser', [1.3, 0.5], 0.85, 'wall', 'wall', ['storage'], ['bedroom'], '#9a7a58'),
  K('cabinet', 'cabinet', [0.9, 0.45], 0.9, 'wall', 'wall', ['storage'], ['living', 'dining', 'hall', 'bathroom'], '#5a4a40'),
  K('tv_stand', 'TV stand', [1.6, 0.45], 0.5, 'wall', 'wall', ['storage'], ['living', 'bedroom'], '#3b3129', { sized: true }),
  K('shoe_rack', 'shoe rack', [0.8, 0.3], 0.7, 'wall', 'wall', ['storage'], ['hall', 'closet'], '#8a6a4a'),
  K('coat_rack', 'coat rack', [0.4, 0.4], 1.8, 'corner', 'none', ['storage'], ['hall'], '#3b3129'),
  // lighting
  K('floor_lamp', 'floor lamp', [0.35, 0.35], 1.6, 'corner', 'none', ['light'], ['living', 'bedroom', 'office'], '#2b2b2e', { trim: '#f1e2c2', light: true }),
  K('table_lamp', 'table lamp', [0.3, 0.3], 0.5, 'free', 'none', ['light'], ['bedroom', 'living'], '#8a6a4a', { trim: '#f1e2c2', light: true }),
  K('pendant', 'pendant light', [0.4, 0.4], 0.5, 'ceiling', 'none', ['light'], ['dining', 'kitchen', 'living'], '#2b2b2e', { trim: '#ffe6b0', light: true }),
  K('chandelier', 'chandelier', [0.8, 0.8], 0.7, 'ceiling', 'none', ['light'], ['dining', 'living', 'hall'], '#c9a24a', { trim: '#fff1cc', light: true }),
  K('ceiling_light', 'ceiling light', [0.4, 0.4], 0.15, 'ceiling', 'none', ['light'], ['hall', 'bedroom', 'kitchen', 'bathroom', 'closet', 'laundry'], '#f4f1ea', { trim: '#fff6dd', light: true }),
  K('sconce', 'wall sconce', [0.2, 0.15], 0.3, 'wall_mounted', 'wall', ['light'], ['hall', 'bedroom', 'bathroom', 'living'], '#3b3129', { trim: '#ffe6b0', light: true, hang: 1.8 }),
  K('candles', 'candles', [0.3, 0.2], 0.25, 'free', 'none', ['light', 'decor'], ['dining', 'living', 'bathroom'], '#f1e2c2', { light: true }),
  // soft things and decor
  K('rug', 'rug', [2.4, 1.7], 0.02, 'center', 'none', ['textile'], ['living', 'bedroom', 'dining', 'hall'], '#8c3b3b', { trim: '#d8c8a8', sized: true }),
  K('runner', 'runner rug', [2.4, 0.7], 0.02, 'center', 'none', ['textile'], ['hall', 'kitchen'], '#5a6a7a', { trim: '#d8c8a8', sized: true }),
  K('curtains', 'curtains', [1.6, 0.15], 2.5, 'window', 'wall', ['textile'], ['living', 'bedroom', 'dining', 'office'], '#c9c0b2', { sized: true }),
  K('plant', 'potted plant', [0.5, 0.5], 1.3, 'corner', 'none', ['plant'], ['living', 'office', 'hall', 'bedroom', 'bathroom', 'kitchen', 'dining'], '#3f7a45', { trim: '#9a6a4a' }),
  K('tree', 'indoor tree', [0.8, 0.8], 2.2, 'corner', 'none', ['plant'], ['living', 'hall', 'office'], '#2f6a3a', { trim: '#9a6a4a' }),
  K('picture', 'framed picture', [0.8, 0.05], 0.6, 'wall_mounted', 'wall', ['art'], ['living', 'bedroom', 'hall', 'dining', 'office'], '#4a6a8a', { trim: '#2b2219', hang: 1.55, sized: true }),
  K('mirror', 'mirror', [0.7, 0.05], 1.0, 'wall_mounted', 'wall', ['art', 'decor'], ['hall', 'bedroom', 'bathroom'], '#b8c4cc', { trim: '#c9a24a', hang: 1.5, sized: true }),
  K('clock', 'wall clock', [0.35, 0.05], 0.35, 'wall_mounted', 'wall', ['decor'], ['kitchen', 'living', 'office'], '#f4f1ea', { trim: '#2b2b2e', hang: 1.9 }),
  K('shelf', 'floating shelf', [0.9, 0.25], 0.05, 'wall_mounted', 'wall', ['storage', 'decor'], ['living', 'kitchen', 'bathroom', 'office'], '#8a6a4a', { hang: 1.5, sized: true }),
  K('vase', 'vase', [0.2, 0.2], 0.35, 'free', 'none', ['decor'], ['living', 'dining', 'hall'], '#c9d3d7'),
  K('books', 'stack of books', [0.25, 0.2], 0.15, 'free', 'none', ['decor'], ['living', 'office', 'bedroom'], '#8c3b3b'),
  K('piano', 'upright piano', [1.5, 0.6], 1.25, 'wall', 'wall', ['decor'], ['living'], '#1c1a18'),
  // screens and appliances
  K('tv', 'television', [1.4, 0.08], 0.8, 'wall_mounted', 'wall', ['appliance'], ['living', 'bedroom'], '#111214', { trim: '#2b2b2e', hang: 1.3, light: true, sized: true }),
  K('fridge', 'refrigerator', [0.9, 0.7], 1.8, 'wall', 'wall', ['appliance'], ['kitchen'], '#d9d9d6'),
  K('stove', 'stove', [0.75, 0.65], 0.9, 'wall', 'wall', ['appliance'], ['kitchen'], '#d9d9d6', { trim: '#2b2b2e' }),
  K('counter', 'kitchen counter', [1.8, 0.6], 0.9, 'wall', 'wall', ['storage'], ['kitchen'], '#eae6dd', { trim: '#8a6a4a', sized: true }),
  K('island', 'kitchen island', [1.8, 0.9], 0.9, 'center', 'none', ['storage', 'table'], ['kitchen'], '#eae6dd', { trim: '#5a4030', sized: true }),
  K('upper_cabinets', 'upper cabinets', [1.8, 0.35], 0.7, 'wall_mounted', 'wall', ['storage'], ['kitchen'], '#eae6dd', { hang: 1.85, sized: true }),
  K('sink', 'kitchen sink', [0.9, 0.6], 0.9, 'wall', 'wall', ['fixture', 'appliance'], ['kitchen', 'laundry'], '#eae6dd', { trim: '#b8bcc0' }),
  K('dishwasher', 'dishwasher', [0.6, 0.6], 0.85, 'wall', 'wall', ['appliance'], ['kitchen'], '#d9d9d6'),
  K('washer', 'washing machine', [0.6, 0.6], 0.85, 'wall', 'wall', ['appliance'], ['laundry', 'bathroom', 'kitchen'], '#eceae6'),
  K('dryer', 'dryer', [0.6, 0.6], 0.85, 'wall', 'wall', ['appliance'], ['laundry'], '#eceae6'),
  // bathroom
  K('toilet', 'toilet', [0.4, 0.7], 0.75, 'wall', 'wall', ['fixture'], ['bathroom'], '#f4f4f2'),
  K('bathtub', 'bathtub', [1.7, 0.75], 0.58, 'wall', 'wall', ['fixture'], ['bathroom'], '#f4f4f2', { trim: '#b8bcc0', sized: true }),
  K('shower', 'shower', [0.9, 0.9], 2.1, 'corner', 'none', ['fixture'], ['bathroom'], '#dfe7ea', { trim: '#b8bcc0' }),
  K('vanity', 'bathroom vanity', [0.9, 0.55], 0.85, 'wall', 'wall', ['fixture', 'storage'], ['bathroom'], '#eae6dd', { trim: '#f4f4f2', sized: true }),
  K('towel_rack', 'towel rack', [0.6, 0.1], 0.1, 'wall_mounted', 'wall', ['fixture'], ['bathroom'], '#b8bcc0', { trim: '#dfe7ea', hang: 1.2 }),
  // misc
  K('exercise_bike', 'exercise bike', [0.6, 1.2], 1.2, 'free', 'room', ['decor'], ['office', 'bedroom', 'living'], '#2b2b2e'),
  K('box', 'box', [0.5, 0.5], 0.5, 'free', 'none', ['decor'], ['garage', 'closet'], '#b08968'),
  K('bicycle', 'bicycle', [1.7, 0.5], 1.0, 'wall', 'wall', ['decor'], ['garage', 'hall', 'balcony'], '#2b4a6a'),
  K('car', 'car', [1.9, 4.5], 1.5, 'center', 'none', ['decor'], ['garage'], '#8a2b2b'),
  K('planter', 'planter box', [0.9, 0.35], 0.4, 'wall', 'none', ['plant'], ['balcony'], '#9a6a4a', { trim: '#3f7a45' }),
  K('outdoor_chair', 'outdoor chair', [0.6, 0.6], 0.85, 'free', 'room', ['seating'], ['balcony'], '#3b3129')
]

export const KIT: Record<string, KindDescriptor> = Object.fromEntries(CATALOG.map(k => [k.kind, k]))

/** Everyday words → catalog kinds. Checked after normalizeKind, so keys are snake_case. */
export const ALIASES: Record<string, string> = {
  couch: 'sofa', settee: 'sofa', chesterfield: 'sofa', davenport: 'sofa', sofa_bed: 'sofa', futon: 'sofa',
  l_shaped_sofa: 'sectional', corner_sofa: 'sectional', sectional_sofa: 'sectional',
  chair: 'armchair', accent_chair: 'armchair', lounge_chair: 'armchair', recliner: 'armchair', reading_chair: 'armchair',
  footstool: 'ottoman', pouf: 'ottoman', pouffe: 'ottoman',
  kitchen_chair: 'dining_chair', chairs: 'dining_chair', stools: 'bar_stool', barstool: 'bar_stool', counter_stool: 'bar_stool',
  desk_chair: 'office_chair', task_chair: 'office_chair', swivel_chair: 'office_chair',
  table: 'coffee_table', cocktail_table: 'coffee_table', end_table: 'side_table', lamp_table: 'side_table', accent_table: 'side_table',
  console: 'console_table', entry_table: 'console_table', hall_table: 'console_table', sideboard: 'cabinet', credenza: 'cabinet', buffet: 'cabinet', hutch: 'cabinet', sofa_table: 'console_table',
  kitchen_table: 'dining_table', dinner_table: 'dining_table', dining_set: 'dining_table', breakfast_table: 'round_table', bistro_table: 'round_table',
  writing_desk: 'desk', standing_desk: 'desk', workstation: 'desk', computer_desk: 'desk',
  bedside_table: 'nightstand', night_table: 'nightstand', night_stand: 'nightstand', bedside: 'nightstand',
  queen_bed: 'bed', double_bed: 'bed', full_bed: 'bed', queen: 'bed', king: 'king_bed', king_size_bed: 'king_bed', california_king: 'king_bed',
  twin_bed: 'single_bed', twin: 'single_bed', daybed: 'single_bed', cot: 'crib', bassinet: 'crib',
  bookcase: 'bookshelf', shelves: 'bookshelf', shelving: 'bookshelf', book_case: 'bookshelf', library: 'bookshelf',
  closet: 'wardrobe', armoire: 'wardrobe', chest: 'dresser', chest_of_drawers: 'dresser', drawers: 'dresser', bureau: 'dresser', highboy: 'dresser',
  media_console: 'tv_stand', tv_unit: 'tv_stand', tv_console: 'tv_stand', entertainment_center: 'tv_stand', media_unit: 'tv_stand',
  television: 'tv', telly: 'tv', screen: 'tv', flatscreen: 'tv', monitor: 'tv',
  lamp: 'floor_lamp', standing_lamp: 'floor_lamp', reading_lamp: 'floor_lamp', arc_lamp: 'floor_lamp', desk_lamp: 'table_lamp', bedside_lamp: 'table_lamp',
  light: 'ceiling_light', ceiling_lamp: 'ceiling_light', flush_mount: 'ceiling_light', overhead_light: 'ceiling_light', pendant_light: 'pendant', hanging_light: 'pendant', pendant_lamp: 'pendant',
  wall_light: 'sconce', wall_lamp: 'sconce', wall_sconce: 'sconce', candle: 'candles',
  carpet: 'rug', area_rug: 'rug', mat: 'rug', hall_runner: 'runner', drapes: 'curtains', curtain: 'curtains', blinds: 'curtains', drapery: 'curtains',
  houseplant: 'plant', potted_plant: 'plant', fern: 'plant', monstera: 'plant', fiddle_leaf: 'tree', fiddle_leaf_fig: 'tree', palm: 'tree', plants: 'plant', flowers: 'vase', bouquet: 'vase',
  painting: 'picture', art: 'picture', artwork: 'picture', wall_art: 'picture', print: 'picture', poster: 'picture', frame: 'picture', photo: 'picture', gallery_wall: 'picture',
  floating_shelf: 'shelf', wall_shelf: 'shelf', wall_shelves: 'shelf',
  refrigerator: 'fridge', freezer: 'fridge', oven: 'stove', range: 'stove', cooker: 'stove', cooktop: 'stove', hob: 'stove',
  countertop: 'counter', counters: 'counter', worktop: 'counter', kitchen_counters: 'counter', cabinets: 'counter', lower_cabinets: 'counter', kitchen_cabinets: 'counter', cupboards: 'upper_cabinets', wall_cabinets: 'upper_cabinets',
  kitchen_island: 'island', breakfast_bar: 'island', peninsula: 'island',
  kitchen_sink: 'sink', washing_machine: 'washer', laundry_machine: 'washer', tumble_dryer: 'dryer',
  wc: 'toilet', loo: 'toilet', tub: 'bathtub', bath: 'bathtub', soaking_tub: 'bathtub', shower_stall: 'shower', walk_in_shower: 'shower',
  bathroom_vanity: 'vanity', bathroom_sink: 'vanity', basin: 'vanity', washbasin: 'vanity', towel_bar: 'towel_rack', towel_rail: 'towel_rack',
  coat_stand: 'coat_rack', hall_stand: 'coat_rack', hat_stand: 'coat_rack', shoe_cabinet: 'shoe_rack', shoe_shelf: 'shoe_rack',
  peloton: 'exercise_bike', bike: 'bicycle', treadmill: 'exercise_bike',
  grand_piano: 'piano', keyboard: 'piano', boxes: 'box', crate: 'box', automobile: 'car', patio_chair: 'outdoor_chair', deck_chair: 'outdoor_chair', flower_box: 'planter', window_box: 'planter'
}

/** Resolve any word to a catalog kind, or null. `normalizeKind` first. */
export function kindOf(word: string): KindDescriptor | null {
  const k = word.trim().toLowerCase().replace(/[\s-]+/g, '_').replace(/[^a-z0-9_]/g, '')
  if (KIT[k]) return KIT[k]!
  if (ALIASES[k]) return KIT[ALIASES[k]!]!
  // "sofas" → sofa, "armchairs" → armchair
  const singular = k.endsWith('es') ? k.slice(0, -2) : k.endsWith('s') ? k.slice(0, -1) : k
  if (KIT[singular]) return KIT[singular]!
  if (ALIASES[singular]) return KIT[ALIASES[singular]!]!
  return null
}

// ---------- furnish defaults ----------

interface FurnishEntry {
  kind: string
  count?: number
  arrange?: Arrangement
  at?: Spot
  /** Only when the room's longest side is at least this long (metres). */
  minLength?: number
}

/**
 * What a room of each type gets from "furnish": the starter layout that makes a bare plan read as a home.
 * The kernel walks these in order; each entry's Spot is resolved by layout.ts with the usual rules
 * (unspecified = the kind's natural place), and anything that doesn't fit is skipped with a note.
 */
export const FURNISH: Record<RoomType, FurnishEntry[]> = {
  living: [
    { kind: 'sofa', at: { where: 'wall' } },
    { kind: 'rug', at: { where: 'near', of: { kind: 'sofa' }, side: 'front', dist: 0.3 } },
    { kind: 'coffee_table', at: { where: 'near', of: { kind: 'sofa' }, side: 'front', dist: 0.5 } },
    { kind: 'tv_stand', at: { where: 'near', of: { kind: 'sofa' }, side: 'opposite' } },
    { kind: 'tv', at: { where: 'near', of: { kind: 'tv_stand' }, side: 'on' } },
    { kind: 'armchair', at: { where: 'near', of: { kind: 'sofa' }, side: 'left', dist: 0.6 }, minLength: 4 },
    { kind: 'floor_lamp', at: { where: 'corner' } },
    { kind: 'plant', at: { where: 'corner' } },
    { kind: 'bookshelf', at: { where: 'wall' }, minLength: 4.5 },
    { kind: 'picture', at: { where: 'wall' } },
    { kind: 'pendant', at: { where: 'center' } }
  ],
  bedroom: [
    { kind: 'bed', at: { where: 'wall' } },
    { kind: 'nightstand', at: { where: 'near', of: { kind: 'bed' }, side: 'left' } },
    { kind: 'nightstand', at: { where: 'near', of: { kind: 'bed' }, side: 'right' } },
    { kind: 'table_lamp', at: { where: 'near', of: { kind: 'nightstand' }, side: 'on' } },
    { kind: 'dresser', at: { where: 'wall' } },
    { kind: 'rug', at: { where: 'near', of: { kind: 'bed' }, side: 'front', dist: -0.6 } },
    { kind: 'wardrobe', at: { where: 'wall' }, minLength: 3.6 },
    { kind: 'picture', at: { where: 'near', of: { kind: 'bed' }, side: 'behind' } },
    { kind: 'plant', at: { where: 'corner' } },
    { kind: 'ceiling_light', at: { where: 'center' } }
  ],
  kitchen: [
    { kind: 'counter', at: { where: 'wall' } },
    { kind: 'sink', at: { where: 'near', of: { kind: 'counter' }, side: 'left', dist: 0 } },
    { kind: 'stove', at: { where: 'near', of: { kind: 'counter' }, side: 'right', dist: 0 } },
    { kind: 'upper_cabinets', at: { where: 'near', of: { kind: 'counter' }, side: 'on' } },
    { kind: 'fridge', at: { where: 'near', of: { kind: 'stove' }, side: 'right', dist: 0.05 } },
    { kind: 'island', at: { where: 'center' }, minLength: 4 },
    { kind: 'bar_stool', count: 2, at: { where: 'near', of: { kind: 'island' }, side: 'front', dist: 0.1 }, minLength: 4 },
    { kind: 'pendant', at: { where: 'center' } },
    { kind: 'clock', at: { where: 'wall' } }
  ],
  dining: [
    { kind: 'dining_table', at: { where: 'center' } },
    { kind: 'dining_chair', count: 4, arrange: 'around', at: { where: 'near', of: { kind: 'dining_table' } } },
    { kind: 'rug', at: { where: 'center' } },
    { kind: 'cabinet', at: { where: 'wall' } },
    { kind: 'chandelier', at: { where: 'center' } },
    { kind: 'picture', at: { where: 'wall' } }
  ],
  bathroom: [
    { kind: 'toilet', at: { where: 'wall' } },
    { kind: 'vanity', at: { where: 'wall' } },
    { kind: 'mirror', at: { where: 'near', of: { kind: 'vanity' }, side: 'on' } },
    { kind: 'bathtub', at: { where: 'wall' }, minLength: 2.2 },
    { kind: 'shower', at: { where: 'corner' } },
    { kind: 'towel_rack', at: { where: 'wall' } },
    { kind: 'ceiling_light', at: { where: 'center' } }
  ],
  office: [
    { kind: 'desk', at: { where: 'window' } },
    { kind: 'office_chair', at: { where: 'near', of: { kind: 'desk' }, side: 'front', dist: 0.1 } },
    { kind: 'bookshelf', at: { where: 'wall' } },
    { kind: 'table_lamp', at: { where: 'near', of: { kind: 'desk' }, side: 'on' } },
    { kind: 'plant', at: { where: 'corner' } },
    { kind: 'armchair', at: { where: 'corner' }, minLength: 3.5 },
    { kind: 'rug', at: { where: 'center' } },
    { kind: 'ceiling_light', at: { where: 'center' } }
  ],
  hall: [
    { kind: 'console_table', at: { where: 'wall' } },
    { kind: 'mirror', at: { where: 'near', of: { kind: 'console_table' }, side: 'on' } },
    { kind: 'runner', at: { where: 'center' } },
    { kind: 'coat_rack', at: { where: 'corner' } },
    { kind: 'ceiling_light', at: { where: 'center' } }
  ],
  closet: [
    { kind: 'wardrobe', at: { where: 'wall' } },
    { kind: 'shoe_rack', at: { where: 'wall' } },
    { kind: 'ceiling_light', at: { where: 'center' } }
  ],
  laundry: [
    { kind: 'washer', at: { where: 'wall' } },
    { kind: 'dryer', at: { where: 'near', of: { kind: 'washer' }, side: 'right', dist: 0.02 } },
    { kind: 'shelf', at: { where: 'near', of: { kind: 'washer' }, side: 'on' } },
    { kind: 'ceiling_light', at: { where: 'center' } }
  ],
  garage: [
    { kind: 'car', at: { where: 'center' }, minLength: 5 },
    { kind: 'box', count: 3, at: { where: 'corner' } },
    { kind: 'bicycle', at: { where: 'wall' } },
    { kind: 'ceiling_light', at: { where: 'center' } }
  ],
  balcony: [
    { kind: 'outdoor_chair', count: 2, at: { where: 'wall' } },
    { kind: 'side_table', at: { where: 'near', of: { kind: 'outdoor_chair' }, side: 'beside' } },
    { kind: 'planter', at: { where: 'wall' } }
  ],
  other: [
    { kind: 'armchair', at: { where: 'corner' } },
    { kind: 'side_table', at: { where: 'near', of: { kind: 'armchair' }, side: 'beside' } },
    { kind: 'plant', at: { where: 'corner' } },
    { kind: 'ceiling_light', at: { where: 'center' } }
  ]
}

/** Style words → a palette the furnish op and "make it X" can lean on. Deterministic, no model. */
export const STYLES: Record<string, { primary: string[], trim: string, walls: string, floor: { color: string, pattern: string } }> = {
  'mid-century': { primary: ['#c9742b', '#2f6a6a', '#b8a04a', '#8a5a3a'], trim: '#5a3a22', walls: '#efe6d6', floor: { color: '#9a6a44', pattern: 'plank' } },
  'scandinavian': { primary: ['#d9d4cc', '#aab7b0', '#c9c0b2', '#e8e2d8'], trim: '#c9b79a', walls: '#f6f3ee', floor: { color: '#d8c6a8', pattern: 'plank' } },
  'industrial': { primary: ['#4a4a4a', '#6b4a3a', '#2b2b2e', '#8a7a6a'], trim: '#1c1a18', walls: '#b8a999', floor: { color: '#8a8a86', pattern: 'concrete' } },
  'coastal': { primary: ['#dfe7ea', '#5a8aa8', '#c9c0b2', '#f4f1ea'], trim: '#e8e2d8', walls: '#eef3f5', floor: { color: '#d8cdb8', pattern: 'plank' } },
  'bohemian': { primary: ['#8c3b3b', '#c9742b', '#6a7a3a', '#b08968'], trim: '#5a3a22', walls: '#efe3cf', floor: { color: '#a67f5c', pattern: 'herringbone' } },
  'traditional': { primary: ['#5a3a3a', '#2f4a6a', '#8a6a4a', '#c9b79a'], trim: '#3b2618', walls: '#e4dccd', floor: { color: '#7a5a3a', pattern: 'herringbone' } },
  'minimalist': { primary: ['#e8e2d8', '#d9d9d6', '#c9c0b2', '#f4f4f2'], trim: '#b8b8b4', walls: '#f7f6f2', floor: { color: '#c9c3b8', pattern: 'concrete' } },
  'farmhouse': { primary: ['#eae6dd', '#8a6a4a', '#c9c0b2', '#5a6a7a'], trim: '#5a4030', walls: '#f1ede4', floor: { color: '#9a7a58', pattern: 'plank' } },
  'art deco': { primary: ['#1c3a3a', '#c9a24a', '#5a2b4a', '#2b2b2e'], trim: '#c9a24a', walls: '#2b3a3a', floor: { color: '#1c1a18', pattern: 'checker' } },
  'japandi': { primary: ['#c9b79a', '#5a5a52', '#d8d2c6', '#8a7a6a'], trim: '#3b3129', walls: '#f1ede4', floor: { color: '#c9b088', pattern: 'plank' } }
}

export function styleOf(word?: string): (typeof STYLES)[string] | null {
  if (!word) return null
  const w = word.toLowerCase()
  for (const [k, v] of Object.entries(STYLES)) if (w.includes(k) || w.includes(k.replace(/[\s-]/g, ''))) return v
  if (/scandi|nordic/.test(w)) return STYLES.scandinavian!
  if (/modern|contemporary/.test(w)) return STYLES['mid-century']!
  if (/beach|nautical|hamptons/.test(w)) return STYLES.coastal!
  if (/boho|eclectic|moroccan/.test(w)) return STYLES.bohemian!
  if (/classic|victorian|english/.test(w)) return STYLES.traditional!
  if (/loft|urban|warehouse/.test(w)) return STYLES.industrial!
  if (/rustic|cottage|country/.test(w)) return STYLES.farmhouse!
  if (/deco|gatsby|glam/.test(w)) return STYLES['art deco']!
  if (/zen|japanese|wabi/.test(w)) return STYLES.japandi!
  if (/minimal|clean|simple/.test(w)) return STYLES.minimalist!
  return null
}
