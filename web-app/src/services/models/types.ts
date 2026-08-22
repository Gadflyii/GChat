/**
 * Models Service Types
 */

import {
  SessionInfo,
  modelInfo,
  ThreadMessage,
  UnloadResult,
} from '@gchat/core'
import { Model as CoreModel } from '@gchat/core'

// Types for model catalog
export interface ModelQuant {
  model_id: string
  path: string
  file_size: string
}

export interface MMProjModel {
  model_id: string
  path: string
  file_size: string
}

export interface SafetensorsFile {
  model_id: string
  path: string
  file_size: string
  sha256?: string
}

export interface CatalogModel {
  model_name: string
  /**
   * Curated display name for the entry. `model_name` carries the HuggingFace
   * repo id, which doubles as the download identity; this field is purely
   * cosmetic and the Hub falls back to deriving a name from `model_name`
   * when it is absent.
   */
  name?: string
  description: string
  library_name?: string
  developer?: string
  downloads: number
  likes?: number
  num_quants?: number
  quants?: ModelQuant[]
  mmproj_models?: MMProjModel[]
  num_mmproj?: number
  safetensors_files?: SafetensorsFile[]
  num_safetensors?: number
  created_at?: string
  last_modified?: string
  readme?: string
  tools?: boolean
  is_mlx?: boolean
}

export type ModelCatalog = CatalogModel[]

// HuggingFace repository information
export interface HuggingFaceRepo {
  id: string
  modelId: string
  sha: string
  downloads: number
  likes: number
  library_name?: string
  tags: string[]
  pipeline_tag?: string
  createdAt: string
  last_modified: string
  private: boolean
  disabled: boolean
  gated: boolean | string
  author: string
  cardData?: {
    license?: string
    language?: string[]
    datasets?: string[]
    metrics?: string[]
  }
  siblings?: Array<{
    rfilename: string
    size?: number
    blobId?: string
    lfs?: {
      sha256: string
      size: number
      pointerSize: number
    }
  }>
  readme?: string
}

export interface GgufMetadata {
  version: number
  tensor_count: number
  metadata: Record<string, string>
}

export interface ModelValidationResult {
  isValid: boolean
  error?: string
  metadata?: GgufMetadata
}

export type PreflightReason =
  | 'AUTH_REQUIRED'
  | 'LICENSE_NOT_ACCEPTED'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'NETWORK'
  | 'UNKNOWN'

export interface ModelsService {
  getModel(modelId: string): Promise<modelInfo | undefined>
  fetchModels(): Promise<modelInfo[]>
  fetchModelCatalog(): Promise<ModelCatalog>
  fetchHuggingFaceRepo(
    repoId: string,
    hfToken?: string
  ): Promise<HuggingFaceRepo | null>
  /**
   * Long-tail fallback: query HF for the top-N candidates matching a free
   * text term, scored via the same heuristic used by `fetchHuggingFaceRepo`.
   * Returns lightweight `CatalogModel`-shaped entries (no per-repo detail
   * fetch) so the Hub UI can render a "From Hugging Face" section without
   * paying the cost of N follow-up requests. Callers should drill into
   * `fetchHuggingFaceRepo` only when the user actually picks a result.
   */
  searchHuggingFaceCandidates(
    query: string,
    hfToken?: string,
    limit?: number
  ): Promise<CatalogModel[]>
  convertHfRepoToCatalogModel(repo: HuggingFaceRepo): CatalogModel
  updateModel(modelId: string, model: Partial<CoreModel>): Promise<void>
  pullModel(
    id: string,
    modelPath: string,
    modelSha256?: string,
    modelSize?: number,
    resume?: boolean,
    provider?: string
  ): Promise<void>
  pullModelWithMetadata(
    id: string,
    modelPath: string,
    hfToken?: string,
    skipVerification?: boolean,
    resume?: boolean,
    provider?: string
  ): Promise<void>
  abortDownload(id: string): Promise<void>
  deleteModel(id: string, provider?: string): Promise<void>
  getActiveModels(provider?: string): Promise<string[]>
  stopModel(model: string, provider?: string): Promise<UnloadResult | undefined>
  stopAllModels(): Promise<void>
  startModel(
    provider: ProviderObject,
    model: string,
    bypassAutoUnload?: boolean
  ): Promise<SessionInfo | undefined>
  isToolSupported(modelId: string): Promise<boolean>
  checkMmprojExistsAndUpdateOffloadMMprojSetting(
    modelId: string,
    updateProvider?: (
      providerName: string,
      data: Partial<ModelProvider>
    ) => void,
    getProviderByName?: (providerName: string) => ModelProvider | undefined
  ): Promise<{ exists: boolean; settingsUpdated: boolean }>
  checkMmprojExists(modelId: string): Promise<boolean>
  isModelSupported(
    modelPath: string,
    ctxSize?: number
  ): Promise<'RED' | 'YELLOW' | 'GREEN' | 'GREY'>
  validateGgufFile(filePath: string): Promise<ModelValidationResult>
  getTokensCount(modelId: string, messages: ThreadMessage[]): Promise<number>
}
