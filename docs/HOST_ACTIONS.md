# Host actions

Contract for the Electron host. The UI team stays in `local-memory/ui/src/` and calls `window.sharlie` only. The host team implements this in `electron/` and `local-memory/src/`. Existing `state`, `action`, and `lookup` calls keep working. New fields are additive.

The renderer bridge already turns a missing preload into a rejected promise (`ui/src/host.ts`). The host must do the same at the IPC boundary: reject with `Error`, whose `message` is a sentence a person can read. Do not throw a string. Do not exit the process because one call failed.

## Channels

| Channel | Direction | Who |
| --- | --- | --- |
| `state` | renderer invoke | Page snapshot |
| `action` | renderer invoke | Every command below |
| `lookup` | renderer invoke | Ask the local cards a question |
| `cancel-learning` | renderer invoke | Stop the current learning pass. Also available as an action. |
| `learning` | main → renderer event | A new page snapshot while a pass is running |

Preload (`electron/preload.cjs`) exposes:

```ts
state(): Promise<PageState>
action(body: Record<string, unknown>): Promise<PageState>
lookup(query: string): Promise<{ model?: string; answer?: string }>
onLearning(callback: (state: PageState) => void): () => void
cancelLearning(): Promise<PageState>
```

`cancelLearning` is required on the preload object. The UI already checks `typeof sharlie.cancelLearning === 'function'` (`ui/src/host.ts`).

`action` body is a flat string map, same as today (`src/window.ts` copies values with `String(value)`). Booleans are `"true"` and `"false"`.

## Response

Success and a refused command both resolve with a page snapshot. A refused command sets:

```ts
errorCode: string
notice: string
```

`notice` is the sentence. `errorCode` is the stable token below. A success leaves both empty (`""` or omit `errorCode`).

An unexpected failure still resolves the snapshot. `notice` is `Something went wrong on this PC. Try again. If it keeps happening, open Details`. `detail` is the raw message, one line, for the Details control.

While a pass is running, `learning.label` is a plain sentence such as `Reading Cursor chats`. `learning.detail` is the developer line (source, file, card title). The finished snapshot omits both.

A dead host, a broken IPC channel, or a missing preload rejects the promise. The UI already shows that message on the service screen. Use these messages when the host is the one failing:

| Situation | `message` |
| --- | --- |
| Preload never attached | `The desktop bridge did not load, so the window cannot reach the background service.` |
| Host process is gone | `Sharlie host is not available` |
| Anything else | The underlying error message, one line, no stack |

## Error codes

| `errorCode` | When | `notice` |
| --- | --- | --- |
| `path_empty` | Picker or typed path is blank | `Choose a folder.` |
| `path_not_found` | Nothing is at that path | `That folder does not exist.` |
| `path_not_directory` | The path is a file | `That path is a file, not a folder.` |
| `path_not_writable` | The process cannot create a file there | `Sharlie cannot write to that folder.` |
| `cadence_too_short` | 15m, 30m, or any interval under 1 hour | `The schedule cannot be shorter than 1 hour.` |
| `share_needs_path` | Sharing turned on with no usable folder | `Choose a team Drive folder before sharing.` |
| `share_unavailable` | Team sharing is turned off in this version | `Team sharing is not available in this version.` |
| `profile_incomplete` | Learning without username, email, and team | `Save your username, email, and team before learning can write cards.` |
| `key_missing` | Learning with no active provider | `Turn on a provider before learning can write cards.` |
| `secret_missing` | A saved key has no secret in the vault | `No secret stored for key …` |
| `model_error` | The model call failed and the pass wrote no lesson | The model error, one line |
| `model_missing` | Learning with no chosen model | `Choose a model before learning can write cards.` |
| `no_chats` | Start pressed when the scan found no chats | `No AI coding chats were found. Sharlie looks in Cursor, Copilot, and Claude.` |
| `key_rejected` | The provider answered 401 or 403 | `That key was rejected by Anthropic.` (or OpenAI, or Cursor) `Check it and try again` |
| `key_unchecked` | The provider could not be reached. The key is still saved | `The key was saved. Sharlie could not reach Anthropic to check it.` |
| `unknown_action` | The action name is not one of the commands below | `That action is not available.` |

`start-learning` returns those learning sentences as `notice` with the matching `errorCode` and does not start.

`start-learning` returns `no_chats` when the scan found nothing and does not start. The host does not scan again on its own. Nothing is retried until `recheck-sources` or the person starts again after a re-check that finds chats.

## Page snapshot fields the UI should read

Existing fields stay. These are added:

```ts
sources: { tool: string; path: string; chats: number }[]
searched: { tool: string; path: string }[]
chatsFound: number
scheduled: boolean
share: boolean
shareAvailable: boolean
shareStartedAt: string | null
lastSharedAt: string | null
lastLearnedAt: string | null
learning: {
  active: boolean
  done: number
  total: number
  lessons: number
  error?: string
  errorCode?: string
  cappedChats?: number
  deferredChats?: number
  notice?: string
} | null
learningResult: { lessons: number; chats: number; text: string } | null
```

