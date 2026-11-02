# Investigation

Verified on `main` at `0d29bfe` (2026-11-02, Linux, Node v22.23.4). Code wins over the PRD where they differ. No Windows exe has been produced from this tree.

## 1. Stack and how it runs

The app is `local-memory/`. Electron 45 shell, React 19 + Vite UI, TypeScript sources, node:test. Secrets go through `@napi-rs/keyring`. A separate Node script talks to Neo4j and the Google Drive API.

Entry points:

| Path | Role |
| --- | --- |
| `local-memory/package.json:4` `main` | `electron/start.mjs` |
| `local-memory/package.json:13` `start` | `electron/dev.mjs` (Vite on 127.0.0.1:1420, then Electron) |
| `local-memory/electron/main.ts` | Real main process |
| `local-memory/electron/preload.cjs` | `contextBridge` as `window.sharlie` |
| `local-memory/ui/` | Renderer. Built to `ui/dist`. Packaged loads the file; dev loads the Vite URL (`electron/main.ts:78-82`) |
| `local-memory/src/lookup-cli.ts` | Local lookup command. The desktop app does not install it as a Cursor or Claude skill |
| `local-memory/src/mcp.ts` | Stdio MCP server, also imported by the desktop host |
| `local-memory/relay/run.ts` | **Cut.** Cron-only Drive → Neo4j relay, no longer part of the product: the desktop host stopped importing it (2b46cba). The code, `npm run relay`, and `test/relay.test.ts` are still in the repo until they are deleted |

Split: the renderer never touches the filesystem. Preload exposes `state`, `action`, `lookup`, and an `onLearning` subscription (`electron/preload.cjs:3-12`). `electron/main.ts:124-126` handles those over IPC and forwards JSON lines to `openDesktopHost` in `src/window.ts`. Learning snapshots are pushed with `webContents.send('learning')` (`electron/main.ts:45`).

`electron/start.mjs` tries to import `electron/main.ts`. On `ERR_UNKNOWN_FILE_EXTENSION` it spawns a second process with `--experimental-strip-types` and waits for it (`electron/start.mjs:5-19`). That is a second OS process. The parent does not hold the single-instance lock, because the lock lives in `main.ts`, which the parent failed to import. Dev and the Electron Playwright spec force the same path with `SHARLIE_STRIP_TYPES=1` (`ui/e2e-window/graph.spec.ts:83`).

The normal launch does take a lock (`electron/main.ts:115-121`). A second normal launch quits and the first window is shown. `--register-login` / `--unregister-login` skip the lock (`electron/main.ts:108-112`), so the NSIS hook can register the login item. Closing the window hides it; the tray keeps the process (`electron/main.ts:73-76`, `134-136`).

Production packaging does not compile TypeScript. `build.files` ships `electron/**` and `src/**` as source (`package.json:45-49`) and drops `node_modules`. `npm start` works only because Node 22 can strip types. A packaged Electron binary cannot be assumed to do that, and `start.mjs` will try to spawn Electron again to get the flag.

## 2. What the core is, what is overengineered, what is bad tech

The core is one loop in `openApp.runLearner` (`src/app.ts:2126`):

1. Gate on profile, an active key, and a chosen model (`src/app.ts:2130-2136`). First run also waits for Start learning (`learningStarted`, `src/app.ts:2110`, `2626`).
2. Read transcripts from installed tools only: Cursor, Copilot in VS Code, Claude, Cursor CLI, Claude CLI, Copilot CLI (`src/app.ts:1612-1617`).
3. Skip transcripts whose revision was already imported (`src/app.ts:2141-2145`). Newest first, in batches.
4. Ask the model for one lesson, with the cards already on disk in the prompt (`src/host.ts:79-101`).
5. Scrub names and secrets, drop an incomplete lesson, write a card (`src/app.ts:2290-2409`).
6. Lookup sends file name + summary, then the full text of the cards the model picks (`src/app.ts:2477-2494`). Both steps use the local knowledge directory only.

That loop is what ships. It is not an everyday-life assistant. See section 5.

