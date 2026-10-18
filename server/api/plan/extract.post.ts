/**
 * POST /api/plan/extract { image: dataURL, hint? } → ExtractResult as JSON, always status 200: the client
 * shows `reason` in the HUD rather than a generic 500. The client downsizes the image first (sprint D2);
 * the size checks here are the backstop. One wall-clock budget of 60 s covers both model paths.
 */
import { extractPlan } from '../../utils/planExtract'

interface Body {
  image?: unknown
  hint?: unknown
}

/** base64 of a 6 MB image plus the data-URL prefix. */
const MAX_IMAGE_CHARS = 8_500_000
const WALL_MS = 60_000

export default defineEventHandler(async (event) => {
  const body = await readBody<Body>(event).catch(() => ({} as Body))
  const image = typeof body?.image === 'string' ? body.image : ''
  if (!image) return { ok: false, reason: 'image is required (a data URL)' }
  if (image.length > MAX_IMAGE_CHARS) return { ok: false, reason: 'image is too large; the limit is 6 MB' }
  const hint = typeof body?.hint === 'string' ? body.hint.slice(0, 300) : undefined

  const config = useRuntimeConfig(event)
  if (!process.env.AI_GATEWAY_API_KEY && config.aiGatewayApiKey) process.env.AI_GATEWAY_API_KEY = config.aiGatewayApiKey
  if (!process.env.AI_GATEWAY_API_KEY) return { ok: false, reason: 'AI_GATEWAY_API_KEY is not set' }

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(new Error('timed out')), WALL_MS)
  event.node.req.on('close', () => ctrl.abort(new Error('client closed')))
  try {
    const res = await extractPlan({ image, hint, signal: ctrl.signal })
    console.info(`[plan] ${res.ok ? `${res.plan.rooms.length} rooms, ${res.plan.openings.length} openings via ${res.path}` : `failed: ${res.reason}`} · ${res.ms} ms · $${(res.costUsd ?? 0).toFixed(4)}`)
    if (!res.ok && ctrl.signal.aborted) return { ok: false, reason: 'timed out', ms: res.ms }
    return res
  } finally {
    clearTimeout(timer)
  }
})
