const path = require('path')

// next-pwa: installed via `npm install next-pwa`. Falls back to identity function
// if not yet installed so the dev server still starts without it.
let withPWA
try {
  withPWA = require('next-pwa')({
    dest: 'public',
    disable: process.env.NODE_ENV === 'development',
    register: true,
    skipWaiting: true,
    // Don't cache API routes or auth endpoints in the service worker
    runtimeCaching: [],
  })
} catch {
  withPWA = (c) => c
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000',
    NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME || 'PAL',
  },
  // @huggingface/transformers: keep onnxruntime-node server-only, out of browser bundle
  serverExternalPackages: ['sharp', 'onnxruntime-node'],
  webpack: (config, { webpack }) => {
    // WASM redirect: ORT web dist bundles the actual .wasm files
    const ortWebDist = path.resolve('./node_modules/onnxruntime-web/dist')
    config.plugins.push(
      new webpack.NormalModuleReplacementPlugin(
        /ort-wasm-simd-threaded\.asyncify\.wasm$/,
        resource => { resource.request = path.join(ortWebDist, 'ort-wasm-simd-threaded.asyncify.wasm') },
      ),
      new webpack.NormalModuleReplacementPlugin(
        /ort\.webgpu\.bundle\.min\.mjs$/,
        resource => { resource.request = path.join(ortWebDist, 'ort.wasm.bundle.min.mjs') },
      ),
    )
    // Required for webpack to process .wasm files as async modules
    config.experiments = { ...config.experiments, asyncWebAssembly: true, layers: true }
    return config
  },
  // Cross-origin isolation — required for WebGPU SharedArrayBuffer in Web Workers
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Embedder-Policy', value: 'require-corp' },
        ],
      },
    ]
  },
}

module.exports = withPWA(nextConfig)