Overengineered or off the loop:

- Neo4j + Google Drive API relay (`relay/relay.ts`, `.github/workflows/relay.yml`). Service-account upload, then Cypher, then move the file to `_Processed`. The PRD says the Drive folder is the end of the pipeline and a company database is out of scope (`docs/prd/local-memory.md:109-110`).
- Desktop startup no longer writes a Cursor/Claude MCP config or skill file, and `src/mcp.ts` no longer imports the Neo4j relay. Team search reads the local cards.
- `@cosmos.gl/graph` force graph for a card list (`ui/src/GraphMap.tsx`). It is the current KB view. Leave it to the UI team. Do not add features to it.
- Four key providers plus a Custom base URL, OS keyring, login-item installers, and a second scheduled publisher (`src/login-item.ts`, `src/vault.ts`).
- Shared `.claims.json` plus in-place rewrite (`src/synapse.ts:64-85`, `src/synapse.ts:146-154`, `src/synapse.ts:182-204`).
- Token counters threaded through settings, the ingest log, and the window (`src/app.ts:2049-2073`, `src/window.ts:176-200`).

Bad tech:

- Model ids are not real provider ids: `claude-haiku-5-5`, `gpt-6-luna`, `gpt-6.1-sol`, `gpt-6-astra` (`src/app.ts:277-288`). A saved Anthropic or OpenAI key will 404 until those strings change. Cursor is the only provider whose model list comes from the network.
- Card ids are `card_YYYYMMDD_HHMMSS` with a numeric suffix (`src/synapse.ts:37-61`). Two machines in the same second collide. There is no writer id.
- `settings.json` sits inside the knowledge directory (`src/app.ts:420-421`). Pointing that directory at a shared Drive folder syncs secrets metadata and conflicts.
- `src/host.ts:54` turns a missing `scope` into `work`. The file that is written still has no `scope` field (`src/synapse.ts:17-28`, `src/app.ts:2388-2408`).
- Keyring cleanup throws when there is no session bus, which fails the test even after the assertion passed (`src/vault.ts:23-28`, `src/app.ts:579-581`).

## 3. Windows exe, and whether a clean runner builds one today

It does not. Checked config, not a Windows machine.

The only workflow is `.github/workflows/relay.yml` (cron, `ubuntu-latest`, Drive → Neo4j). There is no Windows job. `git log` has no release artifact. `local-memory/release/` is gitignored and empty here.

`package.json` has no `version`. electron-builder reads `metadata.version` and later calls `.split` on it (`node_modules/app-builder-lib/out/appInfo.js:29`, `appInfo.js:67`). With `version` missing that throws `Invalid major number in: undefined` once packaging asks for the Windows version form. The exe has never been built because the checked-in config cannot finish packaging.

`build.files` is `electron/**`, `src/**`, `ui/dist/**`, `package.json` (`package.json:45-49`). It does not include `relay/**` or `node_modules`. The desktop process no longer imports `relay/neo4j.ts`. `neo4j-driver` stays a relay-only dependency and is not required to launch the window.

Cheapest route that can go green on `windows-latest`:

1. Set `version` (for example `0.1.0`).
2. Stop importing `relay/` from the desktop process. Cut the relay (section 7). Do not add `relay/**` to `build.files` just to keep Neo4j booting.
3. Bundle `electron/main.ts` and the `src/` it imports to one JS file with esbuild (already a devDependency). `main` points at that file. `start.mjs` must not spawn a child.
4. Keep `requestSingleInstanceLock` for a normal launch.
5. `npm ci`, `npm run ui:build`, `electron-builder --win nsis` (NSIS is already the target, `package.json:54-62`; the installer hook is `electron/installer.nsh`).
6. Launch the packaged exe with a smoke flag, require exit 0, print a plain error if the process dies or the first window never loads. Upload the exe from `local-memory/release/`.
7. Do not gate that job on today's `npm test`. Tests are red for a reason that is not the packaging (below). Add them once they pass.

A clean runner today, with no code changes, fails at step 1.

