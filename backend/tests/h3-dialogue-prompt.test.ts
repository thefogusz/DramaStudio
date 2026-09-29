import {test} from 'node:test'
import assert from 'node:assert/strict'
import {protectVideoSpeech} from '../src/services/h3-video-prompt.js'
import {buildLanguageDirective} from '../src/agents/language.js'
import {resolveAgentInstructions} from '../src/agents/index.js'
import {FalVideoAdapter,FAL_VIDEO_MODEL} from '../src/services/adapters/fal.js'
test('fal payload preserves Thai dialogue verbatim inside tags and marks directions as non-spoken',()=>{
 const text='detailed_description: [Shot 1] 0–5s. Medium two-shot. Woman (S1) says: <d>[Thai] ช่างเถอะ เราเพื่อนกันนี่เนอะ</d>'
 const request=new FalVideoAdapter().buildGenerateRequest({provider:'fal',apiKey:'test',baseUrl:'https://queue.fal.run',model:FAL_VIDEO_MODEL},{id:1,prompt:text,duration:5,referenceImageUrls:'["image"]'})
 assert.equal(request.body.prompt,protectVideoSpeech(text))
 assert.match(String(request.body.prompt),/Never vocalize camera directions/)
 assert.ok(String(request.body.prompt).endsWith(text))
 assert.equal(request.body.prompt_expansion_mode,'disabled')
})
test('effective prompt and storyboard instructions override blanket Thai video direction rules',async()=>{
 assert.doesNotMatch(buildLanguageDirective('th'),/image prompts, video prompts/)
 for(const type of ['storyboard_breaker','prompt_generator']) {
 const text=await resolveAgentInstructions(type,'th')
 assert.match(text,/six sections/)
 assert.match(text,/Only actual spoken words belong in <d>/)
 assert.match(text,/Write all technical directions in English/)
 assert.match(text,/No dialogue blocks means no speech/)
 }
})
