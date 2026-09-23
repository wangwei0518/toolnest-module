import { describe, expect, it } from 'vitest'
import { takeUtf8Prefix, Utf8StreamDecoder } from '../src/utf8-stream.js'

describe('Utf8StreamDecoder', () => {
  it('preserves Chinese text when UTF-8 characters are split across chunks', () => {
    const expected = '前一交易日收盘，Nasdaq-100 指数上涨。'
    const input = Buffer.from(expected, 'utf8')
    const decoder = new Utf8StreamDecoder()
    let actual = ''

    for (let offset = 0; offset < input.length; offset += 1) {
      actual += decoder.write(input.subarray(offset, offset + 1))
    }
    actual += decoder.end()

    expect(actual).toBe(expected)
  })

  it('does not cut a UTF-8 character at an output byte limit', () => {
    expect(takeUtf8Prefix('A中😀B', 5)).toBe('A中')
    expect(Buffer.byteLength(takeUtf8Prefix('A中😀B', 5), 'utf8')).toBeLessThanOrEqual(5)
  })
})
