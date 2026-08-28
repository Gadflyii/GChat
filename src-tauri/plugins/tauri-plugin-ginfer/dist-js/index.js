import { invoke } from '@tauri-apps/api/core';

// Helpers
function asNumber(v, defaultValue = 0) {
    if (v === '' || v === null || v === undefined)
        return defaultValue;
    const n = Number(v);
    return isFinite(n) ? n : defaultValue;
}
function asBool(v) {
    if (v === '' || v === null || v === undefined)
        return false;
    return v === true || v === 'true' || v === 1 || v === '1';
}
function asString(v, defaultValue = '') {
    if (v === '' || v === null || v === undefined)
        return defaultValue;
    return String(v);
}
function normalizeGinferConfig(config) {
    const value = config ?? {};
    return {
        vision: value.vision === undefined ? true : asBool(value.vision),
        spec: asString(value.spec, 'auto'),
        draft_tokens: asNumber(value.draft_tokens),
        draft_tp: asNumber(value.draft_tp),
        kv_dtype: asString(value.kv_dtype, 'auto'),
        max_context: asNumber(value.max_context),
        kv_arena_bytes: asString(value.kv_arena_bytes, 'auto'),
        prefill_chunk: asNumber(value.prefill_chunk),
        max_concurrency: asNumber(value.max_concurrency),
        no_cuda_graph: asBool(value.no_cuda_graph),
    };
}
// GInfer server commands
async function loadGinferModel(binaryPath, modelId, modelPath, port, cfg, apiKey, isEmbedding = false, timeout = 600) {
    const config = normalizeGinferConfig(cfg);
    return await invoke('plugin:ginfer|load_ginfer_model', {
        binaryPath,
        modelId,
        modelPath,
        port,
        config,
        apiKey,
        isEmbedding,
        timeout,
    });
}
async function unloadGinferModel(pid) {
    return await invoke('plugin:ginfer|unload_ginfer_model', { pid });
}
async function isProcessRunning(pid) {
    return await invoke('plugin:ginfer|is_process_running', { pid });
}
async function getRandomPort() {
    return await invoke('plugin:ginfer|get_random_port');
}
async function findSessionByModel(modelId) {
    return await invoke('plugin:ginfer|find_session_by_model', { modelId });
}
async function getLoadedModels() {
    return await invoke('plugin:ginfer|get_loaded_models');
}
async function getAllSessions() {
    return await invoke('plugin:ginfer|get_all_sessions');
}
// Cleanup commands
async function cleanupGinferProcesses() {
    return await invoke('plugin:ginfer|cleanup_ginfer_processes');
}

export { cleanupGinferProcesses, findSessionByModel, getAllSessions, getLoadedModels, getRandomPort, isProcessRunning, loadGinferModel, normalizeGinferConfig, unloadGinferModel };
