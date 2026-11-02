# Installing Sharlie on Windows

For Liviu, on your own Windows PC. About ten minutes. Everything below was checked against the code on `main`; anything not yet tried on a real Windows PC is marked *(not yet checked on Windows)*. Lines starting **[DEV NOTE]** are for the team and get deleted when that work lands.

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
4. **Team sharing** (optional). It says **Off. Everything stays on this PC.** You can leave it off.

Then press **Start learning**. A strip at the top shows "Learning… 37 of 412 chats" and has a **Cancel** button. Lessons already written stay if you cancel. You can use the window while it learns.

After your first **Start learning**, Sharlie learns new chats on its own every hour while it runs (it starts with Windows, in the tray). The status line at the top says **Learns every hour**, then adds **last learned …** after a pass. **Learn now** on Home learns right away. To learn only when you ask, open **Settings → Advanced → When to learn** and pick **Only when I start it**; the status line then says **Learns when you ask**.
> **[DEV NOTE]** A 15 or 30 minute choice returns `cadence_too_short`. A saved interval under an hour is kept as one hour.

> **[DEV NOTE]** Coming in this build: the first pass is planned to read only your newest 50 chats and leave older ones for later. Today it reads every new chat, newest first.

## 4. Team folder (sharing with your team)

Sharlie never talks to Google Drive itself. **Team sharing is off until you turn it on.**

1. Install **Google Drive for Desktop** and let it sync your team's shared folder to this PC (for example `G:\My Drive\Sharlie`).
2. In Sharlie, open **Settings → Team sharing** and turn on **Share work lessons with my team's Drive folder**.
3. A folder picker opens: choose that synced folder as your Team folder. Sharing turns on and Settings shows **Sharing to G:\My Drive\Sharlie**. Use **Change folder** to pick another.

When it is on, only lessons marked **work** are copied, into `Dropzone\<your Name>` inside the Team folder (for example `G:\My Drive\Sharlie\Dropzone\Liviu`). **Personal lessons never leave this PC.** A lesson that isn't marked work counts as personal. Drive for Desktop does the uploading. Each lesson shows **Only on this PC**, **Waiting to share** or **Shared**. Turning sharing off stops new copies; lessons already copied stay in the Team folder.

Only lessons learned from now on are shared. Earlier lessons stay on this PC.
> **[DEV NOTE]** Pending the host's share-start change: on main today, the first share copies every work lesson, including ones learned before sharing was turned on. Delete this note when that change lands.

If the folder you pick doesn't exist, or Sharlie can't write to it, Settings says so ("That folder does not exist." or "Sharlie cannot write to that folder.") and sharing stays off. Pick another folder and turn it on again.

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
