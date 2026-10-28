/**
 * Types shared by the Host plugin, the browser client, and tests.
 *
 * This module intentionally contains no runtime imports. The browser bundle
 * and the Node host both consume the same wire vocabulary.
 */

export type ProjectId = string

export type RefKind = 'dir' | 'file' | 'tool' | 'plugin' | 'mcp'

export type NoteCategory =
  | 'fact'
  | 'convention'
  | 'decision'
  | 'progress'
  | 'ref-dir'
  | 'ref-file'
  | 'ref-tool'
  | 'ref-plugin'
  | 'ref-mcp'

export type DecisionStatus = 'proposed' | 'accepted' | 'superseded' | 'deprecated'

export type MemberKind = 'directory' | 'session' | 'project'

export type TaskStatus = 'queued' | 'running' | 'interrupted' | 'idle' | 'done' | 'blocked'

export interface ProjectDocument {
  schemaVersion: 1
  id: ProjectId
  name: string
  aliases: string[]
  createdAt: string
  updatedAt: string
  archived: boolean
  primaryPath: string
  forkedFrom?: string
  mergedFrom?: string[]
  tags?: string[]
}

export interface ProjectCounts {
  memory: number
  conventions: number
  decisions: number
  dirs: number
  tools: number
  progress: number
  sessions: number
  tasks: number
  members: number
}

export interface ProjectSummary {
  id: ProjectId
  name: string
  aliases: string[]
  primaryPath: string
  createdAt: string
  updatedAt: string
  archived: boolean
  forkedFrom?: string
  mergedFrom?: string[]
  counts: ProjectCounts
}

export interface DirectoryRef {
  kind: 'dir' | 'file'
  path: string
  purpose: string
  note: string
  addedAt: string
  addedBy: string
}

export interface ToolRef {
  kind: 'tool' | 'plugin' | 'mcp'
  tool: string
  args: string[]
  purpose: string
  note: string
  addedAt: string
  addedBy: string
}

export interface ProgressEntry {
  ts: string
  sessionId: string
  stage: string
  did: string
  next: string
  blocked?: string
  tags: string[]
}

export interface WorkspaceMember {
  id: string
  kind: MemberKind
  path?: string
  sessionId?: string
  projectId?: string
  label: string
  note: string
  addedAt: string
  addedBy: string
}

export interface WorkspacesDocument {
  schemaVersion: 1
  primary: {
    path: string
    label: string
  }
  members: WorkspaceMember[]
}

export interface SessionBinding {
  boundAt: string
  parentSessionId?: string
  workspacePath?: string
  note?: string
}

export interface SessionBindings {
  [sessionId: string]: SessionBinding
}

export interface TaskCheckpoint {
  summary: string
  did: string
  next: string
  blocked: string
  lastTool: string
  pendingTools: string[]
  turn: number
  step: number
  updatedAt: string
}

export interface TaskRecord {
  id: string
  projectId: ProjectId
  sessionId: string
  title: string
  status: TaskStatus
  source: 'system' | 'user'
  priority: number
  createdAt: string
  updatedAt: string
  startedAt?: string
  finishedAt?: string
  checkpoint: TaskCheckpoint
  pendingPrompt?: string
  pendingPromptAddedAt?: string
  tags: string[]
}

export interface ProjectStatus {
  project: ProjectSummary
  memory: Array<{ id: string; content: string; createdAt: string; updatedAt: string }>
  conventions: Array<{ id: string; content: string; createdAt: string; updatedAt: string }>
  decisions: Array<{
    id: string
    date: string
    status: DecisionStatus
    title: string
    context: string
    decision: string
    consequences: string
  }>
  progress: ProgressEntry[]
  dirs: DirectoryRef[]
  tools: ToolRef[]
  sessions: Array<{ sessionId: string; binding: SessionBinding }>
  tasks: TaskRecord[]
  members: WorkspaceMember[]
  estimatedContextTokens: number
  contextBudgetTokens: number
}

export interface ProjectContextResult {
  text: string
  estimatedTokens: number
  truncated: boolean
  projectId?: ProjectId
}

export interface ProjectCreateInput {
  name: string
  aliases?: string[]
  primaryPath: string
  bindSessionId?: string
  actor?: string
}

