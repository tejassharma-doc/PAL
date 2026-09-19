/**
 * patch-manifest.js
 * Run this ONCE after `npx react-native init` generates the android project.
 *
 * Usage (from the mobile/ directory):
 *   node scripts/patch-manifest.js
 *
 * What it does:
 *   1. Adds RECORD_AUDIO permission for @react-native-voice/voice (STT)
 *   2. Ensures INTERNET permission is present (usually already there)
 *
 * react-native-tts uses the Android TTS engine (no extra permission needed).
 */

const fs = require('fs')
const path = require('path')

const MANIFEST = path.join(
  __dirname,
  '..',
  'android',
  'app',
  'src',
  'main',
  'AndroidManifest.xml',
)

if (!fs.existsSync(MANIFEST)) {
  console.error(
    '❌ AndroidManifest.xml not found at:\n   ' + MANIFEST +
    '\n\nGenerate the Android project first:\n' +
    '  npx @react-native-community/cli init PalTemp --skip-install\n' +
    '  cp -r PalTemp/android ../mobile/android\n' +
    '  rm -rf PalTemp\n',
  )
  process.exit(1)
}

let content = fs.readFileSync(MANIFEST, 'utf8')

const toAdd = [
  '<uses-permission android:name="android.permission.RECORD_AUDIO"/>',
  '<uses-permission android:name="android.permission.INTERNET"/>',
]

let changed = false
for (const permission of toAdd) {
  const name = permission.match(/android:name="([^"]+)"/)?.[1] ?? ''
  if (content.includes(name)) {
    console.log(`✓ Already present: ${name}`)
  } else {
    // Insert before </manifest>
    content = content.replace('</manifest>', permission + '\n</manifest>')
    console.log(`+ Added: ${name}`)
    changed = true
  }
}

if (changed) {
  fs.writeFileSync(MANIFEST, content, 'utf8')
  console.log('\n✅ AndroidManifest.xml patched.')
} else {
  console.log('\n✅ AndroidManifest.xml already up to date.')
}
