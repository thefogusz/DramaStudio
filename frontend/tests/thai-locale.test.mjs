import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createI18n } from 'vue-i18n'

const read = lang => JSON.parse(readFileSync(new URL(`../app/locales/${lang}.json`, import.meta.url), 'utf8'))
const flatten = (obj, prefix = '') => Object.fromEntries(Object.entries(obj).flatMap(([key, value]) => {
  const name = prefix ? `${prefix}.${key}` : key
  return typeof value === 'object' ? Object.entries(flatten(value, name)) : [[name, value]]
}))
test('Thai covers every English message and preserves interpolation parameters', () => {
  const en = flatten(read('en'))
  const th = flatten(read('th'))
  assert.deepEqual(Object.keys(th).sort(), Object.keys(en).sort())
  for (const key of Object.keys(en)) {
    assert.ok(th[key].trim(), key)
    const parameters = text => [...text.matchAll(/\{([^{}]+)\}/g)].map(m => m[1]).sort()
    assert.deepEqual(parameters(th[key]), parameters(en[key]), key)
    assert.ok(!/[\u4e00-\u9fff]/u.test(th[key]), `Chinese text in ${key}`)
  }
})
test('Thai messages compile and render counts, references and language dialogs', () => {
  const i18n = createI18n({ legacy: false, locale: 'th', messages: { th: read('th') } })
  for (const key of Object.keys(flatten(read('th')))) {
    assert.doesNotThrow(() => i18n.global.t(key, { n: 3, dur: 5, total: 4, done: 2, title: 'ทดสอบ', lang: 'ไทย' }), key)
  }
  assert.equal(i18n.global.t('episode.topbar.episodeN', { n: 3 }), 'ตอนที่ 3')
  assert.match(i18n.global.t('episode.inspector.videoPromptPlaceholder'), /@/)
})
