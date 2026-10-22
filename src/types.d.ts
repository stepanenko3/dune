// three r128 не має типів для декодера meshopt — декларуємо те, чим користуємось (GLTFLoader.setMeshoptDecoder)
declare module 'three/examples/jsm/libs/meshopt_decoder.module.js' {
  export const MeshoptDecoder: { supported: boolean; ready: Promise<void>; decodeVertexBuffer: unknown; decodeIndexBuffer: unknown; decodeIndexSequence: unknown; decodeGltfBuffer: unknown }
}
