const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config')

const defaultConfig = getDefaultConfig(__dirname)

const config = {
  resolver: {
    sourceExts: [...defaultConfig.resolver.sourceExts, 'mjs', 'cjs'],
  },
}

module.exports = mergeConfig(defaultConfig, config)
