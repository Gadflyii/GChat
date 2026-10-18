/** Application settings only; per-instance startup settings belong to Hosts. */
export const ginferSettingLabels: Record<string, { title: string; description: string }> = {
  model_path: {
    title: 'Model folder',
    description: 'Where GChat keeps downloaded models. Leave empty to use the default folder inside GChat’s data folder.',
  },
  binary_path: {
    title: 'Engine program',
    description: 'Path to a GInfer engine program for future loads. Leave empty to use the one that comes with GChat. Running models keep their current program.',
  },
  auto_unload: {
    title: 'Unload other models automatically',
    description: 'When starting a model for chat, stop other models to free graphics memory.',
  },
  timeout: {
    title: 'Model startup time limit',
    description: 'How many seconds GChat waits for a model to be ready. Running models are not affected.',
  },
}