### Tests and types (re-measured here)

`npm test` on this Linux runner: **142 tests, 45 pass, 97 fail**.

| Count | Cause |
| --- | --- |
| 85 | `@napi-rs/keyring` → `zbus error: Failed to connect to address unix:path=/run/user/1000/bus`. Thrown from `deleteVault` during `discardVault` teardown (`src/vault.ts:24`, `src/app.ts:581`). |
| 11 | `mock.module('../src/vault.ts')` did not expose `deleteSecret` on Node 22.23.4 (`test/learning-progress.test.ts:11`). |
| 1 | `mock.module('@cursor/sdk')` did not apply. `Cursor SDK has no Agent.prompt` (`test/host.test.ts:155`, `src/exchange.ts:190`). |

A teammate report of 57 pass / 85 fail is the same 142 tests with only the keyring rows failing (45 + 11 + 1 = 57). The 85 are the dbus rows. The extra 12 are this Node's experimental module mocks. Not re-run on Windows. Windows Credential Manager may let the 85 pass; the 12 mock failures will follow the Node version, not the OS. CI should not call the OS keyring. Tests need an in-memory secret store swapped in for `src/vault.ts`.

`npx tsc --noEmit`: **23 errors, all `TS2339`, all under `test/`**. `test/gate.test.ts` 15, `test/card.test.ts` 6, `test/import.test.ts` 1, `test/graph.test.ts` 1. `runLearner` is typed as a sync result or a Promise (`src/app.ts:2129`). Tests read `.ran` / `.model` without narrowing. `test/graph.test.ts:252` reads `created_at` on a union that includes non-card nodes.

Playwright (`npm run test:ui`, `ui/e2e`, 61 tests claimed by a teammate, 60 passing) was **not re-run** in this pass. Browsers were not installed. Treat 60/61 as unverified.

## 4. Required CI shape

One workflow on `windows-latest`, on push to `main` and on tags:

- checkout, Node 22, `npm ci` in `local-memory`
- compile `electron/` + `src/` to JS, build the UI, `electron-builder --win`
- install or launch the packaged exe and run a scripted first-run smoke
- on failure, print a short readable reason (missing version, window never loaded, process exit code, smoke timeout)
- upload the exe as an artifact (`Sharlie Setup *.exe` from the NSIS target)

Smoke must not need a Google account, a model key, or a Drive path. First launch with no key stays idle. That is the current gate (`src/app.ts:2094-2105`).

## 5. Scope

`docs/prd/local-memory.md` is a transcript harvester. It reads coding-tool chats and writes lesson cards. The window is settings, identity, model, tool list, and graph. It is not the process that learns (`docs/prd/local-memory.md:76`).

What the code does today matches that, with the gaps in sections 2 and 6. It does not chat, and it does not learn from text the person types. The only inputs are transcript files on disk.

The later brief called Sharlie an assistant for everyday things. The ruling is that the transcript loop ships and everyday learning is UI copy only. Pointing the code at a new source would be a new feature. The model prompt is already "one lesson from this text" (`src/host.ts:79-101`), so a chat source would be a small adapter, and it is out of scope. Do not add one.

## 6. Knowledge base

Director's proposal: one folder of small files, one lesson per file, id plus links, read the folder before writing, each writer owns its files, shared files are append-only, Google Drive for Desktop syncs the folder, the app only needs a local path.

What the repo does instead:

