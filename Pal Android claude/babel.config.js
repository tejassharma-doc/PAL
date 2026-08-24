module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [
    ['module-resolver', {
      root: ['./src'],
      extensions: ['.ts', '.tsx', '.js', '.jsx'],
      alias: {
        '@components': './src/components',
        '@screens': './src/screens',
        '@services': './src/services',
        '@lib': './src/lib',
        '@theme': './src/theme',
        '@navigation': './src/navigation',
      },
    }],
  ],
}
