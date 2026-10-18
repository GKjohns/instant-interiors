/**
 * Alias → gateway id, and gateway pricing for cost reports. Plain module with no Nitro globals, so scripts
 * import it too. The aliases themselves live in shared/models.ts.
 */
import { INTENT_MODEL, MODELS } from '../../shared/models.ts'
import type { ModelAlias } from '../../shared/models.ts'

export function resolveModel(name: string | undefined, fallback: ModelAlias = INTENT_MODEL): { alias: string, id: string } {
  if (name && name in MODELS) return { alias: name, id: MODELS[name as ModelAlias] }
  if (name && name.includes('/')) return { alias: name.split('/').pop() ?? name, id: name }
  return { alias: fallback, id: MODELS[fallback] }
}

/** USD per 1M tokens, from the gateway's /v1/models (base tier), as recorded 2026-10-11. */
const PRICING: Record<string, { input: number, output: number, cacheRead?: number, cacheWrite?: number }> = {
  'anthropic/claude-opus-5.5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  'anthropic/claude-sonnet-5.5': { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  'anthropic/claude-haiku-5.5': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 }
}

export interface Usage { input: number, output: number, cacheRead?: number, cacheWrite?: number }

export function costUsd(modelId: string, usage: Usage): number {
  const p = PRICING[modelId]
  if (!p) return 0
  const read = usage.cacheRead ?? 0
  const write = usage.cacheWrite ?? 0
  const plain = Math.max(0, usage.input - read - write)
  return (plain * p.input + read * (p.cacheRead ?? p.input) + write * (p.cacheWrite ?? p.input) + usage.output * p.output) / 1_000_000
}