- Two files per card, `{id}.json` and `{id}.md`, under `cards/` (`src/synapse.ts:200-201`). Not one node file.
- A shared index, `cards/.claims.json` (`src/synapse.ts:64-85`, written at `src/synapse.ts:202-204`). Two people writing the same folder will conflict on that file.
- Ids have no writer id (`src/synapse.ts:37-61`).
- Updates archive the old file and write the same id again (`src/synapse.ts:146-154`). Not append-only. Drive will conflict on the rewrite.
- The Drive path is a copy destination, `Dropzone/<username>/`, not the knowledge folder (`src/synapse.ts:164-167`, `src/app.ts:2522-2524`). The app never reads those copies back. `localGraph` only checks that the json exists (`src/synapse.ts:279-283`). Lookup reads `readStoredCards(directory)` (`src/app.ts:2480-2490`). The loop is open.
- `runPublisher` copies every json and md in `cards/`, including `.claims.json`'s neighbors, with no scope check (`src/app.ts:2511-2525`).
- Personal vs work is a PRD rule (`docs/prd/local-memory.md:37`, `docs/prd/local-memory.md:93`, `docs/prd/local-memory.md:96`) and a field on the draft (`src/app.ts:51`). It is not stored on the card and not enforced on copy.
- `autoDrop` defaults to false (`src/app.ts:447`) but the publisher ignores it. Any non-empty `drivePath` publishes on the job (`src/app.ts:2511-2512`, `src/app.ts:2631-2632`).
- The "vault" in the UI is the knowledge directory path (`vaultPath` in `src/window.ts:191`). The OS vault is the keyring (`src/vault.ts`). Those are different things. API keys must stay out of the shared folder.

Keep: local folder path, markdown (or json) per lesson, read-before-write, lookup that uses card text as model context, Drive Desktop as the sync (no Drive API, no OAuth). The graph can keep reading the local folder.

Change, as the KB task, not as a new product: writer-scoped filenames, no shared index inside the synced folder, append-only or conflict-copy, re-index by scanning files, read that index before a write and again when answering. Missing `scope` means personal and is never copied. Share stays off until the person turns on one "Share with team Drive" switch.

## 7. Rulings to implement (not done in this commit)

Privacy, until scope is on the file: sharing off by default; `runPublisher` and auto-drop copy nothing unless the card is `scope: work`. No scope counts as personal. Tests: an unscoped card is not published; sharing off writes nothing to the share folder.

Cadence: PRD default and minimum are one hour (`docs/prd/local-memory.md:23`, `docs/prd/local-memory.md:50`, `docs/prd/local-memory.md:78`). Code defaults to 30 minutes (`src/app.ts:432-433`) and accepts 15, 30, 60, or manual (`src/app.ts:269-274`, `src/window.ts:101-103`). UI offers the same (`ui/src/types.ts:117`). Change the host to default hourly and refuse anything under an hour. The 15m/30m control moves under Advanced in the UI.

Cuts, approved: Neo4j relay and the Neo4j branch of MCP, Copilot as a key (it stays a transcript source), Custom provider, token telemetry, model params behind Advanced, auto-drop and the publisher merged into the one share toggle. Providers the host exposes: Cursor, Anthropic, OpenAI (`ui/src/types.ts:109-115` still lists Copilot and Custom).

`relay.yml`: **cut**. It is not part of the learning loop. It needs five secrets, a service account, and Neo4j, and it moves files the desktop app does not read back.

Host actions the UI team needs are specified in `docs/HOST_ACTIONS.md` (folder picker with path checks, learning cancel, cadence rule, per-source chat counts, live progress, final summary, bridge that returns an error instead of throwing). UI work stays in `ui/src/`. Backend work stays in `electron/` and `src/`.

## Order

1. This report.
2. `docs/HOST_ACTIONS.md` (due 10:30 Europe/Bucharest).
3. Windows job: `version`, JS bundle, no second process, single-instance lock, first-run smoke, upload the exe. Cut the relay import so packaging does not need `relay/**`.
4. In-memory keyring in tests, and the 23 `test/` type errors, so CI means something.
5. Share toggle off by default, publish only `scope: work`, cadence minimum 1h, with tests.
6. Host actions from `HOST_ACTIONS.md` (picker, cancel, chat counts, progress, summary).
7. KB read/connect: scan the folder before write and before lookup. Concurrency test with two writers. No new transcript sources.

## Known issues

`pageState` calls `session.sourceFolders()` twice on every snapshot (`local-memory/src/window.ts`, the `sources` field and the `chatsFound` sum). Each call walks the installed-tool folders again. Performance only. Not fixed in this release.
