import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const fixture = (name) =>
  JSON.parse(
    readFileSync(
      new URL(`./fixtures/registries/${name}.json`, import.meta.url),
      'utf8'
    )
  )

const nonEmpty = (value, label) =>
  assert.equal(typeof value === 'string' && value.length > 0, true, label)
const unique = (values, label) =>
  assert.equal(new Set(values).size, values.length, label)

test('recommended models conform to the loader schema contract', () => {
  const manifest = fixture('recommended-models')
  // Must stay 1: bumping it makes every shipped client reject the manifest and
  // fall back to its bundled baseline permanently.
  assert.equal(manifest.schema_version, 1)

  const lowSpec = manifest.low_spec_recommendations ?? []

  for (const [label, list] of [
    ['recommendations', manifest.recommendations],
    ['low_spec_recommendations', lowSpec],
  ]) {
    unique(
      list.map(({ model_name }) => model_name),
      `${label} must be unique`
    )
    for (const recommendation of list) {
      assert.match(recommendation.model_name, /^[^/]+\/[^/]+$/)
      assert.match(recommendation.description_key, /^hub:/)
      for (const key of ['quant', 'mmproj_quant']) {
        if (recommendation[key] !== undefined) {
          assert.match(
            recommendation[key],
            /^[A-Za-z0-9_]{2,16}$/,
            `${label}.${key} must be a quant token`
          )
        }
      }
    }
  }

  if (manifest.low_spec_recommendations !== undefined) {
    assert.ok(lowSpec.length > 0, 'low_spec_recommendations must not be empty')
    // The low-spec list REPLACES the standard one, so an entry in both would
    // mean a model is offered on hardware the other list says it is wrong for.
    const standard = new Set(manifest.recommendations.map((r) => r.model_name))
    for (const { model_name } of lowSpec) {
      assert.ok(
        !standard.has(model_name),
        `${model_name} appears in both recommendation lists`
      )
    }
  }
})

test('provider registry contains safe provider and model contracts', () => {
  const manifest = fixture('provider-registry')
  assert.equal(manifest.schema_version, 1)
  unique(
    manifest.providers.map(({ provider }) => provider),
    'provider ids must be unique'
  )
  for (const provider of manifest.providers) {
    nonEmpty(provider.provider, 'provider id')
    assert.equal(provider.api_key, '')
    assert.doesNotThrow(() => new URL(provider.base_url))
    unique(
      provider.models.map(({ id }) => id),
      `${provider.provider} model ids must be unique`
    )
    for (const model of provider.models) {
      nonEmpty(model.name, 'model name')
      assert.ok(model.capabilities.includes('completion'))
    }
  }
})

test('catalog and index remain mutually consistent', () => {
  const catalog = fixture('catalog')
  const index = fixture('catalog-index')
  assert.equal(catalog.manifest_version, 1)
  assert.equal(catalog.schema_version, 1)
  assert.equal(index.index_version, 1)
  assert.equal(index.catalog_updated_at, catalog.updated_at)
  assert.equal(index.catalog_total_models, catalog.models.length)
  assert.equal(catalog.stats.total_models, catalog.models.length)
  unique(
    catalog.models.map(({ model_name }) => model_name),
    'catalog model ids must be unique'
  )
  for (const model of catalog.models) {
    assert.match(model.model_name, /^[^/]+\/[^/]+$/)
    assert.ok(Number.isInteger(model.downloads) && model.downloads >= 0)
    assert.equal(model.num_quants, model.quants.length)
    for (const quant of model.quants) {
      assert.match(
        quant.path,
        /^https:\/\/huggingface\.co\/.+\/resolve\/main\/.+$/
      )
    }
  }
  assert.equal(index.minisearch.serializationVersion, 2)
})

test('fixture provenance is pinned to immutable revisions', () => {
  const sources = fixture('sources')
  for (const source of Object.values(sources)) {
    assert.match(source.revision, /^[0-9a-f]{40}$/)
  }
})
