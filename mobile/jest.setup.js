// Mock onnxruntime-react-native for Jest (native module — not available in Node test env)
jest.mock('onnxruntime-react-native', () => ({
  InferenceSession: {
    create: jest.fn().mockResolvedValue({
      run: jest.fn().mockResolvedValue({
        embeddings: { data: new Float32Array(384), dims: [1, 384] },
      }),
    }),
  },
  Tensor: jest.fn().mockImplementation((type, data, dims) => ({ type, data, dims })),
}))

// AsyncStorage: the library's in-memory mock (keeps values between calls, so
// login sessions persist inside a test).
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
)

// Safe-area: library-provided mock with fixed insets.
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default)

// Document picker: tests set global.__PICKED_FILE__ to control what is "picked".
jest.mock('@react-native-documents/picker', () => ({
  pick: jest.fn(async () => {
    if (!global.__PICKED_FILE__) {
      const e = new Error('cancelled')
      e.code = 'OPERATION_CANCELED'
      throw e
    }
    return [global.__PICKED_FILE__]
  }),
  types: { pdf: 'application/pdf', images: 'image/*' },
  errorCodes: { OPERATION_CANCELED: 'OPERATION_CANCELED' },
  isErrorWithCode: e => !!(e && e.code),
}))

// Text-to-speech / voice native modules are not used by phase-1 screens.
jest.mock('react-native-tts', () => ({ speak: jest.fn(), stop: jest.fn(), addEventListener: jest.fn() }))
jest.mock('@react-native-voice/voice', () => ({ start: jest.fn(), stop: jest.fn(), destroy: jest.fn() }))

// Use React Native's FormData (as on a device) instead of Node's, so file parts
// are {uri, name, type} exactly like the Android runtime sends them.
const RNFormData = require('react-native/Libraries/Network/FormData')
global.FormData = RNFormData.default ?? RNFormData

// Device parity: on a phone, a bare string inside a <View> (e.g. `{count && <X/>}`
// with count = 0, or stray text) throws "Text strings must be rendered within a
// <Text> component" and crashes a release build. The Jest renderer does not
// check this, so enforce it here for View (which Pressable/Touchable use too).
jest.mock('react-native/Libraries/Components/View/View', () => {
  const React = require('react')
  const mockComponent = jest.requireActual('react-native/jest/mockComponent')
  const MockNativeMethods = jest.requireActual('react-native/jest/MockNativeMethods')
  const M = mockComponent('react-native/Libraries/Components/View/View', MockNativeMethods)
  const RealView = M.default ?? M
  const check = children =>
    React.Children.forEach(children, c => {
      if ((typeof c === 'string' && c !== '') || typeof c === 'number') {
        throw new Error(`Text strings must be rendered within a <Text> component. Found: ${JSON.stringify(c)}`)
      }
      if (c && c.type === React.Fragment) check(c.props.children)
    })
  const StrictView = React.forwardRef((props, ref) => {
    check(props.children)
    return React.createElement(RealView, { ...props, ref })
  })
  StrictView.displayName = 'View'
  return StrictView
})
