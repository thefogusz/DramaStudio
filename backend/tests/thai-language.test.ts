import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildLanguageDirective } from '../src/agents/language.js'

test('Thai is accepted, saved and applied to generated content', async () => {
  // Use a separate database; never modify the running application's preferences.
  process.env.SQLITE_PATH = ':memory:'
  const { default: settings } = await import('../src/routes/settings.js')
  const { getContentLanguage, setContentLanguage } = await import('../src/services/app-settings.js')
  assert.equal(getContentLanguage(), 'th')
  setContentLanguage('en')
  assert.equal(getContentLanguage(), 'en')
  const saved = await settings.request('/content-language', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ language: 'th' }),
  })
  assert.equal(saved.status, 200)
  assert.equal(getContentLanguage(), 'th')
  assert.match(buildLanguageDirective(getContentLanguage()), /ภาษาไทย \(Thai\)/)
  assert.match(buildLanguageDirective('th'), /HIGHEST PRIORITY/)
  const invalid = await settings.request('/content-language', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ language: 'invalid' }),
  })
  assert.equal(invalid.status, 400)
  assert.equal(getContentLanguage(), 'th')
})
