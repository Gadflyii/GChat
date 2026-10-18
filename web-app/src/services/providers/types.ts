/**
 * Providers Service Types
 */

export interface ProvidersService {
  /** Read registered inventory. Reject on read failure; an empty result is data. */
  getProviders(): Promise<ModelProvider[]>
  fetchModelsFromProvider(provider: ModelProvider): Promise<string[]>
  updateSettings(providerName: string, settings: ProviderSetting[]): Promise<void>
  fetch(): typeof fetch
}
