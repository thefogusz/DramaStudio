import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { getEpisodeId, getDramaId } from '../context.js'
import { productionSnapshot, requireEpisode, listPlans, saveDirectorPlan, editContext, saveEditPlan } from '../../services/production.js'
import { directorSchema, editSchema } from '../../services/production-contract.js'
function id(context:any) {
 const episodeId=getEpisodeId(context?.requestContext), dramaId=getDramaId(context?.requestContext)
 if(!episodeId||!dramaId) throw new Error('ไม่พบเรื่องและตอนที่เลือก')
 requireEpisode(episodeId,dramaId); return episodeId
}
const readProductionContext=createTool({ id:'read_production_context', description:'Read time budget, creative brief, source/script, storyboards and director plan; works before screenplay exists.', inputSchema:z.object({}), execute:async(_input,context)=>{
 const episodeId=id(context), snapshot=productionSnapshot(episodeId)
 return {...snapshot, director_plan:listPlans(episodeId).find(p=>p.kind==='director'&&!p.stale)?.plan||null}
}})
const saveDirector=createTool({ id:'save_director_plan', description:'Save beat timing and directing plan only. Does not rewrite script or clear storyboards.', inputSchema:z.object({fingerprint:z.string(),plan:directorSchema}), execute:async(input,context)=>saveDirectorPlan(id(context),input.plan,input.fingerprint) })
const readEdit=createTool({ id:'read_edit_context', description:'Probe actual owned video files and permitted trims. Metadata only, not verified audiovisual analysis. Preserve protected clips whole.', inputSchema:z.object({}), execute:async(_input,context)=>editContext(id(context)) })
const saveEdit=createTool({ id:'save_edit_plan', description:'Save validated EDL. Reject stale files, trims of dialogue, missing non-teaser shots and runtime overflow.', inputSchema:z.object({fingerprint:z.string(),plan:editSchema}), execute:async(input,context)=>saveEditPlan(id(context),input.plan,input.fingerprint) })
export const productionReadTools={readProductionContext}
export const directorTools={readProductionContext,saveDirector}
export const editorTools={readProductionContext,readEdit,saveEdit}
