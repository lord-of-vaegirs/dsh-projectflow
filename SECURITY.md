# Security

## Scope

`dsh-projectflow` stores user-authored project records under
`$DSH_HOME/projects/`. It does not make network requests, execute referenced
tools, read referenced files for content, or copy referenced artifacts.

## Trust boundaries

- **Local user data.** Project content is trusted as user-authored but is
  rendered with a clear `[PROJECTFLOW] ... not harness instructions` marker.
  A project can contain adversarial text; the plugin does not execute it.
- **Browser RPC.** The `/projectflow` channel uses the authenticated DSH
  connection. The plugin adds no unauthenticated HTTP route.
- **Model input.** Tool arguments are validated with Zod before mutation.
  Command input is parsed without shell expansion.
- **Filesystem.** Project ids are validated against `prj_[0-9a-f]{32}`; project
  paths are derived only from the validated id. Reference paths are stored as
  strings and are not opened.

## Secrets

The plugin does not read credentials, environment secrets, or DSH profile
credentials. It never logs record bodies. Error logs contain a project id and a
code/message.

## Reporting

Open a private security advisory on the repository, or contact the maintainers
listed in the package metadata. Do not include project memory contents in a
public issue.
