/**
 * The model aliases, in one place for the server (which calls them) and the client (which picks one for
 * sentences). Gateway pricing and alias resolution stay with the server in server/utils/aiModels.ts.
 */
export const MODELS = {
  haiku: 'anthropic/claude-haiku-5.5',
  sonnet: 'anthropic/claude-sonnet-5.5',
  opus: 'anthropic/claude-opus-5.5'
} as const

export type ModelAlias = keyof typeof MODELS

/** What the ⋯ menu offers for sentences: fast or careful. */
export const INTENT_MODELS = ['haiku', 'sonnet'] as const satisfies readonly ModelAlias[]
export type IntentModel = typeof INTENT_MODELS[number]

/** The intent model (sentence → ops): Haiku unless asked otherwise. */
export const INTENT_MODEL: IntentModel = 'haiku'
/** The plan reader (floor-plan image → FloorPlan): needs vision and care, so Sonnet. */
export const PLAN_MODEL: ModelAlias = 'sonnet'
