import * as React from 'react'
import type {
  ProjectStatus,
  ProjectSummary,
  WorkspaceMember,
} from '../shared/contracts.js'
import { callProjectflow, type ClientPanelApi } from './api.js'

const NS = 'projectflow'

const en: Record<string, string> = {
  'panel.title': 'Project workspaces',
  'panel.subtitle': 'Project-first context and task state, independent of the current folder.',
  'panel.create': 'New project',
  'panel.refresh': 'Refresh',
  'panel.empty': 'No project workspaces yet. Create one to start a project-first session.',
  'panel.loading': 'Loading projects…',
  'panel.open': 'Open',
  'panel.fork': 'Fork',
  'panel.merge': 'Merge',
  'panel.insert': 'Insert',
  'panel.refs': 'Refs',
  'panel.delete': 'Delete',
  'panel.details': 'Details',
  'panel.hide': 'Hide details',
  'panel.cancel': 'Cancel',
  'panel.save': 'Save',
  'panel.name': 'Name',
  'panel.aliases': 'Aliases (comma separated)',
  'panel.path': 'Primary directory (absolute)',
  'panel.forkPrompt': 'Name for the forked project',
  'panel.deleteConfirm': 'Move this project to $DSH_HOME/projects/.trash? Its directory is not deleted.',
  'panel.mergeTitle': 'Merge project',
  'panel.source': 'Source',
  'panel.target': 'Target',
  'panel.deleteSource': 'Move source to trash after merge',
  'panel.insertTitle': 'Insert workspace member',
  'panel.kind': 'Kind',
  'panel.targetLabel': 'Target',
  'panel.label': 'Label',
  'panel.refTitle': 'Add reference',
  'panel.purpose': 'Purpose',
  'panel.note': 'Note',
  'panel.task': 'Task',
  'panel.noStatus': 'Open Details to inspect records.',
  'panel.conventions': 'Conventions',
  'panel.decisions': 'Decisions',
  'panel.progress': 'Progress',
  'panel.members': 'Workspace members',
  'panel.dirRefs': 'Directory / file refs',
  'panel.toolRefs': 'Tool / plugin / MCP refs',
  'panel.sessionRefs': 'Bound sessions',
  'panel.tasks': 'Tasks',
  'panel.addNote': 'Add note',
  'panel.checkpoint': 'Checkpoint',
  'panel.interrupt': 'Interrupt + system prompt',
  'panel.resume': 'Resume',
  'panel.done': 'Done',
  'panel.primary': 'Primary',
  'panel.sidebar': 'Projects',
  'panel.footer': 'Project workspaces',
  'panel.openSession': 'Open project session',
  'panel.error': 'Operation failed',
  'panel.eta': 'Context',
  'panel.archived': 'archived',
  'panel.forkedFrom': 'forked from',
  'panel.directory': 'Directory',
  'panel.session': 'Session',
  'panel.project': 'Project',
  'panel.refDir': 'Directory',
  'panel.refFile': 'File',
  'panel.refTool': 'Tool',
  'panel.refPlugin': 'Plugin',
  'panel.refMcp': 'MCP',
  'panel.noteFact': 'Fact',
  'panel.noteConvention': 'Convention',
  'panel.noteDecision': 'Decision',
  'panel.noteProgress': 'Progress',
  'panel.stage': 'Stage',
  'panel.next': 'Next',
  'panel.content': 'Content',
  'panel.mergeHint': 'Choose another project to receive this project’s records and references.',
  'panel.insertHint': 'Insert a directory, a DSH session, or another project as a member. Nothing is copied.',
  'panel.refHint': 'Only metadata is stored. Files, tool code, and MCP prototypes are never copied.',
  'panel.createHint': 'The primary directory is the workspace this project opens into. Data stays under $DSH_HOME.',
}

