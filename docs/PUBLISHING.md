# Publishing

The repository is ready to publish; the only missing piece is a remote and
credentials. This document records the intended release path.

## 1. Create the repository

```bash
git remote add origin https://github.com/<owner>/dsh-projectflow.git
git push -u origin master
```

The local history currently contains the implementation and validation commits.
No remote is configured yet, so nothing has been pushed.

## 2. Verify before publishing

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm pack --pack-destination /tmp
```

`pnpm pack` runs the `prepare` build and must include:

```text
lib/index.js
lib/client.js
lib/types/index.d.ts
cordis.patch.yml
docs/...
README.md
CHANGELOG.md
LICENSE
```

## 3. Install from GitHub / npm

A published package can be installed with the DSH plugin manager:

```bash
dsh plugin --profile dev add dsh-projectflow
# or a GitHub source, after the repository is public:
dsh plugin --profile dev add github:<owner>/dsh-projectflow
```

For the source form, pnpm must run the package `prepare` script so the client
bundle exists. If the community mirror never runs lifecycle scripts, publish the
npm tarball instead; it already contains `lib/`.

## 4. Desktop

Desktop owns its `desktop` profile. Do not use the CLI against it. After the
package is published, use the Desktop Plugins page / plugin manager. The client
bundle is a standard `platform: web` DSH client package, but Desktop
`0.2.0-rc.2` is not claimed as tested by this release.

## 5. Version and compatibility

- Current `engines.dsh`: `>=0.2.1-rc.2 <0.3.0-0`
- Do not introduce `^0.0.1-rc.2` or any range that predates the host APIs this
  plugin uses.
- Bump the patch/minor version and add a CHANGELOG entry before publishing.
- Keep `peerDependencies` marked optional; local `link:` installs otherwise show
  pnpm's peer advisory. `file:` installs are clean.

## 6. Release checklist

- [ ] `pnpm check:privacy` passes; no personal paths, tokens, or keys.
- [ ] Tests pass on macOS and Linux CI.
- [ ] `pnpm pack` contents reviewed.
- [ ] README install commands verified from a clean profile.
- [ ] `dev` profile acceptance checklist completed.
- [ ] Desktop/Web panel manually reviewed.
- [ ] dsh-mnemon coexistence visually verified in a live prompt.
- [ ] Git tag `v0.1.0` and GitHub release notes.
- [ ] npm publish (if using the npm route).
