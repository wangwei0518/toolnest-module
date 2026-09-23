import { StringDecoder } from 'node:string_decoder'

/** Decodes UTF-8 output without losing characters split across stream chunks. */
export class Utf8StreamDecoder {
  private readonly decoder = new StringDecoder('utf8')

  write(chunk: Buffer): string {
    return this.decoder.write(chunk)
  }

  end(): string {
    return this.decoder.end()
  }
}

/** Returns the longest prefix that fits the byte limit without splitting a character. */
export function takeUtf8Prefix(value: string, maxBytes: number): string {
  if (maxBytes <= 0) return ''
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) return value

  let result = ''
  let bytes = 0
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character, 'utf8')
    if (bytes + characterBytes > maxBytes) break
    result += character
    bytes += characterBytes
  }
  return result
}
