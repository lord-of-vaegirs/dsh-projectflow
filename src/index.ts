import { resolveConfig } from './config.js'
import { ProjectService } from './domain/project-service.js'
import { registerProjectCommand } from './dsh/commands.js'
import type { DshContext } from './dsh/contracts.js'
import {
  registerForkInheritance,
  registerPromptContribution,
  registerTaskTracking,
} from './dsh/prompt.js'
import { registerProjectRpc } from './dsh/rpc.js'
import { registerProjectTools } from './dsh/tools.js'
import type { ProjectFlowConfigInput } from './shared/contracts.js'

export const name = 'projectflow'
export const inject = ['tools', 'commands', 'agents']

/**
 * DSH plugin entry. The project store is independent of the working directory:
 * it reads `$DSH_HOME/projects` (or an explicit absolute projectsDir) and never
 * writes the workspace.
 */
export function apply(ctx: DshContext, rawConfig?: ProjectFlowConfigInput): void {
  const config = resolveConfig(rawConfig)
  const service = new ProjectService(config, undefined, ctx.logger)
  registerProjectTools(ctx, service, config)
  registerProjectCommand(ctx, service)
  registerPromptContribution(ctx, service)
  registerForkInheritance(ctx, service)
  if (config.taskTracking) registerTaskTracking(ctx, service)
  if (config.rpc) registerProjectRpc(ctx, service)
  ctx.logger?.info?.(
    `[projectflow] ready; data=${config.projectsDir} budget=${config.contextBudgetTokens} tokens`,
  )
}

export type { ProjectFlowConfigInput } from './shared/contracts.js'
export { ProjectService } from './domain/project-service.js'
export { ProjectStore } from './store/project-store.js'
export { resolveConfig } from './config.js'
