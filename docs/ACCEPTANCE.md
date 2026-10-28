# Acceptance checklist

Environment:

- macOS
- DSH CLI `0.2.1-rc.2`
- test profile `dev` created from the shipped `web` template
- TUI `@deepseek-harness-tui/dsh-tui` `0.17.0`
- Desktop `0.2.0-rc.2` profile **not** touched
- live data root: `$DSH_HOME/projects`

## Automated suite

```bash
pnpm test
```

Observed: **24 tests passed, 12 files** (host build runs as `pretest`).

Coverage includes cross-process writers, atomic project creation, capacity
archive pointers, binding/rebinding/fork inheritance, merge dedupe, context
budget truncation, prompt contribution, tools, commands, RPC, client
registration/SSR, and task interrupt injection.

## Live checks

### 1. Create project, write 3 conventions + 1 decision + 2 progress

Performed in TUI:

```text
/project create TUIProject --path "$PWD"
/project note convention "Always run the test suite before publishing."
/project note convention "Project data lives under DSH_HOME, never the working directory."
/project note convention "References store metadata only; never copy files or tool code."
/project note decision "Use O_EXCL file locks for every project write." --context "..." --consequences "..."
/project note progress "Implemented project storage and command surface." --stage M1 --next "..."
/project note progress "Verified TUI command path." --stage M2 --next "..."
```

Observed: project `prj_7fa81facdd757f5c0a70c462947edee4`; status reported
`3 conventions, 1 decision, 2 progress`; context estimate `248/1200`.

**Status: PASS for command/storage surface.**

### 2. Another directory/session uses the project

Performed a new TUI session (same `$DSH_HOME`, new session id), then:

```text
/project use TUIProject
/project status
```

Observed: bound; status showed the same records and `~313/1200` tokens after the
refs were added.

The actual model prompt injection is covered by `tests/unit/prompt.test.ts`;
a live model turn was not run because the disposable headless profile lacks a
usable interactive account session. **Storage/command portion PASS; live model
prompt remains a manual check.**

### 3. Fork inherits without `/project use`

Automated `tests/unit/binding.test.ts` covers `parentSession` inheritance and
the "no cwd guessing" fallback. In the live TUI, `/project fork` created
`TUIProject-Fork` and bound the current session; status showed the copied
records.

**Status: PASS for command/domain; live child-agent prompt is a manual check.**

### 4. References and status details

Performed:

```text
/project ref dir "$PWD" --purpose "project source"
/project ref mcp filesystem --purpose "reference MCP server"
/project status --section refs --section progress
```

Observed:

```text
Directory/file refs:
- dir: /Users/.../dsh-projectflow — project source

Tool/plugin/MCP refs:
- mcp: filesystem — reference MCP server
```

Context estimate rose to `~313/1200`; only metadata is stored.

**Status: PASS.**

### 5. Disk layout and zero workspace writes

Observed under `$DSH_HOME/projects/prj_.../`:

```text
project.json
MEMORY.md
CONVENTIONS.md
DECISIONS.md
refs/dirs.json
refs/tools.json
progress.jsonl
sessions.json
tasks.json
workspaces.json
archive/
```

`MEMORY.md`, `CONVENTIONS.md`, and `DECISIONS.md` use standalone `§`
delimiters; refs use the split dirs/tools files; the source project directory was
not modified by the plugin. The only writes were under `$DSH_HOME`.

**Status: PASS.**

### 6. Uninstall / reinstall preserves data

Performed on the `dev` profile:

```text
dsh plugin --profile dev remove dsh-projectflow
ls "$DSH_HOME/projects"       # project directory still present
dsh plugin --profile dev add "file:$PWD"
dsh --profile dev --dump-config | grep -A2 projectflow
```

Observed: the project directory remained; the reinstall used the `file:`
protocol with no peer warning; `--dump-config` contained `projectflow`; the dev
server booted without an activation warning; the client bundle was served at
the new revision.

**Status: PASS.**

### 7. Coexistence with dsh-mnemon

- Both plugins use different data roots and locks.
- projectflow appends a unique `projectflow:context` section and never removes
  mnemon sections.
- `tests/unit/prompt.test.ts` confirms an unrelated section survives.
- The dev profile was additionally installed with `dsh-mnemon@0.5.36`.
  `dsh --profile dev --dump-config` contained both `projectflow` and
  `mnemon-bundle`; the Web boot graph contained both `dsh-projectflow/client.js`
  and `dsh-mnemon/client.js`. The dev server booted without an activation
  warning. The Desktop profile was intentionally not modified.
