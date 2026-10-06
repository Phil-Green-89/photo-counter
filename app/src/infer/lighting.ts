import type { Gray } from './exemplar'

export type LightBucket = 'good' | 'dim' | 'poor'

export interface Lighting { mean: number; contrast: number; bucket: LightBucket }

/** Cheap lighting score logged with every photo so accuracy can be reported per lighting bucket. */
export function lightingScore(g: Gray): Lighting {
  const n = g.data.length
  let sum = 0
  for (const v of g.data) sum += v
  const mean = sum / n
  let varSum = 0
  for (const v of g.data) varSum += (v - mean) ** 2
  const contrast = Math.sqrt(varSum / n)
  const bucket: LightBucket = mean < 45 || contrast < 14 ? 'poor' : mean < 85 || contrast < 24 ? 'dim' : 'good'
  return { mean: Math.round(mean), contrast: Math.round(contrast), bucket }
}
