import { describe, expect, it } from 'vitest'

import { parseGChatDeepLink } from './parse'

describe('parseGChatDeepLink', () => {
  it('parses a Hugging Face model deeplink', () => {
    expect(
      parseGChatDeepLink(
        'gchat://models/huggingface/owner/model-GGUF'
      )
    ).toEqual({
      provider: 'huggingface',
      repo: 'owner/model-GGUF',
      modelId: 'owner/model-GGUF',
    })
  })

  it('rejects non GChat schemes', () => {
    expect(
      parseGChatDeepLink('janai://models/huggingface/owner/model-GGUF')
    ).toBeNull()
  })

  it('rejects incomplete Hugging Face paths', () => {
    expect(
      parseGChatDeepLink('gchat://models/huggingface/owner')
    ).toBeNull()
  })
})
