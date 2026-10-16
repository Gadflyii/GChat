import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MediaSession } from './mediaSession'

const aspects = [
  {
    name: 'wide desktop with horizontal bars',
    width: 1920,
    height: 1080,
    quarter: { clientX: 260, clientY: 200 },
    threeQuarters: { clientX: 580, clientY: 380 },
    bars: [{ clientX: 260, clientY: 80 }, { clientX: 580, clientY: 500 }],
    drag: { clientX: 900, clientY: 80 },
    dragPosition: { x_normalized: 1, y_normalized: 0 },
    release: { clientX: 50, clientY: 600 },
    releasePosition: { x_normalized: 0, y_normalized: 1 },
  },
  {
    name: 'portrait desktop with vertical bars',
    width: 960,
    height: 1920,
    quarter: { clientX: 360, clientY: 170 },
    threeQuarters: { clientX: 480, clientY: 410 },
    bars: [{ clientX: 200, clientY: 170 }, { clientX: 600, clientY: 410 }],
    drag: { clientX: 200, clientY: 650 },
    dragPosition: { x_normalized: 0, y_normalized: 1 },
    release: { clientX: 900, clientY: 20 },
    releasePosition: { x_normalized: 1, y_normalized: 0 },
  },
]

const sessions: MediaSession[] = []

function fixture(width = 1920, height = 1080, interactive = true) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  document.body.append(canvas)
  const bounds = vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 50, 640, 480))
  const focus = vi.spyOn(canvas, 'focus')
  const captured = new Set<number>()
  const setPointerCapture = vi.fn((pointerId: number) => captured.add(pointerId))
  const releasePointerCapture = vi.fn((pointerId: number) => captured.delete(pointerId))
  Object.defineProperties(canvas, {
    setPointerCapture: { value: setPointerCapture },
    releasePointerCapture: { value: releasePointerCapture },
    hasPointerCapture: { value: (pointerId: number) => captured.has(pointerId) },
  })
  const session = new MediaSession({
    canvas,
    ticket: { wsUrl: 'ws://localhost/unused' },
    interactive,
    audio: false,
  })
  sessions.push(session)
  const queueInput = vi.spyOn(session, 'queueInput').mockImplementation(() => {})
  const pointer = (type: string, init: MouseEventInit = {}, pointerId = 7) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, ...init })
    Object.defineProperty(event, 'pointerId', { value: pointerId })
    canvas.dispatchEvent(event)
    return event
  }
  const wheel = (init: WheelEventInit) => {
    const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init })
    canvas.dispatchEvent(event)
    return event
  }
  return { canvas, session, bounds, focus, captured, setPointerCapture, releasePointerCapture, queueInput, pointer, wheel }
}

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  let now = 100
  vi.spyOn(performance, 'now').mockImplementation(() => (now += 20))
})

