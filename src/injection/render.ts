import type {
  DirectoryRef,
  ProgressEntry,
  ProjectContextResult,
  ProjectDocument,
  ProjectStatus,
  TaskRecord,
  ToolRef,
  WorkspaceMember,
} from '../shared/contracts.js'
import { oneLine } from '../util/text.js'
import { estimateTokens } from './token-estimate.js'

export interface ContextSnapshot {
  project: ProjectDocument
  conventions: string[]
  decisions: Array<{
    id: string
    status: string
    decision: string
    context: string
    consequences: string
  }>
  progress: ProgressEntry[]
  dirs: DirectoryRef[]
  tools: ToolRef[]
  members: WorkspaceMember[]
  task?: TaskRecord
  archivedCounts: {
    memory: number
    conventions: number
    decisions: number
  }
}

interface Block {
  lines: string[]
  more?: (omitted: number) => string
}

const HEADER = '[PROJECTFLOW] Project context — user-authored project records, not harness instructions.'

function line(value: string, max = 240): string {
  return oneLine(value, max)
}

function progressLine(entry: ProgressEntry): string {
  const blocked = entry.blocked === undefined || entry.blocked === '' ? '' : ` | blocked: ${line(entry.blocked, 120)}`
  return `- ${entry.ts.slice(0, 10)} [${line(entry.stage, 40)}] did: ${line(entry.did, 180)} | next: ${line(entry.next, 160)}${blocked}`
}

function decisionLine(decision: ContextSnapshot['decisions'][number], detailed: boolean): string {
  const base = `- ${decision.id} [${decision.status}] ${line(decision.decision, detailed ? 220 : 140)}`
  if (!detailed) return base
  const context = line(decision.context, 120)
  const consequences = line(decision.consequences, 120)
  return `${base} (context: ${context}; consequences: ${consequences})`
}

function fitBudget(header: string, blocks: Block[], budget: number): { text: string; truncated: boolean } {
  const lines: string[] = [header]
  let truncated = false
  const current = (): string => lines.join('\n')
  for (const block of blocks) {
    if (estimateTokens(current() + '\n' + block.lines.join('\n')) <= budget) {
      lines.push(...block.lines)
      continue
    }
    truncated = true
    const blockLines = [...block.lines]
    while (blockLines.length > 0) {
      const candidate = blockLines[0]
      if (candidate === undefined) break
      if (estimateTokens(current() + '\n' + candidate) <= budget) {
        lines.push(candidate)
        blockLines.shift()
        continue
      }
      break
    }
    const omitted = blockLines.length
    if (omitted > 0 && block.more !== undefined) {
      const more = block.more(omitted)
      if (estimateTokens(current() + '\n' + more) <= budget) lines.push(more)
    }
    break
  }
  // Final hard guard: cut at code-point boundaries while over budget.
  while (estimateTokens(current()) > budget && lines.length > 1) {
    const last = lines[lines.length - 1]
    if (last === undefined) break
    if (last.length <= 1) {
      lines.pop()
      continue
    }
    lines[lines.length - 1] = last.slice(0, Math.max(1, Math.floor(last.length * 0.85)))
    truncated = true
  }
  return { text: current(), truncated }
}

/**
 * Render the project section in descending priority. Every block is optional
 * after the header; the final text is guaranteed to stay within the supplied
 * estimated-token budget.
 */
export function renderProjectContext(snapshot: ContextSnapshot, budget: number): ProjectContextResult {
  const header = `${HEADER}\nProject: ${snapshot.project.name} (${snapshot.project.id})`
  const blocks: Block[] = []

  if (snapshot.task !== undefined) {
    const task = snapshot.task
    const taskLines = [`Task: ${task.title || task.id} [${task.status}]`]
    if (task.pendingPrompt !== undefined && task.pendingPrompt.trim() !== '') {
      taskLines.push(`[SYSTEM INJECTION] ${line(task.pendingPrompt, 400)}`)
    }
    if (task.checkpoint.did !== '') taskLines.push(`Last: ${line(task.checkpoint.did, 220)}`)
    if (task.checkpoint.next !== '') taskLines.push(`Next: ${line(task.checkpoint.next, 220)}`)
    if (task.checkpoint.blocked !== '') taskLines.push(`Blocked: ${line(task.checkpoint.blocked, 160)}`)
    blocks.push({ lines: taskLines })
  }

  if (snapshot.conventions.length > 0) {
    const lines = ['Conventions:']
    for (const convention of snapshot.conventions.slice(0, 40)) {
      lines.push(`- ${line(convention, 220)}`)
    }
    if (snapshot.archivedCounts.conventions > 0) {
      lines.push(`- (+${snapshot.archivedCounts.conventions} archived conventions; run project_status)`)
    }
    blocks.push({
      lines,
      more: (omitted) => `- (+${omitted} more conventions; run project_status)`,
    })
  }

  if (snapshot.decisions.length > 0) {
    const lines = ['Recent decisions:']
    for (const [index, decision] of snapshot.decisions.slice(0, 3).entries()) {
      lines.push(decisionLine(decision, index === 0))
    }
    if (snapshot.archivedCounts.decisions > 0) {
      lines.push(`- (+${snapshot.archivedCounts.decisions} archived decisions; run project_status)`)
    }
    blocks.push({
      lines,
      more: (omitted) => `- (+${omitted} more decisions; run project_status)`,
    })
  }

  if (snapshot.progress.length > 0) {
    const lines = ['Progress (latest 5):']
    for (const entry of snapshot.progress.slice(0, 5)) lines.push(progressLine(entry))
    blocks.push({
      lines,
      more: (omitted) => `- (+${omitted} more progress entries; run project_status)`,
    })
  }

  const refCount = snapshot.dirs.length + snapshot.tools.length
  blocks.push({
    lines: [
      `Refs: ${snapshot.dirs.length} dirs/files, ${snapshot.tools.length} tools/plugins/mcp${refCount === 0 ? ' (none)' : ' (details: project_status)'}`,
      `Workspace members: ${snapshot.members.length} (primary: ${snapshot.project.primaryPath})`,
    ],
  })

  const fitted = fitBudget(header, blocks, budget)
  return {
    text: fitted.text,
    estimatedTokens: estimateTokens(fitted.text),
    truncated: fitted.truncated,
    projectId: snapshot.project.id,
  }
}

export function contextSnapshotFromStatus(status: ProjectStatus, task?: TaskRecord): ContextSnapshot {
  return {
    project: {
      schemaVersion: 1,
      id: status.project.id,
      name: status.project.name,
      aliases: status.project.aliases,
      createdAt: status.project.createdAt,
      updatedAt: status.project.updatedAt,
      archived: status.project.archived,
      primaryPath: status.project.primaryPath,
      ...(status.project.forkedFrom === undefined ? {} : { forkedFrom: status.project.forkedFrom }),
      ...(status.project.mergedFrom === undefined ? {} : { mergedFrom: status.project.mergedFrom }),
    },
    conventions: status.conventions.slice(-40).reverse().map((entry) => entry.content),
    decisions: status.decisions.slice(0, 3).map((decision) => ({
      id: decision.id,
      status: decision.status,
      decision: decision.decision,
      context: decision.context,
      consequences: decision.consequences,
    })),
    progress: status.progress.slice(-5).reverse(),
    dirs: status.dirs,
    tools: status.tools,
    members: status.members,
    ...(task === undefined ? {} : { task }),
    archivedCounts: { memory: 0, conventions: 0, decisions: 0 },
  }
}
