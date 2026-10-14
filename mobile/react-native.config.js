// Native linking overrides.
// onnxruntime-react-native: not linked on Android. Its JSI helper is not
// compatible with the New Architecture and no model is bundled yet, so the
// app uses the pure-JS keyword classifier. Removing it also cuts ~40 MB of
// native libraries from the APK. Remove this entry when an ONNX model ships.
module.exports = {
  dependencies: {
    'onnxruntime-react-native': { platforms: { android: null, ios: null } },
  },
}
