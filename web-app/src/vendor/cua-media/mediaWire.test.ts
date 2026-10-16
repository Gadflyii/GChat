import { describe, expect, it } from 'vitest'
import { normalizeContainedPoint, normalizePoint } from './mediaWire'

const rect = { left: 100, top: 50, width: 640, height: 480 }

describe('normalizeContainedPoint', () => {
  it.each([
    {
      name: 'wide desktop with top and bottom bars',
      content: { width: 1920, height: 1080 },
      first: [100, 110],
      quarter: [260, 200],
      last: [740, 470],
      bars: [[260, 80], [580, 500]],
      clamped: [{ x_normalized: 0.25, y_normalized: 0 }, { x_normalized: 0.75, y_normalized: 1 }],
    },
    {
      name: 'portrait desktop with left and right bars',
      content: { width: 1080, height: 1920 },
      first: [285, 50],
      quarter: [352.5, 170],
      last: [555, 530],
      bars: [[200, 170], [600, 410]],
      clamped: [{ x_normalized: 0, y_normalized: 0.25 }, { x_normalized: 1, y_normalized: 0.75 }],
    },
  ])('maps painted pixels and excludes bars for $name', ({ content, first, quarter, last, bars, clamped }) => {
    expect(normalizeContainedPoint(first[0], first[1], rect, content)).toEqual({ x_normalized: 0, y_normalized: 0 })
    expect(normalizeContainedPoint(quarter[0], quarter[1], rect, content)).toEqual({ x_normalized: 0.25, y_normalized: 0.25 })
    expect(normalizeContainedPoint(last[0], last[1], rect, content)).toEqual({ x_normalized: 1, y_normalized: 1 })
    bars.forEach(([x, y], index) => {
      expect(normalizeContainedPoint(x, y, rect, content)).toBeNull()
      expect(normalizeContainedPoint(x, y, rect, content, true)).toEqual(clamped[index])
    })
    expect(normalizeContainedPoint(50, 600, rect, content)).toBeNull()
    expect(normalizeContainedPoint(50, 600, rect, content, true)).toEqual({ x_normalized: 0, y_normalized: 1 })
  })

  it('maps a matching aspect ratio without inventing bars', () => {
    expect(normalizeContainedPoint(260, 410, rect, { width: 1280, height: 960 })).toEqual({
      x_normalized: 0.25,
      y_normalized: 0.75,
    })
  })

  it.each([0, -1, NaN, Infinity])('rejects unusable dimensions (%s), even for a captured drag', (value) => {
    const content = { width: 1920, height: 1080 }
    for (const clampOutside of [false, true]) {
      expect(normalizeContainedPoint(260, 200, { ...rect, width: value }, content, clampOutside)).toBeNull()
      expect(normalizeContainedPoint(260, 200, { ...rect, height: value }, content, clampOutside)).toBeNull()
      expect(normalizeContainedPoint(260, 200, rect, { ...content, width: value }, clampOutside)).toBeNull()
      expect(normalizeContainedPoint(260, 200, rect, { ...content, height: value }, clampOutside)).toBeNull()
    }
  })

  it.each([NaN, Infinity, -Infinity])('rejects nonfinite client positions and offsets (%s)', (value) => {
    const content = { width: 1920, height: 1080 }
    for (const clampOutside of [false, true]) {
      expect(normalizeContainedPoint(value, 200, rect, content, clampOutside)).toBeNull()
      expect(normalizeContainedPoint(260, value, rect, content, clampOutside)).toBeNull()
      expect(normalizeContainedPoint(260, 200, { ...rect, left: value }, content, clampOutside)).toBeNull()
      expect(normalizeContainedPoint(260, 200, { ...rect, top: value }, content, clampOutside)).toBeNull()
    }
  })

  it('leaves the existing full-rectangle normalization contract unchanged', () => {
    expect(normalizePoint(260, 80, rect)).toEqual({ x_normalized: 0.25, y_normalized: 0.0625 })
    expect(normalizePoint(50, 600, rect)).toEqual({ x_normalized: 0, y_normalized: 1 })
  })
})
