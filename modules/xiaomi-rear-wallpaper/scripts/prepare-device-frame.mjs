import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const moduleRoot = new URL('../', import.meta.url)
const require = createRequire(new URL('backend/package.json', moduleRoot))
const sharp = require('sharp')
const profileBuild = await build({
  entryPoints: [fileURLToPath(new URL('frontend/src/lib/device-profile.ts', moduleRoot))],
  bundle: true, write: false, format: 'esm', platform: 'node',
})
const { deviceProfile } = await import(`data:text/javascript;base64,${Buffer.from(profileBuild.outputFiles[0].text).toString('base64')}`)
const { width, height, display } = deviceProfile.reference
const source = new URL('frontend/assets/xiaomi-rear-display-reference.png', moduleRoot)
const destination = new URL('frontend/src/assets/xiaomi-rear-display-frame.png', moduleRoot)
const { data: pixels, info } = await sharp(await readFile(source)).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
if (info.width !== width || info.height !== height) throw new Error('设备示意图尺寸与 device-profile 不一致')

// Apply the existing connected-white mask once, preserving the camera and body pixels.
const queue = new Uint32Array(width * height)
const xMin = Math.max(0, display.left - 28)
const xMax = Math.min(width - 1, display.left + display.width + 28)
const yMin = Math.max(0, display.top - 28)
const yMax = Math.min(height - 1, display.top + display.height + 30)
let read = 0
let write = 0
function enqueue(x, y) {
  if (x < xMin || x > xMax || y < yMin || y > yMax) return
  const index = (y * width + x) * 4
  if (pixels[index + 3] === 0) return
  const [red, green, blue] = pixels.subarray(index, index + 3)
  if (Math.min(red, green, blue) < 185 || Math.max(red, green, blue) - Math.min(red, green, blue) > 24) return
  pixels[index + 3] = 0
  queue[write++] = y * width + x
}
enqueue(Math.round(display.left + display.width / 2), display.top + 32)
while (read < write) {
  const pixel = queue[read++]
  const x = pixel % width
  const y = Math.floor(pixel / width)
  enqueue(x - 1, y)
  enqueue(x + 1, y)
  enqueue(x, y - 1)
  enqueue(x, y + 1)
}
await mkdir(new URL('frontend/src/assets/', moduleRoot), { recursive: true })
const frame = await sharp(pixels, { raw: { width, height, channels: 4 } }).png({ compressionLevel: 9 }).toBuffer()
await writeFile(destination, frame)
console.log(`设备遮罩已生成：${width} × ${height}，${frame.length} bytes，透明化 ${write} 个像素`)
