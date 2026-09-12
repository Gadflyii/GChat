import { expect, it } from 'vitest'
import { DefaultModelsService } from '../models/default'
import type { HuggingFaceRepo } from '../models/types'

it('offers only self-contained GInfer artifacts, without GGUF or MLX companions', () => {
  const repo = {
    modelId: 'SectileLabs/Muse', author: 'SectileLabs',
    siblings: [
      { rfilename: 'muse.ginfer', size: 2 * 1024 ** 3, lfs: { sha256: 'a'.repeat(64) } },
      { rfilename: 'model.gguf' }, { rfilename: 'mmproj.gguf' },
      { rfilename: 'model.safetensors' }, { rfilename: 'tokenizer.json' },
    ],
  } as HuggingFaceRepo
  const catalog = new DefaultModelsService().convertHfRepoToCatalogModel(repo)
  expect(catalog.quants).toEqual([{
    model_id: 'muse', path: 'https://huggingface.co/SectileLabs/Muse/resolve/main/muse.ginfer',
    file_size: '2.0 GB', sha256: 'a'.repeat(64),
  }])
  expect(catalog.num_quants).toBe(1)
  expect(catalog.mmproj_models).toEqual([])
  expect(new DefaultModelsService().convertHfRepoToCatalogModel({ ...repo, siblings: undefined }).quants).toEqual([])
})
