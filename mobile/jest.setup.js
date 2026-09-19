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

// Mock AsyncStorage
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(null),
  removeItem: jest.fn().mockResolvedValue(null),
}))