const zh: Record<string, string> = {
  'panel.title': '项目工作区',
  'panel.subtitle': '以项目为核心的上下文与任务状态，不随当前目录变化。',
  'panel.create': '新建项目',
  'panel.refresh': '刷新',
  'panel.empty': '还没有项目工作区。创建一个，开始项目优先的会话。',
  'panel.loading': '正在加载项目…',
  'panel.open': '打开',
  'panel.fork': 'Fork',
  'panel.merge': '合并',
  'panel.insert': '插入',
  'panel.refs': '引用',
  'panel.delete': '删除',
  'panel.details': '详情',
  'panel.hide': '收起详情',
  'panel.cancel': '取消',
  'panel.save': '保存',
  'panel.name': '名称',
  'panel.aliases': '别名（逗号分隔）',
  'panel.path': '主目录（绝对路径）',
  'panel.forkPrompt': 'Fork 出的项目名称',
  'panel.deleteConfirm': '将此项目移动到 $DSH_HOME/projects/.trash？不会删除它的目录。',
  'panel.mergeTitle': '合并项目',
  'panel.source': '来源',
  'panel.target': '目标',
  'panel.deleteSource': '合并后将来源移入回收站',
  'panel.insertTitle': '插入工作区成员',
  'panel.kind': '类型',
  'panel.targetLabel': '目标',
  'panel.label': '标签',
  'panel.refTitle': '添加引用',
  'panel.purpose': '用途',
  'panel.note': '备注',
  'panel.task': '任务',
  'panel.noStatus': '打开详情查看记录。',
  'panel.conventions': '约定',
  'panel.decisions': '决策',
  'panel.progress': '进展',
  'panel.members': '工作区成员',
  'panel.dirRefs': '目录/文件引用',
  'panel.toolRefs': '工具/插件/MCP 引用',
  'panel.sessionRefs': '已绑定会话',
  'panel.tasks': '任务',
  'panel.addNote': '添加记录',
  'panel.checkpoint': '记录检查点',
  'panel.interrupt': '中断并注入系统提示词',
  'panel.resume': '恢复',
  'panel.done': '完成',
  'panel.primary': '主目录',
  'panel.sidebar': '项目',
  'panel.footer': '项目工作区',
  'panel.openSession': '打开项目会话',
  'panel.error': '操作失败',
  'panel.eta': '上下文',
  'panel.archived': '已归档',
  'panel.forkedFrom': 'Fork 自',
  'panel.directory': '目录',
  'panel.session': '会话',
  'panel.project': '项目',
  'panel.refDir': '目录',
  'panel.refFile': '文件',
  'panel.refTool': '工具',
  'panel.refPlugin': '插件',
  'panel.refMcp': 'MCP',
  'panel.noteFact': '事实',
  'panel.noteConvention': '约定',
  'panel.noteDecision': '决策',
  'panel.noteProgress': '进展',
  'panel.stage': '阶段',
  'panel.next': '下一步',
  'panel.content': '内容',
  'panel.mergeHint': '选择另一个项目接收本项目的记录和引用。',
  'panel.insertHint': '把目录、DSH 会话或另一个项目作为成员插入，不复制任何内容。',
  'panel.refHint': '只保存元数据，绝不复制文件、工具代码或 MCP 原型。',
  'panel.createHint': '主目录是这个项目打开时使用的 workspace；数据仍保存在 $DSH_HOME。',
}

interface FooterInjected {
  openPanel(): void
  t(key: string): string
}

function FooterButton({ wide, openPanel, t }: { wide?: boolean; openPanel: () => void; t: (key: string) => string }) {
  return (
    <button
      type="button"
      onClick={openPanel}
      title={t('panel.footer')}
      aria-label={t('panel.footer')}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        width: wide === false ? 32 : 'auto',
        height: wide === false ? 32 : 36,
        padding: wide === false ? 0 : '0 4px',
        justifyContent: wide === false ? 'center' : 'flex-start',
        border: 'none',
        borderRadius: 8,
        background: 'transparent',
        color: wide === false
          ? 'var(--dsh-text-secondary, #888)'
          : 'var(--dsw-alias-label-tertiary, var(--dsh-text-tertiary, #777))',
        cursor: 'pointer',
        font: 'inherit',
        fontSize: wide === false ? 12 : 14,
        fontWeight: 400,
        lineHeight: '20px',
      }}
    >
      <ProjectIcon />
      {wide === false ? null : <span>{t('panel.footer')}</span>}
    </button>
  )
}

function ProjectIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2.5 4.25A1.25 1.25 0 0 1 3.75 3h2.1l1.1 1.35h5.3a1.25 1.25 0 0 1 1.25 1.25v6.15A1.25 1.25 0 0 1 12.25 13h-8.5A1.25 1.25 0 0 1 2.5 11.75V4.25Z" stroke="currentColor" strokeWidth="1.2" />
      <path d="M5.2 8.2h5.6M5.2 10.3h3.8" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  )
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      padding: '2px 7px',
      borderRadius: 999,
      background: 'var(--dsh-surface-subtle, rgba(127,127,127,0.12))',
      color: 'var(--dsh-text-tertiary, #777)',
      fontSize: 11,
      whiteSpace: 'nowrap',
    }}>{children}</span>
  )
}

function Button({
  children,
  onClick,
  variant = 'default',
  disabled,
}: {
  children: React.ReactNode
  onClick?: () => void
  variant?: 'default' | 'primary' | 'danger'
  disabled?: boolean
}) {
  const primary = variant === 'primary'
  const danger = variant === 'danger'
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{
        padding: '6px 11px',
        borderRadius: 8,
        border: `1px solid ${primary ? 'transparent' : danger ? 'var(--dsh-danger-border, #a44)' : 'var(--dsh-border, rgba(127,127,127,0.25))'}`,
        background: primary ? 'var(--dsh-accent, #4f7cff)' : danger ? 'transparent' : 'var(--dsh-surface, transparent)',
        color: primary ? '#fff' : danger ? 'var(--dsh-danger, #c44)' : 'var(--dsh-text, inherit)',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        font: 'inherit',
        fontSize: 12,
        lineHeight: '16px',
      }}
    >{children}</button>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--dsh-text-secondary, #777)' }}>
      <span>{label}</span>
      {children}
    </label>
  )
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      style={{
        boxSizing: 'border-box',
        width: '100%',
        padding: '7px 9px',
        borderRadius: 7,
        border: '1px solid var(--dsh-border, rgba(127,127,127,0.25))',
        background: 'var(--dsh-input-bg, transparent)',
        color: 'var(--dsh-text, inherit)',
        font: 'inherit',
        fontSize: 13,
        ...props.style,
      }}
    />
  )
}

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      style={{
        boxSizing: 'border-box',
        width: '100%',
        padding: '7px 9px',
        borderRadius: 7,
        border: '1px solid var(--dsh-border, rgba(127,127,127,0.25))',
        background: 'var(--dsh-input-bg, transparent)',
        color: 'var(--dsh-text, inherit)',
        font: 'inherit',
        fontSize: 13,
        ...props.style,
      }}
    />
  )
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 1000,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'rgba(0,0,0,0.35)',
      padding: 24,
    }} onClick={onClose}>
      <div
        onClick={(event) => event.stopPropagation()}
        style={{
          width: 'min(560px, 100%)',
          maxHeight: '80vh',
          overflow: 'auto',
          borderRadius: 14,
          border: '1px solid var(--dsh-border, rgba(127,127,127,0.25))',
          background: 'var(--dsh-surface-raised, var(--dsh-surface, #fff))',
          color: 'var(--dsh-text, inherit)',
          padding: 20,
          boxShadow: '0 18px 60px rgba(0,0,0,0.25)',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <strong style={{ fontSize: 15 }}>{title}</strong>
          <Button onClick={onClose}>×</Button>
        </div>
        {children}
      </div>
    </div>
  )
}

