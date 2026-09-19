const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config')

const defaultConfig = getDefaultConfig(__dirname)

const config = {
  resolver: {
    // Allow .onnx model assets to be bundled
    assetExts: [...defaultConfig.resolver.assetExts, 'onnx'],
  },
}

module.exports = mergeConfig(defaultConfig, config)
