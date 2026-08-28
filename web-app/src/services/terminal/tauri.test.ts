import { describe, expect, it } from 'vitest'
import {
  base64ToBytes,
  bytesToBase64,
  terminalBinaryStringToBytes,
} from './tauri'

describe('terminal byte transport', () => {
  it('round trips arbitrary PTY bytes through base64', () => {
    const input = new Uint8Array([0, 1, 27, 127, 128, 255])
    expect(base64ToBytes(bytesToBase64(input))).toEqual(input)
  })

  it('preserves xterm binary input code units as bytes', () => {
    expect(terminalBinaryStringToBytes(String.fromCharCode(0, 127, 255))).toEqual(
      new Uint8Array([0, 127, 255])
    )
  })
})