`sources[].chats` is how many transcript files that installed tool contributed. `chatsFound` is the sum. Copy for one source is `Cursor · 412`. Several sources join as `Cursor, Claude CLI · 412 chats`. Tools with zero chats stay out of `sources`.

`searched` is every folder the scan looked in, including folders that held no chats, in scan order. The first-run screen lists these paths. When `chatsFound` is 0 the start control stays disabled and the screen says Sharlie only learns from AI coding chats (Cursor, Copilot, Claude) and that none were found.

`learning.done` and `learning.total` are chats in the current pass. The first pass reads at most the newest 50, so a backlog of 412 shows `37 of 50 chats`, not `37 of 412`. `chatsFound` stays the full count. `learning.lessons` is how many cards this pass has written so far.

`learning.cappedChats` is how many chats in this pass were cut to their newest 30,000 characters. `learning.deferredChats` is how many older chats the first pass left unread. `learning.notice` is the sentence for those, and it is not the top-level action `notice`. The sentences are exactly `Learned the newest 50 chats. Older chats stay unread; later passes learn only new chats.` and `1 chat was cut to its newest 30,000 characters.` (or `N chats were cut to their newest 30,000 characters.`). When both apply they are joined with a space. A pass that did neither leaves `learning` as `null` when it finishes.

When a pass finishes cleanly and nothing was capped or deferred, `learning` becomes `null` and `learningResult` is set. `learningResult.text` is `58 lessons learned` (the number is `lessons`, singular when it is 1: `1 lesson learned`). A pass that writes nothing uses `0 lessons learned`. A pass that fails, or does not run, keeps `learning` with `active: false`, `error` (a plain sentence), and `errorCode`. A successful `save-key`, `activate-key`, or `activate-provider` (a provider that actually turns on) clears `learning.error` and `learning.errorCode`. `lastLearnedAt` does not move. A pass that wrote cards and also hit an error still sets `learningResult` for the cards that did land.

`scheduled` is true only when the learning timer is actually registered for this knowledge folder. The host registers it when it starts and the saved settings already have a username, email, team, an active key, and a model. It registers again after the save that completes those, with no `register` action from the window. A second start or a second save does not register twice. `scheduled` stays false until that registration is stored.

`share` is the one team-Drive switch. It is `false` on first run and when `settings.json` has no `share` field. An old `autoDrop: true` does not turn it on. `lastSharedAt` is an ISO time set only when a lesson file is actually written into the team folder, and `null` until that happens. An identical file already there does not move `lastSharedAt`.

Lesson files sit directly in the chosen team folder. The names are `<writer id>-<uuid>.json` and the matching `.md`. There is no `Dropzone` directory and no per-person subfolder. The writer id is the username slug plus a four-character `installId` stored once in `settings.json`.

`shareStartedAt` is the ISO time `set-share` last turned sharing on, or `null` if it never has. It is replaced each time sharing is turned on. It stays when sharing is turned off.

Each graph card has `shareState`: `shared` when a copy is in the team folder (it stays `shared` while sharing is off), `waiting` when the card was stamped shareable, sharing is on, a folder is set, and the copy is not there yet, and `local` for everything else. `synced` is true for `shared`, including another writer's lesson. Another writer's lesson also has `writer` set to that person's name. A card is stamped `shareEligible` only at the moment it is learned, and only when sharing is on, a team folder is set, and `scope` is `work`. Updating a lesson does not change that stamp. A missing stamp is not eligible. Only lessons learned from now on are shared. Earlier lessons stay on this PC.

`shareAvailable` is `false` while `TEAM_SHARING_AVAILABLE` is off (`local-memory/src/team-sharing.ts`). In that state team sharing is not available in this version. `set-share` and `set-auto-drop` return `share_unavailable` and do not change the switch. Nothing is written to the team folder and the folder is not created, even when saved settings already say sharing is on and the app is restarted. The commit that proves old lessons stay on this PC, and two installs with the same name do not overwrite each other, sets the flag to `true`.

`lastLearnedAt` is an ISO time stored in settings and set when a pass ends without being cancelled, including a pass that writes nothing. It is `null` until then, and it is still there after a restart. A failed pass does not move it. An empty rerun sets `learning` to `null` and `learningResult` to `{ lessons: 0, chats: 0, text: "0 lessons learned" }`. It does not call the model and it does not report `learning.active`. A saved key whose secret is gone returns `secret_missing`. `learning.error` contains `No secret stored`, and `lastLearnedAt` does not move.

`cadence` from the host is only `1h` or `manual`. A saved 15m or 30m interval is loaded as `1h`.

Token fields (`learningTokens`, `learningTokensUnreported`) stay in the JSON until the telemetry cut lands. The UI should not add new token UI. The host will stop incrementing them.

Providers in `providers` are only `cursor`, `anthropic`, and `openai`. Copilot remains a transcript source (`sources`), not a key. Custom is not offered.

