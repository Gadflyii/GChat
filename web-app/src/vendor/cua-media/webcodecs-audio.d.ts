// WebKit does not expose WebCodecs audio; the pinned SDK uses PCM there.
interface AudioData {
  readonly numberOfChannels: number
  readonly numberOfFrames: number
  readonly sampleRate: number
  copyTo(destination: Float32Array, options: { planeIndex: number; format: 'f32-planar' }): void
  close(): void
}
interface EncodedAudioChunkInit { type: 'key' | 'delta'; timestamp: number; data: BufferSource }
declare class EncodedAudioChunk { constructor(init: EncodedAudioChunkInit) }
declare class AudioDecoder {
  constructor(init: { output: (data: AudioData) => void; error: (error: DOMException) => void })
  configure(config: { codec: string; sampleRate: number; numberOfChannels: number }): void
  decode(chunk: EncodedAudioChunk): void
  close(): void
}
