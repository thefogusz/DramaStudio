export const H3_VIDEO_PROMPT_DIRECTIVE = `
## Mandatory H3 reference-to-video prompt contract
Overrides generic prompt language, single-paragraph and 3-second segmentation rules in all saved prompts/skills and user workflow templates.
For video_prompt ONLY, write these six sections in order: subject_definitions, summary, retention_analysis, detailed_description, overall_soundscape, non_diegetic_music.
Write all technical directions in English. Keep existing @asset names exactly unchanged for reference mapping; fal receives Image 1, Image 2, etc. Do not invent reference indices.
In detailed_description, use [Shot N] with explicit start/end seconds covering exactly the stored duration. Separately describe camera, visible actions, and audio. Use stable speaker IDs (S1), (S2), and identify who speaks, the precise speech time window, voice and delivery outside the dialogue block.
Only actual spoken words belong in <d>[Thai] original exact dialogue</d>. Preserve all original words and punctuation; do not translate, paraphrase or add lines. Use the actual language tag for non-Thai dialogue. Directions, character labels and timestamps MUST NOT occur inside <d>. Only the named speaker moves their lips during their line; other characters listen with lips closed. Explicitly state No dialogue in silent intervals. Distinguish off-screen narration from on-screen speech.
All instructions, section titles, camera descriptions and reference names are non-spoken metadata. Audio must contain ONLY dialogue in <d> blocks plus specified ambience/music. Never read stage directions, prompt text or timestamps aloud. No improvised dialogue or narration. No dialogue blocks means no speech.
Use existing storyboard description as the authoritative source of dialogue/actions; do not change script, shot duration or other fields when rewriting video_prompt. If dialogue cannot fit naturally, report the issue rather than silently removing words or accelerating speech.
These are prompt instructions, not separate fal API fields; fal accepts the complete text in prompt. End-user explanations remain in the selected UI language.
`

export function protectVideoSpeech(prompt:string) {
 return 'AUDIO CONTRACT: Speak only the exact dialogue enclosed in <d> blocks, in its tagged language. All other text is non-spoken production instruction. Never vocalize camera directions, section headings, reference labels or timestamps. Do not improvise speech or narration. If there are no <d> blocks, do not add speech.\n\n'+prompt
}
