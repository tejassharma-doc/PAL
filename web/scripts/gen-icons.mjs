/**
 * Generate PWA icons from icon.svg using sharp.
 * Run once after adding/updating the SVG:
 *   npm install sharp --save-dev   (if not already installed)
 *   node scripts/gen-icons.mjs
 */

import sharp from 'sharp'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const publicDir = join(__dirname, '..', 'public')
const svgPath = join(publicDir, 'icon.svg')

const svg = readFileSync(svgPath)

const sizes = [
  { name: 'icon-192.png',          size: 192 },
  { name: 'icon-512.png',          size: 512 },
  { name: 'apple-touch-icon.png',  size: 180 },
]

for (const { name, size } of sizes) {
  const outPath = join(publicDir, name)
  await sharp(svg)
    .resize(size, size)
    .png()
    .toFile(outPath)
  console.log(`  ✓ ${name} (${size}×${size})`)
}

console.log('\nAll icons generated. Commit web/public/ to version control.')
