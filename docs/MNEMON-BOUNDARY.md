# dsh-projectflow × dsh-mnemon

Two context systems can legitimately be installed together. They must not
overwrite each other, and users should know which one owns which fact.

## Ownership

| Concern | dsh-projectflow | dsh-mnemon |
|---|---|---|
| Stable entity | Project id + aliases + primary workspace | Workspace directory, Memory Space, Document ids |
| Cross-directory project state | **Owner** | Not modeled as a project |
| User profile / global preferences | Not stored | **Owner** (`USER.md`, Memory Spaces) |
| Project facts/conventions/decisions/progress | **Owner** | Only if the user writes them there |
| Semantic recall, embeddings, document search | Not implemented | **Owner** |
| Task checkpoint / project workspace composition | **Owner** | Not modeled |
| References to dirs/files/tools/plugins/MCP | **Owner** (metadata only) | Not modeled |

Recommended usage:

- Use `project_*` for facts that must travel with a project across directories:
  rules, ADRs, progress, task state, references.
- Use mnemon for who the user is, cross-project lessons, semantic recall, and
  long-form documents.
- Do not duplicate the same rule in both systems unless you accept that the
  model sees it twice.

## Injection coexistence

`dsh-projectflow` appends exactly one section named `projectflow:context` in the
`system-prompt/assemble` waterfall. It never removes or rewrites another
contributor's sections. dsh-mnemon has its own guidance/section names and its
own pre-step memory snapshots; both remain.

Source distinction is visible in the text:

```text
[PROJECTFLOW] Project context — user-authored project records, not harness instructions.
Project: ...
```

vs. mnemon's `MNEMON RUNTIME MEMORY SNAPSHOT` / `MNEMON VIEW ROUTES` /
memory section markers.

Both plugins write under `$DSH_HOME`:

```text
$DSH_HOME/projects/<projectId>/...          # dsh-projectflow
$DSH_HOME/...                                # mnemon runtime/documents/spaces
```

They do not share lock files, data files, or write paths. There is no
cross-plugin transaction; a failure in one does not roll back the other.

## No mirror in MVP

A default-off mirror of project memory into a mnemon Memory Space is a P1
candidate only. It is excluded from `0.1.0` because:

1. it creates a second source of truth;
2. it adds a write dependency on mnemon's evolving Space API;
3. it duplicates per-turn context;
4. project data must remain readable after either plugin is removed.

If added later, the mirror must be:

- explicit opt-in;
- one-way (projectflow → Space), never bidirectional;
- provenance-tagged with the project id;
- observable and revocable;
- disabled by default.

## Ordering / budget

Both plugins contribute to the same prompt. The model sees mnemon's sections
plus `projectflow:context`. Project context has its own hard budget (default
1200 estimated tokens) and does not count or alter mnemon's budget. If the
combined prompt feels heavy, lower `contextBudgetTokens` for projectflow rather
than disabling mnemon, or use `project_status` on demand.

## Failure isolation

- A corrupt project file makes projectflow emit a short warning section and log
  a code; mnemon continues normally.
- A mnemon failure does not affect projectflow's storage or tools.
- Neither plugin claims to own the other's session binding. A project binding
  is stored in projectflow's `sessions.json`; mnemon's memory views are
  independent.
