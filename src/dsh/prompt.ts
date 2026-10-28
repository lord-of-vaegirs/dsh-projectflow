import type { ProjectService } from '../domain/project-service.js'
import type { DshAssembleContext, DshContext, DshPromptAssembly } from './contracts.js'

const SECTION_NAME = 'projectflow:context'

function logWarning(ctx: DshContext, message: string): void {
  ctx.logger?.warn?.(`[projectflow] ${message}`)
}

/**
 * Add the project section after every other prompt contributor. DSH's
 * `system-prompt/assemble` waterfall is the async extension point; unlike a
 * static section provider it can read project state without blocking prompt
 * assembly on synchronous filesystem calls.
 */
export function registerPromptContribution(ctx: DshContext, service: ProjectService): void {
  ctx.on('system-prompt/assemble', async (
    assembly: DshPromptAssembly,
    context: DshAssembleContext,
    next: () => Promise<DshPromptAssembly>,
  ): Promise<DshPromptAssembly> => {
    const base = await next()
    const agent = context.agent
    if (agent === undefined) return base
    try {
      if (context.signal?.aborted === true) return base
      const binding = await service.bindingForSession(agent.id)
      if (binding === undefined) return base
      const project = await service.get(binding.projectId)
      if (project.archived) {
        const sections = base.sections.filter((section) => section.name !== SECTION_NAME)
        sections.push({
          name: SECTION_NAME,
          text: `[PROJECTFLOW] Project ${project.name} (${project.id}) is archived. Run project_status or /project list.`,
          interpolate: false,
        })
        return { ...base, sections }
      }
      const result = await service.context(project.id, agent.id)
      if (result.text.trim() === '') return base
      const sections = base.sections.filter((section) => section.name !== SECTION_NAME)
      sections.push({ name: SECTION_NAME, text: result.text, interpolate: false })
      return { ...base, sections }
    } catch (error) {
      logWarning(ctx, `context injection failed: ${(error as Error).message}`)
      return base
    }
  })
}

export function registerForkInheritance(ctx: DshContext, service: ProjectService): void {
  const inherit = async (agent: Parameters<NonNullable<DshContext['agents']>['get']>[0] extends never ? never : any): Promise<void> => {
    try {
      await service.inheritForAgent(agent)
      const binding = await service.bindingForSession(agent.id)
      if (binding !== undefined && agent.session !== undefined) {
        await service.task({ action: 'checkpoint' }, agent)
      }
    } catch (error) {
      logWarning(ctx, `agent initialization failed: ${(error as Error).message}`)
    }
  }
  ctx.on('agent/created', async ({ agent }: { agent: any }) => {
    await inherit(agent)
  })
  for (const agent of ctx.agents?.list?.() ?? ctx.agents?.roots?.() ?? []) {
    void inherit(agent)
  }
}

/**
 * Lightweight task struct maintenance. A turn boundary is the natural point
 * to snapshot the session without writing on every token or tool event.
 */
export function registerTaskTracking(ctx: DshContext, service: ProjectService): void {
  ctx.on('session/event', (session: { id: string }, event: { type: string }) => {
    if (event.type !== 'turn/start' && event.type !== 'turn/end') return
    const agent = ctx.agents?.get(session.id)
    if (agent === undefined) return
    void (async () => {
      try {
        const binding = await service.bindingForSession(session.id)
        if (binding === undefined) return
        await service.task({ action: 'checkpoint' }, agent)
      } catch (error) {
        logWarning(ctx, `task checkpoint failed: ${(error as Error).message}`)
      }
    })()
  })
}

export { SECTION_NAME }
