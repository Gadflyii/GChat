'use strict';

var core = require('@tauri-apps/api/core');

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
async function loadGinferModel(binaryPath, hostDirectory, modelId, modelPath, cfg, isEmbedding = false, timeout = 600) {
    const config = normalizeGinferConfig(cfg);
    return await core.invoke('plugin:ginfer|load_ginfer_model', {
        binaryPath,
        hostDirectory,
        modelId,
        modelPath,
        config,
        isEmbedding,
        timeout,
    });
}
async function unloadGinferModel(pid) {
    return await core.invoke('plugin:ginfer|unload_ginfer_model', { pid });
}
async function isProcessRunning(pid) {
    return await core.invoke('plugin:ginfer|is_process_running', { pid });
}
async function findSessionByModel(modelId) {
    return await core.invoke('plugin:ginfer|find_session_by_model', { modelId });
}
async function getLoadedModels() {
    return await core.invoke('plugin:ginfer|get_loaded_models');
}
async function getAllSessions() {
    return await core.invoke('plugin:ginfer|get_all_sessions');
}
async function runGinferBenchmark(request) {
    return await core.invoke('plugin:ginfer|run_ginfer_benchmark', { request });
}
async function cancelGinferBenchmark(runId) {
    return await core.invoke('plugin:ginfer|cancel_ginfer_benchmark', { runId });
}
// Cleanup commands
async function cleanupGinferProcesses() {
    return await core.invoke('plugin:ginfer|cleanup_ginfer_processes');
}

exports.cancelGinferBenchmark = cancelGinferBenchmark;
exports.cleanupGinferProcesses = cleanupGinferProcesses;
exports.findSessionByModel = findSessionByModel;
exports.getAllSessions = getAllSessions;
exports.getLoadedModels = getLoadedModels;
exports.isProcessRunning = isProcessRunning;
exports.loadGinferModel = loadGinferModel;
exports.normalizeGinferConfig = normalizeGinferConfig;
exports.runGinferBenchmark = runGinferBenchmark;
exports.unloadGinferModel = unloadGinferModel;
