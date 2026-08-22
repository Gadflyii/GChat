import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

const repositoryRoot = process.cwd().endsWith('/web-app')
  ? resolve(process.cwd(), '..')
  : process.cwd()

const fixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(
      resolve(
        repositoryRoot,
        'tests',
        'fixtures',
        'registries',
        `${name}.json`
      ),
      'utf8'
    )
  )

const nonEmptyString = z.string().min(1)
const immutableRevision = z.string().regex(/^[0-9a-f]{40}$/)

const recommendationSchema = z.object({
  schema_version: z.literal(1),
  updated_at: z.iso.datetime(),
  recommendations: z.array(
    z.object({
      model_name: z.string().regex(/^[^/]+\/[^/]+$/),
      description_key: z.string().startsWith('hub:'),
    })
  ),
})

/**
 * Deliberately separate from `recommendationSchema`: `recommended.json` is
 * frozen for shipped clients, and staff picks must never be validated by
 * relaxing that contract.
 */
const staffPicksSchema = z.object({
  schema_version: z.literal(1),
  updated_at: z.iso.datetime(),
  picks: z
    .array(
      z.object({
        model_name: z.string().regex(/^[^/]+\/[^/]+$/),
        title: nonEmptyString.optional(),
        summary: nonEmptyString.optional(),
        description_key: z.string().startsWith('hub:').optional(),
        icon: nonEmptyString.optional(),
        format: z.enum(['gguf', 'mlx']).optional(),
        categories: z.array(nonEmptyString).optional(),
        platforms: z.array(z.enum(['macos', 'windows', 'linux'])).optional(),
        order: z.number().optional(),
        active: z.boolean().optional(),
      })
    )
    .min(1),
})

const providerRegistrySchema = z.object({
  schema_version: z.literal(1),
  updated_at: z.iso.datetime(),
  providers: z.array(
    z.object({
      provider: nonEmptyString,
      api_key: z.literal(''),
      base_url: z.url(),
      models: z.array(
        z.object({
          id: nonEmptyString,
          name: nonEmptyString,
          capabilities: z.array(z.string()).min(1),
        })
      ),
    })
  ),
})

const quantSchema = z.object({
  model_id: nonEmptyString,
  path: z.url().startsWith('https://huggingface.co/'),
  file_size: nonEmptyString,
})

const catalogSchema = z.object({
  manifest_version: z.literal(1),
  schema_version: z.literal(1),
  updated_at: z.iso.datetime(),
  stats: z.object({ total_models: z.number().int().nonnegative() }),
  models: z.array(
    z.object({
      model_name: z.string().regex(/^[^/]+\/[^/]+$/),
      downloads: z.number().int().nonnegative(),
      num_quants: z.number().int().nonnegative(),
      quants: z.array(quantSchema),
    })
  ),
})

const catalogIndexSchema = z.object({
  index_version: z.literal(1),
  catalog_updated_at: z.iso.datetime(),
  catalog_total_models: z.number().int().nonnegative(),
  minisearch: z.object({ serializationVersion: z.literal(2) }),
})

const liveContracts = [
  [
    'recommended models',
    'https://raw.githubusercontent.com/AtomicBot-ai/atomic-chat-conf/main/models/recommended.json',
    recommendationSchema,
  ],
  [
    'staff picks',
    'https://raw.githubusercontent.com/AtomicBot-ai/atomic-chat-conf/main/models/staff-picks.json',
    staffPicksSchema,
  ],
  [
    'provider registry',
    'https://raw.githubusercontent.com/AtomicBot-ai/atomic-chat-conf/main/providers/registry.json',
    providerRegistrySchema,
  ],
  [
    'model catalog',
    'https://raw.githubusercontent.com/AtomicBot-ai/atomic-chat-model-catalog/main/dist/catalog.json.gz',
    catalogSchema,
    'gzip',
  ],
  [
    'model catalog index',
    'https://raw.githubusercontent.com/AtomicBot-ai/atomic-chat-model-catalog/main/dist/catalog.idx.json.gz',
    catalogIndexSchema,
    'gzip',
  ],
] as const

describe('pinned external registry contracts', () => {
  it.each([
    ['recommended models', 'recommended-models', recommendationSchema],
    ['staff picks', 'staff-picks', staffPicksSchema],
    ['provider registry', 'provider-registry', providerRegistrySchema],
    ['model catalog', 'catalog', catalogSchema],
    ['model catalog index', 'catalog-index', catalogIndexSchema],
  ] as const)('validates the %s fixture', (_label, name, schema) => {
    expect(() => schema.parse(fixture(name))).not.toThrow()
  })

  /**
   * Shipped clients read `recommended.json` and reject a manifest whose
   * `schema_version` they do not know. Staff picks exist precisely so that the
   * Hub can evolve without touching that file, so the separation is asserted
   * rather than left to reviewer discipline.
   */
  it('keeps the onboarding manifest independent of staff picks', () => {
    const recommended = recommendationSchema.parse(fixture('recommended-models'))
    expect(recommended.schema_version).toBe(1)
    for (const entry of recommended.recommendations) {
      expect(Object.keys(entry).sort()).toEqual([
        'description_key',
        'model_name',
      ])
    }

    const setupScreen = readFileSync(
      resolve(repositoryRoot, 'web-app', 'src', 'containers', 'SetupScreen.tsx'),
      'utf8'
    )
    expect(setupScreen).toContain('useResolvedRecommendedModels')
    expect(setupScreen).not.toMatch(/staff-?picks/i)

    const recommendedLoader = readFileSync(
      resolve(
        repositoryRoot,
        'web-app',
        'src',
        'services',
        'recommended-models-registry.ts'
      ),
      'utf8'
    )
    expect(recommendedLoader).not.toMatch(/staff-?picks/i)
  })

  it('pins every fixture source to an immutable revision', () => {
    const sources = z
      .record(
        z.string(),
        z.object({
          revision: immutableRevision,
          fixtures: z.array(nonEmptyString).min(1),
        })
      )
      .parse(fixture('sources'))

    expect(Object.keys(sources).length).toBeGreaterThan(0)
  })
})

describe.runIf(process.env.ATOMIC_TEST_LIVE_REGISTRIES === '1')(
  'live external registry contracts',
  () => {
    it.each(liveContracts)(
      'validates the current %s',
      async (_label, url, schema, encoding) => {
        const response = await fetch(url)
        expect(response.ok).toBe(true)
        const payload =
          encoding === 'gzip'
            ? JSON.parse(
                gunzipSync(Buffer.from(await response.arrayBuffer())).toString(
                  'utf8'
                )
              )
            : await response.json()
        expect(() => schema.parse(payload)).not.toThrow()
      },
      30_000
    )
  }
)