function SummaryCard({
  project,
  t,
  onOpen,
  onFork,
  onMerge,
  onInsert,
  onRef,
  onDelete,
  onDetails,
  expanded,
}: {
  project: ProjectSummary
  t: (key: string) => string
  onOpen: () => void
  onFork: () => void
  onMerge: () => void
  onInsert: () => void
  onRef: () => void
  onDelete: () => void
  onDetails: () => void
  expanded: boolean
}) {
  return (
    <section style={{
      border: '1px solid var(--dsh-border, rgba(127,127,127,0.22))',
      borderRadius: 12,
      padding: 14,
      background: 'var(--dsh-surface, transparent)',
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <ProjectIcon size={18} />
            <strong style={{ fontSize: 14 }}>{project.name}</strong>
            {project.archived ? <Chip>{t('panel.archived')}</Chip> : null}
            {project.forkedFrom === undefined ? null : <Chip>{t('panel.forkedFrom')} {project.forkedFrom.slice(0, 12)}</Chip>}
          </div>
          <div style={{ marginTop: 4, fontSize: 12, color: 'var(--dsh-text-tertiary, #777)', wordBreak: 'break-all' }}>
            {project.id} · {project.primaryPath}
          </div>
          {project.aliases.length === 0 ? null : (
            <div style={{ marginTop: 3, fontSize: 11, color: 'var(--dsh-text-tertiary, #777)' }}>
              {project.aliases.join(' · ')}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <Button variant="primary" onClick={onOpen}>{t('panel.open')}</Button>
          <Button onClick={onDetails}>{expanded ? t('panel.hide') : t('panel.details')}</Button>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <Chip>{project.counts.conventions} {t('panel.conventions')}</Chip>
        <Chip>{project.counts.decisions} {t('panel.decisions')}</Chip>
        <Chip>{project.counts.progress} {t('panel.progress')}</Chip>
        <Chip>{project.counts.members} {t('panel.members')}</Chip>
        <Chip>{project.counts.dirs + project.counts.tools} {t('panel.refs')}</Chip>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <Button onClick={onFork}>{t('panel.fork')}</Button>
        <Button onClick={onMerge}>{t('panel.merge')}</Button>
        <Button onClick={onInsert}>{t('panel.insert')}</Button>
        <Button onClick={onRef}>{t('panel.refs')}</Button>
        <Button variant="danger" onClick={onDelete}>{t('panel.delete')}</Button>
      </div>
    </section>
  )
}

function ProjectPanel({ api, t }: { api: ClientPanelApi; t: (key: string) => string }) {
  const [projects, setProjects] = React.useState<ProjectSummary[]>([])
  const [invalid, setInvalid] = React.useState<Array<{ id: string; error: string }>>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | undefined>()
  const [expanded, setExpanded] = React.useState<string | undefined>()
  const [status, setStatus] = React.useState<ProjectStatus | undefined>()
  const [dialog, setDialog] = React.useState<'create' | 'merge' | 'insert' | 'ref' | 'note' | 'fork' | 'delete' | undefined>()
  const [targetProject, setTargetProject] = React.useState<ProjectSummary | undefined>()
  const [busy, setBusy] = React.useState(false)

  const refresh = React.useCallback(async () => {
    setLoading(true)
    setError(undefined)
    try {
      const result = await api.list()
      setProjects(result.projects)
      setInvalid(result.invalid)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setLoading(false)
    }
  }, [api])

  React.useEffect(() => { void refresh() }, [refresh])

  const openStatus = async (project: ProjectSummary) => {
    if (expanded === project.id) {
      setExpanded(undefined)
      setStatus(undefined)
      return
    }
    setExpanded(project.id)
    setStatus(undefined)
    try {
      setStatus(await api.status(project.id))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  const run = async (operation: () => Promise<unknown>) => {
    setBusy(true)
    setError(undefined)
    try {
      await operation()
      await refresh()
      if (expanded !== undefined) {
        setStatus(await api.status(expanded))
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  const open = async (project: ProjectSummary) => {
    setBusy(true)
    setError(undefined)
    try {
      await api.enter(project)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  const fork = (project: ProjectSummary) => {
    setTargetProject(project)
    setDialog('fork')
  }

  const remove = (project: ProjectSummary) => {
    setTargetProject(project)
    setDialog('delete')
  }

  return (
    <div style={{
      height: '100%',
      overflow: 'auto',
      boxSizing: 'border-box',
      padding: 'calc(var(--dsh-frame-top-clearance, 0px) + 24px) 24px 48px',
      color: 'var(--dsh-text, inherit)',
    }}>
      <header style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 18 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <ProjectIcon size={22} />
            <h2 style={{ margin: 0, fontSize: 19, letterSpacing: '-0.01em' }}>{t('panel.title')}</h2>
          </div>
          <p style={{ margin: '5px 0 0', fontSize: 12, color: 'var(--dsh-text-tertiary, #777)', maxWidth: 680 }}>
            {t('panel.subtitle')}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button onClick={() => { void refresh() }}>{t('panel.refresh')}</Button>
          <Button variant="primary" onClick={() => setDialog('create')}>{t('panel.create')}</Button>
        </div>
      </header>
      {error === undefined ? null : (
        <div style={{ marginBottom: 12, padding: '9px 12px', borderRadius: 9, background: 'rgba(200,60,60,0.12)', color: 'var(--dsh-danger, #c44)', fontSize: 12 }}>
          {t('panel.error')}: {error}
        </div>
      )}
      {invalid.length === 0 ? null : (
        <div style={{ marginBottom: 12, fontSize: 12, color: 'var(--dsh-text-tertiary, #777)' }}>
          Skipped {invalid.length} unreadable project(s): {invalid.map((item) => item.id).join(', ')}
        </div>
      )}
      {loading ? (
        <div style={{ padding: 24, color: 'var(--dsh-text-tertiary, #777)', fontSize: 13 }}>{t('panel.loading')}</div>
      ) : projects.length === 0 ? (
        <div style={{
          padding: 36,
          borderRadius: 12,
          border: '1px dashed var(--dsh-border, rgba(127,127,127,0.3))',
          textAlign: 'center',
          color: 'var(--dsh-text-tertiary, #777)',
          fontSize: 13,
        }}>{t('panel.empty')}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {projects.map((project) => (
            <React.Fragment key={project.id}>
              <SummaryCard
                project={project}
                t={t}
                expanded={expanded === project.id}
                onOpen={() => { void open(project) }}
                onFork={() => fork(project)}
                onMerge={() => { setTargetProject(project); setDialog('merge') }}
                onInsert={() => { setTargetProject(project); setDialog('insert') }}
                onRef={() => { setTargetProject(project); setDialog('ref') }}
                onDelete={() => remove(project)}
                onDetails={() => { void openStatus(project) }}
              />
              {expanded === project.id && status !== undefined ? (
                <StatusDetails
                  status={status}
                  t={t}
                  onAddNote={() => { setTargetProject(project); setDialog('note') }}
                  onTask={async (action) => {
                    await run(() => api.task(project.id, status.sessions[0]?.sessionId ?? 'ui', action))
                  }}
                />
              ) : null}
            </React.Fragment>
          ))}
        </div>
      )}
      {busy ? <div style={{ position: 'fixed', right: 22, bottom: 22, padding: '8px 12px', borderRadius: 9, background: 'var(--dsh-surface-raised, #fff)', border: '1px solid var(--dsh-border, rgba(127,127,127,0.25))', fontSize: 12 }}>…</div> : null}
      {dialog === 'create' ? (
        <CreateDialog
          t={t}
          onClose={() => setDialog(undefined)}
          onSubmit={async (input) => {
            await run(() => api.create(input))
            setDialog(undefined)
          }}
        />
      ) : null}
      {dialog === 'fork' && targetProject !== undefined ? (
        <ForkDialog
          t={t}
          project={targetProject}
          onClose={() => setDialog(undefined)}
          onSubmit={async (name) => {
            await run(() => api.fork(targetProject.id, name))
            setDialog(undefined)
          }}
        />
      ) : null}
      {dialog === 'delete' && targetProject !== undefined ? (
        <DeleteDialog
          t={t}
          project={targetProject}
          onClose={() => setDialog(undefined)}
          onSubmit={async () => {
            await run(() => api.remove(targetProject.id))
            setDialog(undefined)
          }}
        />
      ) : null}
      {dialog === 'merge' && targetProject !== undefined ? (
        <MergeDialog
          t={t}
          project={targetProject}
          projects={projects}
          onClose={() => setDialog(undefined)}
          onSubmit={async (source, deleteSource) => {
            await run(() => api.merge(source, targetProject.id, deleteSource))
            setDialog(undefined)
          }}
        />
      ) : null}
      {dialog === 'insert' && targetProject !== undefined ? (
        <InsertDialog
          t={t}
          project={targetProject}
          projects={projects}
          sessions={api.listSessions()}
          onClose={() => setDialog(undefined)}
          onSubmit={async (input) => {
            await run(() => api.insert({ project: targetProject.id, ...input }))
            setDialog(undefined)
          }}
        />
      ) : null}
      {dialog === 'ref' && targetProject !== undefined ? (
        <RefDialog
          t={t}
          project={targetProject}
          onClose={() => setDialog(undefined)}
          onSubmit={async (input) => {
            await run(() => api.ref({ project: targetProject.id, ...input }))
            setDialog(undefined)
          }}
        />
      ) : null}
      {dialog === 'note' && targetProject !== undefined ? (
        <NoteDialog
          t={t}
          project={targetProject}
          onClose={() => setDialog(undefined)}
          onSubmit={async (input) => {
            await run(() => api.note({ project: targetProject.id, ...input }))
            setDialog(undefined)
          }}
        />
      ) : null}
    </div>
  )
}

function StatusDetails({
  status,
  t,
  onAddNote,
  onTask,
}: {
  status: ProjectStatus
  t: (key: string) => string
  onAddNote: () => void
  onTask: (action: 'checkpoint' | 'interrupt' | 'resume' | 'done' | 'list') => Promise<void>
}) {
  const latest = status.progress[0]
  return (
    <div style={{
      border: '1px solid var(--dsh-border, rgba(127,127,127,0.22))',
      borderRadius: 12,
      padding: 14,
      marginTop: -4,
      background: 'var(--dsh-surface-subtle, rgba(127,127,127,0.04))',
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
    }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <Chip>{t('panel.eta')} ~{status.estimatedContextTokens}/{status.contextBudgetTokens}</Chip>
        <Chip>{status.project.primaryPath}</Chip>
        <Button onClick={onAddNote}>{t('panel.addNote')}</Button>
        <Button onClick={() => { void onTask('checkpoint') }}>{t('panel.checkpoint')}</Button>
        <Button onClick={() => { void onTask('interrupt') }}>{t('panel.interrupt')}</Button>
        <Button onClick={() => { void onTask('resume') }}>{t('panel.resume')}</Button>
        <Button onClick={() => { void onTask('done') }}>{t('panel.done')}</Button>
      </div>
      {latest === undefined ? <div style={{ fontSize: 12, color: 'var(--dsh-text-tertiary, #777)' }}>{t('panel.noStatus')}</div> : (
        <div style={{ fontSize: 12, lineHeight: 1.6 }}>
          <div><strong>{t('panel.progress')}</strong> [{latest.stage}] {latest.did}</div>
          <div style={{ color: 'var(--dsh-text-tertiary, #777)' }}>{t('panel.next')}: {latest.next}{latest.blocked === undefined ? '' : ` · ${latest.blocked}`}</div>
        </div>
      )}
      {status.conventions.length > 0 ? (
        <section>
          <strong style={{ fontSize: 12 }}>{t('panel.conventions')}</strong>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 12, lineHeight: 1.6 }}>
            {status.conventions.map((entry) => <li key={entry.id}>{entry.content}</li>)}
          </ul>
        </section>
      ) : null}
      {status.decisions.length > 0 ? (
        <section>
          <strong style={{ fontSize: 12 }}>{t('panel.decisions')}</strong>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 12, lineHeight: 1.6 }}>
            {status.decisions.map((entry) => <li key={entry.id}><strong>{entry.id}</strong> [{entry.status}] {entry.decision}</li>)}
          </ul>
        </section>
      ) : null}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        <RefList title={t('panel.dirRefs')} items={status.dirs.map((ref) => `${ref.kind}: ${ref.path} — ${ref.purpose}`)} />
        <RefList title={t('panel.toolRefs')} items={status.tools.map((ref) => `${ref.kind}: ${ref.tool} — ${ref.purpose}`)} />
        <RefList title={t('panel.members')} items={status.members.map((member: WorkspaceMember) => `${member.kind}: ${member.label}`)} />
        <RefList title={t('panel.sessionRefs')} items={status.sessions.map((session) => `${session.sessionId} · ${session.binding.boundAt}`)} />
        <RefList title={t('panel.tasks')} items={status.tasks.map((task) => `${task.id} [${task.status}] ${task.title}`)} />
      </div>
    </div>
  )
}

function RefList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null
  return (
    <section>
      <strong style={{ fontSize: 12 }}>{title}</strong>
      <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 11, lineHeight: 1.6, color: 'var(--dsh-text-secondary, #777)' }}>
        {items.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}
      </ul>
    </section>
  )
}

function CreateDialog({
  t,
  onClose,
  onSubmit,
}: {
  t: (key: string) => string
  onClose: () => void
  onSubmit: (input: { name: string; aliases: string[]; primaryPath: string }) => Promise<void>
}) {
  const [name, setName] = React.useState('')
  const [aliases, setAliases] = React.useState('')
  const [path, setPath] = React.useState('')
  const [error, setError] = React.useState<string | undefined>()
  return (
    <Modal title={t('panel.create')} onClose={onClose}>
      <p style={{ margin: 0, fontSize: 12, color: 'var(--dsh-text-tertiary, #777)' }}>{t('panel.createHint')}</p>
      <Field label={t('panel.name')}><Input value={name} onChange={(event) => setName(event.target.value)} autoFocus /></Field>
      <Field label={t('panel.aliases')}><Input value={aliases} onChange={(event) => setAliases(event.target.value)} placeholder="pf, projectflow" /></Field>
      <Field label={t('panel.path')}><Input value={path} onChange={(event) => setPath(event.target.value)} placeholder="/Users/me/src/project" /></Field>
      {error === undefined ? null : <div style={{ fontSize: 12, color: 'var(--dsh-danger, #c44)' }}>{error}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <Button onClick={onClose}>{t('panel.cancel')}</Button>
        <Button
          variant="primary"
          onClick={() => {
            setError(undefined)
            if (name.trim() === '' || path.trim() === '') {
              setError('Name and primary directory are required.')
              return
            }
            void onSubmit({
              name: name.trim(),
              aliases: aliases.split(',').map((alias) => alias.trim()).filter((alias) => alias !== ''),
              primaryPath: path.trim(),
            }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
          }}
        >{t('panel.save')}</Button>
      </div>
    </Modal>
  )
}

function ForkDialog({
  t,
  project,
  onClose,
  onSubmit,
}: {
  t: (key: string) => string
  project: ProjectSummary
  onClose: () => void
  onSubmit: (name: string) => Promise<void>
}) {
  const [name, setName] = React.useState(`${project.name} fork`)
  const [error, setError] = React.useState<string | undefined>()
  return (
    <Modal title={`${t('panel.fork')}: ${project.name}`} onClose={onClose}>
      <Field label={t('panel.forkPrompt')}>
        <Input value={name} onChange={(event) => setName(event.target.value)} autoFocus />
      </Field>
      {error === undefined ? null : <div style={{ fontSize: 12, color: 'var(--dsh-danger, #c44)' }}>{error}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <Button onClick={onClose}>{t('panel.cancel')}</Button>
        <Button variant="primary" onClick={() => {
          if (name.trim() === '') { setError('Name is required.'); return }
          void onSubmit(name.trim()).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
        }}>{t('panel.fork')}</Button>
      </div>
    </Modal>
  )
}

function DeleteDialog({
  t,
  project,
  onClose,
  onSubmit,
}: {
  t: (key: string) => string
  project: ProjectSummary
  onClose: () => void
  onSubmit: () => Promise<void>
}) {
  const [error, setError] = React.useState<string | undefined>()
  return (
    <Modal title={`${t('panel.delete')}: ${project.name}`} onClose={onClose}>
      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6 }}>{t('panel.deleteConfirm')}</p>
      <p style={{ margin: 0, fontSize: 11, color: 'var(--dsh-text-tertiary, #777)' }}>{project.id} · {project.primaryPath}</p>
      {error === undefined ? null : <div style={{ fontSize: 12, color: 'var(--dsh-danger, #c44)' }}>{error}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <Button onClick={onClose}>{t('panel.cancel')}</Button>
        <Button variant="danger" onClick={() => {
          void onSubmit().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
        }}>{t('panel.delete')}</Button>
      </div>
    </Modal>
  )
}

function MergeDialog({
  t,
  project,
  projects,
  onClose,
  onSubmit,
}: {
  t: (key: string) => string
  project: ProjectSummary
  projects: ProjectSummary[]
  onClose: () => void
  onSubmit: (source: string, deleteSource: boolean) => Promise<void>
}) {
  const [source, setSource] = React.useState(projects.find((item) => item.id !== project.id)?.id ?? '')
  const [deleteSource, setDeleteSource] = React.useState(false)
  const [error, setError] = React.useState<string | undefined>()
  return (
    <Modal title={`${t('panel.mergeTitle')}: ${project.name}`} onClose={onClose}>
      <p style={{ margin: 0, fontSize: 12, color: 'var(--dsh-text-tertiary, #777)' }}>{t('panel.mergeHint')}</p>
      <Field label={t('panel.source')}>
        <Select value={source} onChange={(event) => setSource(event.target.value)}>
          {projects.filter((item) => item.id !== project.id).map((item) => (
            <option key={item.id} value={item.id}>{item.name} ({item.id})</option>
          ))}
        </Select>
      </Field>
      <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12 }}>
        <input type="checkbox" checked={deleteSource} onChange={(event) => setDeleteSource(event.target.checked)} />
        {t('panel.deleteSource')}
      </label>
      {error === undefined ? null : <div style={{ fontSize: 12, color: 'var(--dsh-danger, #c44)' }}>{error}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <Button onClick={onClose}>{t('panel.cancel')}</Button>
        <Button variant="primary" onClick={() => {
          if (source === '') { setError('No source project available.'); return }
          void onSubmit(source, deleteSource).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
        }}>{t('panel.merge')}</Button>
      </div>
    </Modal>
  )
}

function InsertDialog({
  t,
  project,
  projects,
  sessions,
  onClose,
  onSubmit,
}: {
  t: (key: string) => string
  project: ProjectSummary
  projects: ProjectSummary[]
  sessions: Array<{ id: string; title: string; cwd: string }>
  onClose: () => void
  onSubmit: (input: { kind: 'directory' | 'session' | 'project'; path?: string; sessionId?: string; targetProjectId?: string; label?: string }) => Promise<void>
}) {
  const [kind, setKind] = React.useState<'directory' | 'session' | 'project'>('directory')
  const [target, setTarget] = React.useState('')
  const [label, setLabel] = React.useState('')
  const [error, setError] = React.useState<string | undefined>()
  return (
    <Modal title={`${t('panel.insertTitle')}: ${project.name}`} onClose={onClose}>
      <p style={{ margin: 0, fontSize: 12, color: 'var(--dsh-text-tertiary, #777)' }}>{t('panel.insertHint')}</p>
      <Field label={t('panel.kind')}>
        <Select value={kind} onChange={(event) => { setKind(event.target.value as typeof kind); setTarget('') }}>
          <option value="directory">{t('panel.directory')}</option>
          <option value="session">{t('panel.session')}</option>
          <option value="project">{t('panel.project')}</option>
        </Select>
      </Field>
      <Field label={t('panel.targetLabel')}>
        {kind === 'directory' ? (
          <Input value={target} onChange={(event) => setTarget(event.target.value)} placeholder="/absolute/path" />
        ) : kind === 'session' ? (
          <Select value={target} onChange={(event) => setTarget(event.target.value)}>
            <option value="">Select a session…</option>
            {sessions.map((session) => <option key={session.id} value={session.id}>{session.title || session.id} — {session.cwd}</option>)}
          </Select>
        ) : (
          <Select value={target} onChange={(event) => setTarget(event.target.value)}>
            <option value="">Select a project…</option>
            {projects.filter((item) => item.id !== project.id).map((item) => <option key={item.id} value={item.id}>{item.name} ({item.id})</option>)}
          </Select>
        )}
      </Field>
      <Field label={t('panel.label')}><Input value={label} onChange={(event) => setLabel(event.target.value)} /></Field>
      {error === undefined ? null : <div style={{ fontSize: 12, color: 'var(--dsh-danger, #c44)' }}>{error}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <Button onClick={onClose}>{t('panel.cancel')}</Button>
        <Button variant="primary" onClick={() => {
          if (target === '') { setError('Select a target.'); return }
          void onSubmit({
            kind,
            ...(kind === 'directory' ? { path: target } : kind === 'session' ? { sessionId: target } : { targetProjectId: target }),
            ...(label.trim() === '' ? {} : { label: label.trim() }),
          }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
        }}>{t('panel.insert')}</Button>
      </div>
    </Modal>
  )
}

function RefDialog({
  t,
  project,
  onClose,
  onSubmit,
}: {
  t: (key: string) => string
  project: ProjectSummary
  onClose: () => void
  onSubmit: (input: { kind: 'dir' | 'file' | 'tool' | 'plugin' | 'mcp'; path?: string; tool?: string; purpose: string; note?: string }) => Promise<void>
}) {
  const [kind, setKind] = React.useState<'dir' | 'file' | 'tool' | 'plugin' | 'mcp'>('dir')
  const [target, setTarget] = React.useState('')
  const [purpose, setPurpose] = React.useState('')
  const [note, setNote] = React.useState('')
  const [error, setError] = React.useState<string | undefined>()
  return (
    <Modal title={`${t('panel.refTitle')}: ${project.name}`} onClose={onClose}>
      <p style={{ margin: 0, fontSize: 12, color: 'var(--dsh-text-tertiary, #777)' }}>{t('panel.refHint')}</p>
      <Field label={t('panel.kind')}>
        <Select value={kind} onChange={(event) => { setKind(event.target.value as typeof kind); setTarget('') }}>
          <option value="dir">{t('panel.refDir')}</option>
          <option value="file">{t('panel.refFile')}</option>
          <option value="tool">{t('panel.refTool')}</option>
          <option value="plugin">{t('panel.refPlugin')}</option>
          <option value="mcp">{t('panel.refMcp')}</option>
        </Select>
      </Field>
      <Field label={t('panel.targetLabel')}><Input value={target} onChange={(event) => setTarget(event.target.value)} placeholder={kind === 'dir' || kind === 'file' ? '/absolute/path' : 'grep / dsh-mnemon / filesystem'} /></Field>
      <Field label={t('panel.purpose')}><Input value={purpose} onChange={(event) => setPurpose(event.target.value)} /></Field>
      <Field label={t('panel.note')}><Input value={note} onChange={(event) => setNote(event.target.value)} /></Field>
      {error === undefined ? null : <div style={{ fontSize: 12, color: 'var(--dsh-danger, #c44)' }}>{error}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <Button onClick={onClose}>{t('panel.cancel')}</Button>
        <Button variant="primary" onClick={() => {
          if (target.trim() === '' || purpose.trim() === '') { setError('Target and purpose are required.'); return }
          void onSubmit({
            kind,
            ...(kind === 'dir' || kind === 'file' ? { path: target.trim() } : { tool: target.trim() }),
            purpose: purpose.trim(),
            ...(note.trim() === '' ? {} : { note: note.trim() }),
          }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
        }}>{t('panel.save')}</Button>
      </div>
    </Modal>
  )
}

function NoteDialog({
  t,
  project,
  onClose,
  onSubmit,
}: {
  t: (key: string) => string
  project: ProjectSummary
  onClose: () => void
  onSubmit: (input: { category: 'fact' | 'convention' | 'decision' | 'progress'; content: string; stage?: string; next?: string }) => Promise<void>
}) {
  const [category, setCategory] = React.useState<'fact' | 'convention' | 'decision' | 'progress'>('convention')
  const [content, setContent] = React.useState('')
  const [stage, setStage] = React.useState('')
  const [next, setNext] = React.useState('')
  const [error, setError] = React.useState<string | undefined>()
  return (
    <Modal title={`${t('panel.addNote')}: ${project.name}`} onClose={onClose}>
      <Field label={t('panel.kind')}>
        <Select value={category} onChange={(event) => setCategory(event.target.value as typeof category)}>
          <option value="fact">{t('panel.noteFact')}</option>
          <option value="convention">{t('panel.noteConvention')}</option>
          <option value="decision">{t('panel.noteDecision')}</option>
          <option value="progress">{t('panel.noteProgress')}</option>
        </Select>
      </Field>
      <Field label={t('panel.content')}>
        <textarea
          value={content}
          onChange={(event) => setContent(event.target.value)}
          rows={4}
          style={{
            boxSizing: 'border-box',
            width: '100%',
            padding: '8px 9px',
            borderRadius: 7,
            border: '1px solid var(--dsh-border, rgba(127,127,127,0.25))',
            background: 'var(--dsh-input-bg, transparent)',
            color: 'var(--dsh-text, inherit)',
            font: 'inherit',
            fontSize: 13,
            resize: 'vertical',
          }}
        />
      </Field>
      {category === 'progress' ? (
        <>
          <Field label={t('panel.stage')}><Input value={stage} onChange={(event) => setStage(event.target.value)} /></Field>
          <Field label={t('panel.next')}><Input value={next} onChange={(event) => setNext(event.target.value)} /></Field>
        </>
      ) : null}
      {error === undefined ? null : <div style={{ fontSize: 12, color: 'var(--dsh-danger, #c44)' }}>{error}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <Button onClick={onClose}>{t('panel.cancel')}</Button>
        <Button variant="primary" onClick={() => {
          if (content.trim() === '') { setError('Content is required.'); return }
          if (category === 'progress' && (stage.trim() === '' || next.trim() === '')) {
            setError('Progress requires stage and next.')
            return
          }
          void onSubmit({
            category,
            content: content.trim(),
            ...(category === 'progress' ? { stage: stage.trim(), next: next.trim() } : {}),
          }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
        }}>{t('panel.save')}</Button>
      </div>
    </Modal>
  )
}

interface ClientContext {
  connection: Parameters<typeof callProjectflow>[0]
  slots: {
    inject(name: string, callback: () => unknown): void
    register(options: Record<string, unknown>, component: React.ComponentType<any>): unknown
  }
  locale: {
    register(namespace: string, dictionaries: Record<string, Record<string, string>>): unknown
    bind(namespace: string): (key: string) => string
  }
  layout: { selectPanel(id: string | null): void }
  uiWorkspace: {
    connectWorkspace(workspaceId: string, options?: Record<string, unknown>): Promise<string | undefined>
    openSession(sessionId: string): void
  }
  workspaces: {
    list: { getSnapshot(): { items: Array<{ workspaceId: string; path: string }> } }
    create(input: { path: string }): Promise<{ workspaceId: string; path: string }>
  }
  sessions: {
    list: { getSnapshot(): { ids?: string[]; items?: Array<{ id: string; title?: string; cwd?: string }>; byId?: Record<string, { id: string; title?: string; cwd?: string }> } }
  }
  effect?(operation: () => unknown, label?: string): void
}

function buildApi(ctx: ClientContext): ClientPanelApi {
  const call = <T,>(endpoint: string, payload: unknown) =>
    callProjectflow<T>(ctx.connection, endpoint, payload)
  return {
    list: () => call('list', {}),
    status: (project) => call('status', { project }),
    create: (input) => call('create', input),
    remove: (project) => call('delete', { project, mode: 'trash' }),
    fork: (project, name) => call('fork', { project, ...(name === undefined ? {} : { name }), bindSessionId: undefined }),
    merge: (source, target, deleteSource) => call('merge', { source, target, deleteSource }),
    insert: (input) => call('insert', input),
    removeMember: (project, memberId) => call('remove-member', { project, memberId }),
    ref: (input) => call('ref', input),
    note: (input) => call('note', input),
    bind: (sessionId, project) => call('bind', { sessionId, project }),
    task: (project, sessionId, action) => call('task', { project, sessionId, action }),
    context: (sessionId) => call('context', { sessionId }),
    enter: async (project) => {
      const snapshot = ctx.workspaces.list.getSnapshot()
      let workspace = snapshot.items.find((item) => item.path === project.primaryPath)
      if (workspace === undefined) {
        workspace = await ctx.workspaces.create({ path: project.primaryPath })
      }
      const sessionId = await ctx.uiWorkspace.connectWorkspace(workspace.workspaceId)
      if (sessionId === undefined) throw new Error('DSH did not return a session for this workspace.')
      await call('bind', { sessionId, project: project.id })
      ctx.uiWorkspace.openSession(sessionId)
      ctx.layout.selectPanel(null)
      return sessionId
    },
    listSessions: () => {
      const snapshot = ctx.sessions.list.getSnapshot()
      const items = snapshot.items ?? Object.values(snapshot.byId ?? {})
      return items.map((session) => ({
        id: session.id,
        title: session.title ?? 'Untitled',
        cwd: session.cwd ?? '',
      }))
    },
  }
}

export const inject = ['slots', 'locale', 'layout', 'uiWorkspace', 'workspaces', 'sessions', 'connection']

export function apply(ctx: ClientContext): void {
  ctx.effect?.(() => ctx.locale.register(NS, { en, zh }), 'projectflow: locale')
  const t = ctx.locale.bind(NS)
  const api = buildApi(ctx)

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'projectflow',
    locale: NS,
    inject: () => ({
      openPanel: () => ctx.layout.selectPanel('projectflow'),
      t,
    }),
  }, FooterButton))

  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: 'projectflow',
    locale: NS,
    inject: () => ({ api, t }),
  }, ProjectPanel))
}

export { FooterButton, ProjectPanel }
