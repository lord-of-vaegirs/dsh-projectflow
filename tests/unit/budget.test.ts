import { describe, expect, it } from 'vitest'
import { estimateTokens } from '../../src/injection/token-estimate.js'
import { renderProjectContext } from '../../src/injection/render.js'

function snapshot(overrides: Partial<Parameters<typeof renderProjectContext>[0]> = {}) {
  return {
    project: {
      schemaVersion: 1 as const,
      id: 'prj_00000000000000000000000000000000',
      name: 'Budget',
      aliases: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      archived: false,
      primaryPath: '/tmp/budget',
    },
    conventions: Array.from({ length: 30 }, (_, index) => `Convention ${index} ` + 'x'.repeat(80)),
    decisions: [{
      id: 'ADR-0001',
      status: 'accepted',
      decision: 'A decision ' + 'y'.repeat(200),
      context: 'Context',
      consequences: 'Consequences',
    }],
    progress: Array.from({ length: 5 }, (_, index) => ({
      ts: `2026-01-0${index + 1}T00:00:00.000Z`,
      sessionId: 's',
      stage: 'M1',
      did: 'Did ' + 'z'.repeat(100),
      next: 'Next',
      tags: [],
    })),
    dirs: [],
    tools: [],
    members: [],
    archivedCounts: { memory: 0, conventions: 0, decisions: 0 },
    ...overrides,
  }
}

describe('context budget', () => {
  it('never exceeds the hard budget', () => {
    for (const budget of [200, 400, 800]) {
      const result = renderProjectContext(snapshot(), budget)
      expect(result.estimatedTokens).toBeLessThanOrEqual(budget)
      expect(result.truncated).toBe(true)
    }
  })

  it('keeps the header and progress when the budget is tight', () => {
    const result = renderProjectContext(snapshot(), 200)
    expect(result.text).toContain('PROJECTFLOW')
    expect(estimateTokens(result.text)).toBeLessThanOrEqual(200)
  })

  it('renders CJK within budget', () => {
    const result = renderProjectContext(snapshot({
      conventions: Array.from({ length: 20 }, (_, index) => `约定${index}：` + '必须遵守'.repeat(20)),
    }), 300)
    expect(result.estimatedTokens).toBeLessThanOrEqual(300)
  })
})