export interface ProjectCreateResult {
  project: ProjectSummary
  created: boolean
  binding?: SessionBinding
}

export interface ProjectNoteInput {
  project?: string
  category: NoteCategory
  content?: string
  title?: string
  stage?: string
  next?: string
  blocked?: string
  tags?: string[]
  context?: string
  consequences?: string
  status?: DecisionStatus
  path?: string
  tool?: string
  args?: string[]
  purpose?: string
  note?: string
  actor?: string
}

export interface ProjectNoteResult {
  projectId: ProjectId
  category: NoteCategory
  entryId?: string
  deduped: boolean
  archived: number
  summary: string
}

export interface ProjectRefInput {
  project?: string
  kind: RefKind
  path?: string
  tool?: string
  args?: string[]
  purpose: string
  note?: string
  actor?: string
}

export interface ProjectRefResult {
  projectId: ProjectId
  kind: RefKind
  entry: DirectoryRef | ToolRef
  deduped: boolean
  archived: number
}

export interface ProjectUseResult {
  project: ProjectSummary
  binding: SessionBinding
  estimatedContextTokens: number
  contextBudgetTokens: number
}

export interface ProjectInsertInput {
  project: string
  kind: MemberKind
  path?: string
  sessionId?: string
  targetProjectId?: string
  label?: string
  note?: string
  actor?: string
}

export interface ProjectInsertResult {
  projectId: ProjectId
  member: WorkspaceMember
  deduped: boolean
}

export interface ProjectForkInput {
  project: string
  name?: string
  aliases?: string[]
  bindSessionId?: string
  actor?: string
}

export interface ProjectForkResult {
  sourceProjectId: ProjectId
  project: ProjectSummary
}

export interface ProjectMergeInput {
  source: string
  target: string
  deleteSource?: boolean
  purgeSource?: boolean
  actor?: string
}

export interface ProjectMergeResult {
  sourceProjectId: ProjectId
  targetProjectId: ProjectId
  sourceRetained: boolean
  merged: ProjectCounts
}

export interface ProjectDeleteInput {
  project: string
  mode?: 'trash' | 'purge'
  actor?: string
}

export interface ProjectDeleteResult {
  projectId: ProjectId
  mode: 'trash' | 'purge'
  trashPath?: string
}

export interface ProjectTaskInput {
  project?: string
  sessionId?: string
  action: 'list' | 'checkpoint' | 'interrupt' | 'resume' | 'done' | 'blocked'
  title?: string
  prompt?: string
  summary?: string
  next?: string
  blocked?: string
  tags?: string[]
  actor?: string
}

export interface ProjectTaskResult {
  projectId: ProjectId
  task: TaskRecord
  tasks: TaskRecord[]
}

export type RpcEndpoint =
  | 'list'
  | 'status'
  | 'create'
  | 'delete'
  | 'fork'
  | 'merge'
  | 'insert'
  | 'remove-member'
  | 'ref'
  | 'note'
  | 'bind'
  | 'task'
  | 'context'

export interface RpcBindingResult {
  sessionId: string
  projectId: ProjectId
  binding: SessionBinding
}

export interface RpcContextResult {
  sessionId: string
  projectId?: ProjectId
  context: ProjectContextResult
}

export interface ProjectFlowConfigInput {
  /** Absolute path replacing `$DSH_HOME/projects`. Intended for tests and special deployments. */
  projectsDir?: string
  /** Hard token budget for the per-turn project section. */
  contextBudgetTokens?: number
  /** Cross-process lock acquisition budget. */
  lockWaitMs?: number
  /** Enable the experimental task checkpoint projection. Default true. */
  taskTracking?: boolean
  /** Enable the browser RPC bridge. Default true when a connection service exists. */
  rpc?: boolean
  limits?: Partial<ProjectLimits>
}

export interface ProjectLimits {
  memoryBytes: number
  conventionsBytes: number
  decisionsBytes: number
  progressLines: number
  progressBytes: number
  refsEntries: number
  sessionsEntries: number
  tasksEntries: number
  taskEventsLines: number
  memoryEntryBytes: number
  conventionEntryBytes: number
  decisionEntryBytes: number
  progressLineBytes: number
  refNoteBytes: number
  archiveRatio: number
}
