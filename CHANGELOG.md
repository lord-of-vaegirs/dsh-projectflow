# Changelog

## 0.1.1 — 2026-10-28

### Fixed

- The sidebar footer label **Project workspaces / 项目工作区** now uses the same
  14px size, weight, tertiary color, and 20px line height as the **Workspaces /
  工作区** section header, so the two read as sibling sections.

## 0.1.0 — 2026-10-28

Initial release.

### Added

- Project entity with stable `prj_*` id, name, aliases, primary workspace path,
  fork lineage, merge lineage, and archive flag.
- Project data root under `$DSH_HOME/projects/<projectId>/` with Markdown,
  JSONL, and JSON records; no workspace writes.
- `§`-separated MEMORY/CONVENTIONS/DECISIONS files with ADR support.
- Split references: `refs/dirs.json` for directories/files and
  `refs/tools.json` for tools/plugins/MCP; metadata only, no copies.
- Append-only progress log with deduplication and archive pointers.
- Session binding, rebinding, and fork inheritance through
  `SessionHeader.parentSession`.
- Task records with checkpoints, pending system prompt, interrupt/resume/done/
  blocked states, and turn-boundary updates.
- Workspace members: directory, session, project.
- Project fork, merge (keep or trash source), delete to trash or purge, archive.
- `system-prompt/assemble` contribution with `[PROJECTFLOW]` marker and a hard
  estimated-token budget (default 1200).
- Eight tools: `project_create`, `project_list`, `project_use`, `project_note`,
  `project_ref`, `project_status`, `project_workspace`, `project_task`.
- `/project` commands for TUI: list, create, use, note, ref, status, log, fork,
  merge, delete, insert, task, archive/unarchive, help.
- Browser/Desktop client: sidebar footer **Project workspaces** action and a
  keyed `projectflow` main panel with create/open/fork/merge/insert/ref/note/
  status/task/delete controls.
- Authenticated `/projectflow` browser RPC bridge over a prefix Web route.
- Read-only GUI smoke script and observed Web panel create/details/delete/open checks.
- Atomic writes, per-project `wx` locks, stale-lock takeover, capacity archiving.
- Cross-process concurrency test, budget tests, prompt/tool/command/RPC/client
  tests, and a 23-test automated suite.
- README, architecture, mnemon boundary, acceptance checklist, MIT license.

### Known limitations

- Browser entry is in the sidebar footer because `sidebar.workspaces` is a
  single-occupant slot in DSH 0.2.1-rc.2.
- Interrupt is cooperative; no hard process kill.
- No automatic resume turn after interrupt.
- No dsh-mnemon mirror in this release.
- Desktop 0.2.0-rc.2 is not claimed as tested.

## Unreleased

- P1: optional one-way mnemon Memory Space mirror (default off).
- P1: zip export/import.
- P1: project timeline/graph UI.
- P1: global session→project index for large installations.
- P1: trash retention policy and archive compaction.
