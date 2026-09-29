import { describe, expect, it } from 'vitest'
import { withServerSampling } from '@/lib/predefinedParams'

const builtIn = { temperature: 0.7, top_k: 20, top_p: 0.8, repeat_penalty: 1.12, stream: true }

describe('withServerSampling', () => {
  it('leaves GInfer sampling to the served model unless the user tuned it', () => {
    expect(withServerSampling('ginfer', builtIn, false)).toEqual({ stream: true })
    expect(withServerSampling('GInfer', { min_p: 0.1, presence_penalty: 1, frequency_penalty: 0.2 }, false)).toEqual({})
  })

  it('sends tuned sampling to GInfer and never touches other providers', () => {
    expect(withServerSampling('ginfer', builtIn, true)).toEqual(builtIn)
    expect(withServerSampling('llamacpp', builtIn, false)).toEqual(builtIn)
    expect(withServerSampling(undefined, builtIn, false)).toEqual(builtIn)
  })
})
