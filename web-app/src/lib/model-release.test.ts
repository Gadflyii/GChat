import { describe, expect, it } from 'vitest'
import { downloadFailureMessage, downloadStatusLabel, formatModelBytes, releaseReadiness, releaseVerified, validRelease, type ModelRelease } from './model-release'

const release: ModelRelease = { name: 'Fixture', identity: { model_id: 'fixture', weights_id: 'q4' },
  url: `https://huggingface.co/test/model/resolve/${'a'.repeat(40)}/model.ginfer`, sha256: 'b'.repeat(64),
  bytes: 4096, tp: 1, qualified_sm: ['8.6'], min_vram_mib_per_gpu: 16384, capabilities: ['tools'],
  launch_profiles: [{ id: 'c1' }] }
const gpu = { uuid: 'one', name: 'Fixture GPU', memory_mib: 16384, compute_capability: '8.6' }
describe('released model recommendations', () => {
  it('matches actual SM and per-GPU memory, not marketing names', () => {
    expect(releaseReadiness(release, [gpu]).available).toBe(true)
    expect(releaseReadiness(release, [{ ...gpu, compute_capability: '8.9' }]).available).toBe(false)
    expect(releaseReadiness(release, [{ ...gpu, memory_mib: 12288 }]).available).toBe(false)
  })
  it('never sums VRAM or treats heterogeneous devices as a TP group', () => {
    expect(releaseReadiness({ ...release, min_vram_mib_per_gpu: 32768 }, [gpu, { ...gpu, uuid: 'two' }]).available).toBe(false)
    expect(releaseReadiness({ ...release, tp: 2 }, [gpu, { ...gpu, uuid: 'two', name: 'Different GPU' }]).available).toBe(false)
    expect(releaseReadiness({ ...release, tp: 2 }, [gpu, { ...gpu, uuid: 'two' }]).gpuIds).toEqual(['one', 'two'])
  })
  it('does not offer unknown, unpublished or mutable packages', () => {
    expect(validRelease({ ...release, url: release.url.replace('a'.repeat(40), 'main') })).toBe(false)
    expect(releaseReadiness(undefined, [gpu]).reason).toContain('not ready to download')
    expect(releaseReadiness(release, [{ ...gpu, compute_capability: undefined }]).available).toBe(false)
    expect(releaseReadiness(release, []).available).toBe(false)
  })
  it('does not offer a release that has no tested launch profile', () => {
    const untested = { ...release, launch_profiles: [] }
    expect(releaseVerified(untested)).toBe(false)
    expect(releaseReadiness(untested, [gpu]).available).toBe(false)
  })
  it('explains the required card count and memory on each card', () => {
    expect(releaseReadiness(release, [{ ...gpu, memory_mib: 12288 }])).toEqual({
      available: false, gpuIds: [],
      reason: 'Needs 1 supported NVIDIA graphics card with at least 16 GiB of memory.',
    })
    expect(releaseReadiness({ ...release, tp: 2 }, [gpu])).toEqual({
      available: false, gpuIds: [],
      reason: 'Needs 2 matching supported NVIDIA graphics cards, each with at least 16 GiB of memory.',
    })
    expect(releaseReadiness({ ...release, tp: 4, min_vram_mib_per_gpu: 32768 }, [gpu]).reason)
      .toBe('Needs 4 matching supported NVIDIA graphics cards, each with at least 32 GiB of memory.')
  })
  it.each([2, 4] as const)('explains a matching %i-card group and its remaining loading check', (tp) => {
    const cards = Array.from({ length: tp + 1 }, (_, index) => ({ ...gpu, uuid: `card-${index}` }))
    expect(releaseReadiness({ ...release, tp }, cards)).toEqual({
      available: true, gpuIds: cards.slice(0, tp).map(card => card.uuid),
      reason: `Your ${tp} matching graphics cards have enough memory. GChat will check that they can work together when you load the model.`,
    })
  })
  it('keeps supported-card and loading requirements clear without hardware codes', () => {
    const results = [
      releaseReadiness(undefined, [gpu]), releaseReadiness(release, []),
      releaseReadiness(release, [{ ...gpu, compute_capability: '8.9' }]),
      releaseReadiness(release, [gpu]), releaseReadiness({ ...release, tp: 2 }, [gpu]),
      releaseReadiness({ ...release, tp: 2 }, [gpu, { ...gpu, uuid: 'two' }]),
    ]
    expect(results[1].reason).toContain('Choose a paired computer with a supported NVIDIA graphics card')
    expect(results[3]).toEqual({
      available: true, gpuIds: ['one'],
      reason: 'Your graphics card has enough memory and is supported by this model. GChat will check the model file when you load it.',
    })
    for (const result of results) {
      expect(result.reason).not.toMatch(/\b(?:SM|TP\d*|VRAM|checksum)\b|8\.6|8\.9/i)
    }
  })
  it('shows sizes below 1 GiB in MiB so a starting download is not 0.0 GiB', () => {
    expect(formatModelBytes(50 * 1024 ** 2)).toBe('50 MiB')
    expect(formatModelBytes(10667321600)).toBe('9.9 GiB')
  })
})

describe('model download messages', () => {
  it.each([
    ['queued', 'Waiting to download'], ['downloading', 'Downloading model'],
    ['pausing', 'Saving progress before pausing'], ['paused', 'Paused; resume to continue'],
    ['verifying', 'Checking the downloaded file'], ['installed', 'Download complete'],
    ['failed', 'Download stopped'], ['unexpected_internal_state', 'Download status unavailable'],
    ['toString', 'Download status unavailable'],
  ])('describes %s in plain words', (status, expected) => {
    expect(downloadStatusLabel(status)).toBe(expected)
  })
  it.each([
    'Not enough free disk space on the destination host.',
    'No space left on device (os error 28)',
    'There is not enough space on the disk. (os error 112)',
    'The disk is full.',
  ])('explains how to recover from a full disk: %s', (error) => {
    expect(downloadFailureMessage(error)).toBe('There isn’t enough space in the model folder. Free some disk space, then resume the download.')
  })
  it.each([
    'SHA256 mismatch; remove incomplete files and download again. Package was not installed.',
    'SHA-256 mismatch', 'checksum mismatch',
  ])('requires a fresh download when the saved file is damaged: %s', (error) => {
    expect(downloadFailureMessage(error)).toBe('The downloaded file is damaged or incomplete. Remove this incomplete download, then download the model again.')
  })
  it.each([
    'download server returned 404 Not Found', 'download server returned 503 Service Unavailable',
    'HTTP 403 Forbidden', 'HTTP/1.1 500 Internal Server Error', 'status code: 429',
  ])('explains download-site errors without exposing the response code: %s', (error) => {
    expect(downloadFailureMessage(error)).toBe('The download site couldn’t provide this model. Refresh the model list or try again later.')
  })
  it.each([
    'download server did not respond; resume to retry', 'download stalled; resume to retry',
    'download ended before the declared size; resume to retry',
    'error sending request for url (https://huggingface.co/test/model)',
    'error decoding response body', 'connection reset by peer', 'DNS lookup failed',
  ])('offers connection and resume steps after an interruption: %s', (error) => {
    expect(downloadFailureMessage(error)).toBe('The download was interrupted. Check your internet connection, then resume the download.')
  })
  it.each([null, '', 'payload identity 0x123 is not supported'])('keeps unknown details separate from the recovery message: %s', (error) => {
    expect(downloadFailureMessage(error)).toBe('The download couldn’t finish. Try resuming it, or open the details below for more information.')
  })
})
