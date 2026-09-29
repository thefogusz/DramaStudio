/**
 * Mastra 中央实例 — Agent 注册表挂载点
 * 不用 Mastra logger（项目已有 pino + task-logger）
 */
import { Mastra } from '@mastra/core/mastra'
import { agentRegistry } from '../agents/index.js'
import { withNativeAgentJob } from '../services/codex-text.js'
import { resetNativeVersion } from '../agents/native-guard.js'

const registry = new Mastra({
  agents: agentRegistry,
  logger: false,
})

// Serialize complete workflows so extraction batches do not invalidate each
// other's revision snapshots between read and save steps.
export const mastra = {
  getAgent(type: string) {
    const agent = registry.getAgent(type)
    return { generate: (messages: any, options: any) => withNativeAgentJob(() => {
      resetNativeVersion(options?.requestContext)
      return agent.generate(messages, options)
    }) }
  },
}