- A live model prompt containing both markers was not captured because the
  disposable headless profile has no usable interactive account session.

**Status: composition/unit PASS; live dual-injection prompt is a pending manual
check.**

### 8. Compatibility gate

- Package `engines.dsh` is `>=0.2.1-rc.2 <0.3.0-0`.
- `dsh plugin --profile dev add file:$PWD` completed without an
  `incompatible-version` rejection.
- `dsh --profile dev --dump-config` contained:

```yaml
- id: projectflow
  name: dsh-projectflow
```

- A `link:` install emits pnpm's local-link peer advisory; `file:` install does
  not. The published package uses the same `engines.dsh` declaration.

**Status: PASS on 0.2.1-rc.2.**

### 9. Release tarball installation

`pnpm pack` produced `/tmp/dsh-projectflow-0.1.0.tgz` containing
`lib/index.js`, `lib/client.js`, `lib/types`, `cordis.patch.yml`, and docs. The
tarball was installed into the dev profile with
`dsh plugin --profile dev add /tmp/dsh-projectflow-0.1.0.tgz`; the dev server
booted and the GUI smoke test passed. This is the same artifact shape a future
npm release would publish.

**Status: PASS.**

### 10. GUI smoke (added during final verification)

`scripts/gui-smoke.mjs` launched the dev Web URL in headless Chrome, dismissed
the preview dialog, clicked the sidebar **项目工作区** entry, asserted the panel
heading, and opened **详情**. It passed with no console/page errors. A separate
mutation check created `GUI-Smoke`, confirmed the card appeared, and deleted it
to trash through the confirmation dialog; it also passed with no errors.

A separate open check clicked **打开** on `TUIProject`, left the project panel,
opened a normal conversation, and wrote a new binding to
`$DSH_HOME/projects/<id>/sessions.json` with no console/page errors.

A mutation check exercised **Fork**, **添加记录**, **引用**, **插入**, and
**合并** through the panel: a `GUI-Fork` project was created, a convention and a
directory ref were added, `/tmp/gui-member` was inserted as a directory member,
and the fork was merged into `TUIProject` with the source moved to trash. All
operations completed with no console/page errors.

**Status: PASS (Web client shell, details, create, delete, open project session,
fork, note, ref, merge).**

### 11. Published repository and release

- Repository: https://github.com/lord-of-vaegirs/dsh-projectflow
- Release: https://github.com/lord-of-vaegirs/dsh-projectflow/releases/tag/v0.2.0
- Release asset: `dsh-projectflow-0.2.0.tgz` (72,148 bytes)
- CI: green on `main` (Node 20 and Node 22 jobs)
- Published asset installed into the dev profile with
  `dsh plugin --profile dev add https://github.com/lord-of-vaegirs/dsh-projectflow/releases/download/v0.2.0/dsh-projectflow-0.2.0.tgz`
  and the GUI smoke test passed.
- `pnpm check:privacy` scans tracked and built text for personal home paths,
  token shapes, private-key blocks, and bearer literals. It passed before the
  release asset was uploaded, and the extracted tarball was manually audited.

**Status: PASS.**

### 12. Project-only conversation workspace

Created a project conversation from the panel. The project workspace was created
at `$DSH_HOME/projects/<id>/workspace/`, registered with DSH, renamed to
`TUIProject`, and opened. The sidebar showed a `TUIProject` workspace and the
conversation header selector showed `TUIProject`; the project panel listed the
conversation under **项目对话 (1)**. No console/page errors.

**Status: PASS.**

## Pending manual checks

These require a live model/account or the Desktop-owned profile and were not
performed automatically:

1. Ask a model in a bound session to quote the injected project section
   (`[PROJECTFLOW]` marker, conventions, decisions, progress, refs count).
2. Fork in the Web UI and confirm the child's first model step sees the
   inherited project without `/project use`.
3. Open the Desktop/Web **Project workspaces** panel, create a project, open a
   project session, and run the GUI fork/merge/insert/ref/delete actions.
4. Install both projectflow and dsh-mnemon in a dev profile and inspect the
   prompt for both source markers.
5. Remove and reinstall the plugin and confirm project list/data are unchanged.
6. Desktop `0.2.0-rc.2` should be treated as unverified until its host API is
   tested. Do not install into the Desktop-owned profile with the CLI.