afterEach(() => {
  for (const session of sessions.splice(0)) session.stop()
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('MediaSession contained desktop input', () => {
  it.each(aspects)('maps an accepted click to the painted $name', ({ width, height, quarter }) => {
    const f = fixture(width, height)
    const down = f.pointer('pointerdown', { ...quarter, button: 2, ctrlKey: true })
    f.pointer('pointerup', { ...quarter, button: 2, ctrlKey: true })
    f.pointer('lostpointercapture')
    expect(down.defaultPrevented).toBe(true)
    expect(f.focus).toHaveBeenCalledOnce()
    expect(f.setPointerCapture).toHaveBeenCalledExactlyOnceWith(7)
    expect(f.releasePointerCapture).toHaveBeenCalledExactlyOnceWith(7)
    expect(f.queueInput.mock.calls).toEqual([
      [{ kind: 'pointer', phase: 'down', button: 'right', x_normalized: 0.25, y_normalized: 0.25, modifiers: ['control'] }],
      [{ kind: 'pointer', phase: 'up', button: 'right', x_normalized: 0.25, y_normalized: 0.25, modifiers: ['control'] }],
    ])
  })

  it.each(aspects)('ignores bar clicks, hover and scrolling over the $name', ({ width, height, bars, quarter }) => {
    const f = fixture(width, height)
    for (const bar of bars) {
      expect(f.pointer('pointerdown', bar).defaultPrevented).toBe(false)
      f.pointer('pointermove', bar)
      expect(f.wheel({ ...bar, deltaY: 100 }).defaultPrevented).toBe(false)
      f.pointer('pointerup', quarter)
    }
    f.pointer('pointerdown', { clientX: 50, clientY: 600 })
    f.pointer('pointerup', quarter)
    expect(f.queueInput).not.toHaveBeenCalled()
    expect(f.focus).not.toHaveBeenCalled()
    expect(f.setPointerCapture).not.toHaveBeenCalled()
    expect(f.releasePointerCapture).not.toHaveBeenCalled()
  })

  it.each(aspects)('maps hover and wheel position inside the $name', ({ width, height, threeQuarters }) => {
    const f = fixture(width, height)
    f.pointer('pointermove', threeQuarters)
    const scroll = f.wheel({ ...threeQuarters, deltaX: 12, deltaY: -24, deltaMode: 0 })
    expect(scroll.defaultPrevented).toBe(true)
    expect(f.queueInput.mock.calls).toEqual([
      [{ kind: 'pointer', phase: 'move', button: null, x_normalized: 0.75, y_normalized: 0.75, modifiers: [] }],
      [{ kind: 'scroll', x_normalized: 0.75, y_normalized: 0.75, delta_x: 12, delta_y: -24, phase: 'none', momentum_phase: 'none', precise: true }],
    ])
    expect(f.setPointerCapture).not.toHaveBeenCalled()
  })

  it.each(aspects)('keeps an accepted drag and clamps its release outside the $name', ({ width, height, quarter, drag, dragPosition, release, releasePosition }) => {
    const f = fixture(width, height)
    f.pointer('pointerdown', quarter)
    f.pointer('pointermove', drag)
    f.pointer('pointerup', release)
    expect(f.queueInput.mock.calls).toEqual([
      [{ kind: 'pointer', phase: 'down', button: 'left', x_normalized: 0.25, y_normalized: 0.25, modifiers: [] }],
      [{ kind: 'pointer', phase: 'move', button: null, ...dragPosition, modifiers: [] }],
      [{ kind: 'pointer', phase: 'up', button: 'left', ...releasePosition, modifiers: [] }],
    ])
    expect(f.releasePointerCapture).toHaveBeenCalledExactlyOnceWith(7)
  })

  it.each(['pointercancel', 'lostpointercapture'])('releases once at the last valid position on %s', (type) => {
    const f = fixture()
    f.pointer('pointerdown', aspects[0].quarter)
    f.pointer('pointermove', aspects[0].threeQuarters)
    f.pointer(type)
    f.pointer('lostpointercapture')
    f.pointer('pointerup', aspects[0].quarter)
    expect(f.queueInput).toHaveBeenCalledTimes(3)
    expect(f.queueInput).toHaveBeenLastCalledWith({
      kind: 'pointer', phase: 'up', button: 'left', x_normalized: 0.75, y_normalized: 0.75, modifiers: [],
    })
    expect(f.releasePointerCapture).toHaveBeenCalledExactlyOnceWith(7)
  })

  it('does not release another pointer or accept its movement through a bar', () => {
    const f = fixture()
    f.pointer('pointerdown', aspects[0].quarter)
    f.pointer('pointermove', aspects[0].bars[0], 8)
    f.pointer('pointerup', aspects[0].quarter, 8)
    expect(f.queueInput).toHaveBeenCalledOnce()
    expect(f.releasePointerCapture).not.toHaveBeenCalled()
    f.pointer('pointerup', aspects[0].quarter)
    expect(f.queueInput).toHaveBeenCalledTimes(2)
  })

  it('uses the current painted rectangle after resizing during a drag', () => {
    const f = fixture()
    f.pointer('pointerdown', aspects[0].quarter)
    f.bounds.mockReturnValue(new DOMRect(100, 50, 320, 240))
    f.pointer('pointermove', { clientX: 340, clientY: 215 })
    f.pointer('pointerup', { clientX: 180, clientY: 80 })
    expect(f.queueInput).toHaveBeenNthCalledWith(2, {
      kind: 'pointer', phase: 'move', button: null, x_normalized: 0.75, y_normalized: 0.75, modifiers: [],
    })
    expect(f.queueInput).toHaveBeenLastCalledWith({
      kind: 'pointer', phase: 'up', button: 'left', x_normalized: 0.25, y_normalized: 0, modifiers: [],
    })
  })

  it('releases at the last valid position if the canvas becomes unmeasurable', () => {
    const f = fixture()
    f.pointer('pointerdown', aspects[0].quarter)
    f.bounds.mockReturnValue(new DOMRect(100, 50, 0, 0))
    f.pointer('pointermove', { clientX: 900, clientY: 900 })
    f.pointer('pointerup', { clientX: 900, clientY: 900 })
    expect(f.queueInput).toHaveBeenCalledTimes(2)
    expect(f.queueInput).toHaveBeenLastCalledWith({
      kind: 'pointer', phase: 'up', button: 'left', x_normalized: 0.25, y_normalized: 0.25, modifiers: [],
    })
    expect(f.releasePointerCapture).toHaveBeenCalledExactlyOnceWith(7)
  })

  it('does not enqueue a down or unmatched up when pointer capture fails', () => {
    const f = fixture()
    f.setPointerCapture.mockImplementation(() => { throw new DOMException('Capture failed') })
    f.pointer('pointerdown', aspects[0].quarter)
    f.pointer('pointerup', aspects[0].quarter)
    expect(f.queueInput).not.toHaveBeenCalled()
  })

  it('keeps a view-only canvas free of pointer, wheel and keyboard input', () => {
    const f = fixture(1920, 1080, false)
    f.pointer('pointerdown', aspects[0].quarter)
    f.pointer('pointermove', aspects[0].threeQuarters)
    f.pointer('pointerup', aspects[0].quarter)
    f.wheel({ ...aspects[0].quarter, deltaY: 50 })
    f.canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }))
    expect(f.queueInput).not.toHaveBeenCalled()
    expect(f.focus).not.toHaveBeenCalled()
    expect(f.setPointerCapture).not.toHaveBeenCalled()
  })

  it('detaches handlers and releases capture when stopped without new input', () => {
    const f = fixture()
    f.pointer('pointerdown', aspects[0].quarter)
    f.session.stop()
    f.pointer('pointermove', aspects[0].threeQuarters)
    f.pointer('pointerup', aspects[0].threeQuarters)
    f.wheel({ ...aspects[0].quarter, deltaY: 50 })
    expect(f.queueInput).toHaveBeenCalledOnce()
    expect(f.releasePointerCapture).toHaveBeenCalledExactlyOnceWith(7)
  })
})
