import { describe, expect, it } from 'vitest'
import { lightingScore } from './lighting'
import { discs, grid } from './testutil'

describe('lightingScore', () => {
  const centers = grid(6, 4)
  it('rates a normal photo good', () => {
    expect(lightingScore(discs(280, 190, centers, 14, 1.4)).bucket).toBe('good')
  })
  it('rates a dim photo dim', () => {
    expect(lightingScore(discs(280, 190, centers, 14, 0.8)).bucket).toBe('dim')
  })
  it('rates a very dark photo poor', () => {
    expect(lightingScore(discs(280, 190, centers, 14, 0.3)).bucket).toBe('poor')
  })
})
