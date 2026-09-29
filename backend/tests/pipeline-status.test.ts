import { test } from 'node:test'
import assert from 'node:assert/strict'
process.env.SQLITE_PATH = ':memory:'

test('pipeline counts episode assets and first frames, excludes deleted shots', async () => {
  const { db, schema, getInsertId } = await import('../src/db/index.js')
  const { default: episodes } = await import('../src/routes/episodes.js')
  const ts = new Date().toISOString()
  const drama = getInsertId(await db.insert(schema.dramas).values({ createdAt: ts, updatedAt: ts, title: 'audit', aspectRatio: '9:16' }))
  const ep1 = getInsertId(await db.insert(schema.episodes).values({ createdAt: ts, updatedAt: ts, dramaId: drama, episodeNumber: 1, title: 'one', scriptContent: 'บท' }))
  const ep2 = getInsertId(await db.insert(schema.episodes).values({ createdAt: ts, updatedAt: ts, dramaId: drama, episodeNumber: 2, title: 'two' }))
  const ch = getInsertId(await db.insert(schema.characters).values({ createdAt: ts, updatedAt: ts, dramaId: drama, name: 'actor' }))
  const sc = getInsertId(await db.insert(schema.scenes).values({ createdAt: ts, updatedAt: ts, dramaId: drama, episodeId: ep1, location: 'room', time: 'night', prompt: 'room' }))
  await db.insert(schema.episodeCharacters).values({ createdAt: ts, episodeId: ep1, characterId: ch })
  await db.insert(schema.episodeScenes).values({ createdAt: ts, episodeId: ep1, sceneId: sc })
  await db.insert(schema.storyboards).values({ createdAt: ts, updatedAt: ts, episodeId: ep1, storyboardNumber: 1, firstFrameImage: '/static/first.png', duration: 5 })
  await db.insert(schema.storyboards).values({ createdAt: ts, updatedAt: ts, episodeId: ep1, storyboardNumber: 2, deletedAt: new Date().toISOString() })
  const first = (await (await episodes.request(`/${ep1}/pipeline-status`)).json() as any).data.steps
  assert.deepEqual(first.generate_images, { status: 'done', completed: 1, total: 1 })
  assert.equal(first.extract_characters.count, 1)
  assert.equal(first.extract_scenes.count, 1)
  const second = (await (await episodes.request(`/${ep2}/pipeline-status`)).json() as any).data.steps
  assert.equal(second.extract_characters.status, 'pending')
  assert.equal(second.extract_scenes.status, 'pending')
  assert.equal(second.extract_storyboards.count, 0)
})