## Actions

### `pick-folder`

Request:

```json
{ "action": "pick-folder", "purpose": "knowledge" }
```

`purpose` is `knowledge` (local card folder) or `share` (team Drive folder). The host opens the native folder dialog. Cancel leaves paths unchanged and sets no error.

The chosen path is checked before it is saved: it exists, it is a directory, and a probe file can be created and deleted. Failure uses the path codes above and does not change the saved path.

Success with `knowledge` updates `vaultPath`. Success with `share` updates `drivePath` and does not turn `share` on by itself.

Typed paths use the same checks:

```json
{ "action": "set-knowledge", "path": "C:\\Users\\ada\\.sharlie\\knowledge" }
{ "action": "set-drive", "path": "G:\\My Drive\\Sharlie" }
```

`set-knowledge` and `set-drive` stay. Invalid paths refuse with the same codes.

### `set-share`

```json
{ "action": "set-share", "enabled": "true", "path": "G:\\My Drive\\Sharlie" }
```

`path` is optional when a share path is already stored. `enabled: "false"` turns sharing off and leaves the path stored.

While `shareAvailable` is `false`, both `enabled` values return `share_unavailable` with `Team sharing is not available in this version.` The saved switch and path stay as they were.

Off means nothing is copied. On means a waiting shareable work lesson is written immediately, and again on the publisher schedule. A personal lesson, a lesson with no scope, and a work lesson learned while sharing was off are not written. The local folder still keeps those cards. That on-path is inactive until `shareAvailable` is `true`. Turning sharing on publishes at once, so a lesson that is already waiting is not left until the next hour.

`set-auto-drop` remains as an alias of `set-share` so the current settings form does not break. `enabled: "true"` without a valid path returns `share_needs_path` and leaves `share` false. While sharing is unavailable, the alias returns `share_unavailable` instead.

### `set-cadence`

```json
{ "action": "set-cadence", "cadence": "1h" }
```

Accepted: `1h`, `manual`. `manual` stores a 0 interval (no timer). `15m` and `30m` return `cadence_too_short` and the stored cadence stays `1h` or `manual`, whichever it already was. Default for a new settings file is `1h`.

`set-learner-interval` and `set-publisher-interval` take `hours`. Only `0` (manual) and `1` are stored. Values below 1 return `cadence_too_short` and do not change the interval. Any other value is rejected and does not change the interval. The learner and the publisher share this rule. A saved interval under one hour is rewritten to one hour the next time settings are loaded. Manual stays manual.

### `cancel-learning`

```json
{ "action": "cancel-learning" }
```

Same effect as the `cancel-learning` invoke and `sharlie.cancelLearning()`.

The current pass stops before the next model call and before the next card write. A call that has not started is not sent. Cards already written stay. `lastLearnedAt` does not move. Transcripts that were fully written stay marked imported. The one in flight is not marked, so a later pass can read it. `learning` goes to `null`. `learningResult.text` is `Learning cancelled · N lessons learned` with the count written before the stop. Calling cancel when nothing is running returns the snapshot with no error.

### `start-learning`

Unchanged request: `{ "action": "start-learning" }`.

On success the host pushes `learning` events. `sources` and `chatsFound` are filled before the first card write, so the window can show `Cursor, Claude CLI · 412 chats` and then `37 of 412 chats`.

The first pass sends at most the newest 50 chats. Each transcript is cut to its newest 30,000 characters before the model call. Older chats from that backlog are marked seen and are not learned later. A later pass learns only chats that are new or changed. `learning.total` is the number this pass will read. The host does not start that work when `chatsFound` is 0.

### `recheck-sources`

```json
{ "action": "recheck-sources" }
```

Scans the installed tools again and returns the snapshot. Updates `sources`, `searched`, and `chatsFound`. Does not start learning and does not call the model. This is the only automatic-looking rescan, and it runs only when the person asks.

## Lookup and the shared folder

`lookup` still reads the local knowledge folder, personal cards included.

When `share` is on, the host also scans the share folder. A file there is context only when it contains `scope: work`. Unscoped files in the share folder are ignored. The host does not call the Google Drive API.

## Packaged smoke

`SHARLIE_MOCK_MODEL=1` does nothing on a normal launch. The mock model runs only when that variable is set and the process was started with `--smoke`. That path starts the host, learns one fixture chat, checks that a second pass makes no model call, checks that a planted secret is absent from the card, and checks that `scheduled` is true after the key is saved. A crash or a missing result exits non-zero.

Windows login uses `app.setLoginItemSettings` (`openAtLogin`, per user). The installer does not ask for an administrator. `--register-login` and `--unregister-login` always exit, including when the login-item call throws.

## What the UI does not need to send

No Neo4j id, no service account, no Copilot key, no custom base URL, no token count. Model parameter controls are Advanced: `set-model-param` stays for Cursor, and it is not required before `start-learning` once the host cut lands. Until that cut, the current effort/fast gate still applies to a Cursor key.
