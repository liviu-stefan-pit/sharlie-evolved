# Installing Sharlie on Windows

For Liviu, on your own Windows PC. About ten minutes. Everything below was checked against the code on `main`; anything not yet tried on a real Windows PC is marked *(not yet checked on Windows)*.

## 1. Windows will warn you first: "More info", then "Run anyway"

The installer is not code-signed yet, so when you open it Windows SmartScreen says **"Windows protected your PC"**. Click **More info**, then **Run anyway**. That is expected for this build.

To get the installer:

1. Sign in to GitHub (downloads need a signed-in account).
2. Open `github.com/liviu-stefan-pit/sharlie-evolved` → **Actions** → **build-win**.
3. Open the newest run on `main` with a green tick → **Artifacts** → **Sharlie-Setup**. It downloads as a zip.
4. Unzip it first (right-click → **Extract All**). Inside is **Sharlie Setup 0.1.0.exe**. Open that file, not the zip.

## 2. Install

- The installer does not ask who to install for and it does not ask for administrator rights. It installs only for you, into `%LOCALAPPDATA%\Programs\Sharlie`.
- At the end of the install, Sharlie registers itself to start quietly in the tray each time you sign in. That is a per-user login item (`setLoginItemSettings`). It does not create a scheduled task. Uninstalling turns that login start off. The install step exits on its own; it does not wait on the window. *(Not yet checked on Windows.)*

## 3. First run: four steps

The window says **"Sharlie learns from your work on this computer"**. It reads the chats your coding tools already save and keeps short lessons on this PC. It removes secrets such as keys and passwords, and other people's email addresses, before anything is sent to the AI.

1. **Found on this PC.** Sharlie lists the chats it found, e.g. "Cursor · 412". If it found none, see section 6.
2. **About you.** Name, Email, Team. Each field saves when you leave it.
3. **AI key.** Pick a provider (Anthropic, OpenAI or Cursor), paste your key, then press **Save key**. The key goes into **Windows Credential Manager** under `sharlie-local-memory`, through the OS keyring. It is never written to a file.
4. **Team sharing** (optional). It says **Team sharing isn't available in this version. Your lessons stay on this PC.**

Then press **Start learning**. The first pass learns at most your newest 50 chats, newest first. A chat longer than 30,000 characters is cut to its newest 30,000. The strip shows "Learning… 37 of 50 chats" and has a **Cancel** button. Lessons already written stay if you cancel. You can use the window while it learns. If you have more than 50 chats, the strip says so when the pass ends: "Learned the newest 50 chats. Older chats stay unread; later passes learn only new chats." If a chat was cut, it adds "1 chat was cut to its newest 30,000 characters." Older chats from before that pass stay unread. Later passes learn only chats that are new or changed.

After your first **Start learning**, Sharlie learns new chats on its own every hour while it runs (it starts with Windows, in the tray). Before the first pass the status line at the top says **Ready to learn**. After it, it says **Learns every hour** and adds **last learned …**. **Learn now** on Home learns right away. To learn only when you ask, open **Settings → Advanced → When to learn** and pick **Only when I start it**; the status line then says **Learns when you ask**.

## 4. Team sharing

Team sharing isn't available in this version. Your lessons stay on this PC. In **Settings → Team sharing** the switch is off and can't be turned on, and work lessons show **Only on this PC**. Sharlie never talks to Google Drive itself, and it writes nothing into a team folder.

## 5. What Sharlie writes, and where

`%USERPROFILE%` is your user folder, e.g. `C:\Users\Liviu`.

| What | Where |
| --- | --- |
| Settings (profile, chosen model, schedule; never the key) | `%USERPROFILE%\.sharlie\knowledge\settings.json` |
| Which chats were already learned | `%USERPROFILE%\.sharlie\knowledge\ingest-log.json` |
| Lessons (cards, `.json` + `.md`) | `%USERPROFILE%\.sharlie\knowledge\cards\` (plus `inbox\` and `archive\` beside it) |
| Where your knowledge folder is | `%USERPROFILE%\.sharlie\<your Windows user name>.json` |
| Your AI key | Windows Credential Manager, `sharlie-local-memory` |

Other people's email addresses and secrets are removed before anything is sent. Names are not removed from what is sent to the AI, only from saved lessons when Sharlie spots them.

Sharlie does not change any Cursor, Claude or VS Code settings or MCP config files, and it does not add skill files under those tools. It keeps no log files; errors show in the window.

## 6. If nothing is found

Sharlie only reads tools it finds installed, and only in these folders:

- **Cursor** (installed at `%LOCALAPPDATA%\Programs\cursor\Cursor.exe`): `%USERPROFILE%\.cursor\projects` and `.cursor\plans`
- **Cursor CLI:** `%USERPROFILE%\.cursor\chats`
- **Claude CLI / Claude Code:** `%USERPROFILE%\.claude\projects`
- **Claude desktop:** `%APPDATA%\Claude\local-agent-mode-sessions`
- **Copilot in VS Code** (needs a `github.copilot-*` extension in `%USERPROFILE%\.vscode\extensions`): `%APPDATA%\Code\User\workspaceStorage` and `...\globalStorage\emptyWindowChatSessions`
- **Copilot CLI:** `%USERPROFILE%\.copilot\session-state`

Press **Show where I look** to see the exact folders on your PC. Use one of the tools for a while, then press **Check again** to look right away. Sharlie also looks again each time its window refreshes.

If your chats live somewhere else (for example Cursor installed for all users under Program Files, or VS Code Insiders), Sharlie won't see them yet, because there is no setting to add a folder. Press **Show where I look** and send that list to the team.

## If it won't start

The window shows one plain sentence and a **Retry** button. Do what the sentence says, then press **Retry**. The technical text is under **Details** if you want to send it to the team.

## If Sharlie looks empty after a crash or power cut

Sharlie keeps a small list of its learning folders in `%USERPROFILE%\.sharlie\<your Windows user name>.json`. If a crash or power cut damaged that file, Sharlie starts fresh and does not say so. The old file is saved next to it as `<your Windows user name>.json.bak`. To get it back, close Sharlie (also from the tray), copy the `.bak` file over the `.json` file, then open Sharlie again.
