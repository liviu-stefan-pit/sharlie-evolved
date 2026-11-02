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

- The installer asks **"Who should this application be installed for?"** Pick **Only for me**. That choice needs no admin rights and installs into `%LOCALAPPDATA%\Programs\Sharlie`. (**Anyone who uses this computer** asks for admin; you don't need it.)
- At the end of the install, Sharlie adds a Windows scheduled task called **Sharlie** that starts it quietly in the tray each time you sign in. Uninstalling removes the task. *(Not yet checked on Windows: whether creating that task works without admin rights.)*

## 3. First run: four steps

The window says **"Sharlie learns from your work on this computer"**. It reads the chats your coding tools already save and keeps short lessons on this PC. It removes secrets such as keys and passwords, and other people's email addresses, before anything is sent to the AI.

1. **Found on this PC.** Sharlie lists the chats it found, e.g. "Cursor · 412". If it found none, see section 6.
2. **About you.** Name, Email, Team. Each field saves when you leave it.
3. **AI key.** Pick a provider (Anthropic, OpenAI or Cursor), paste your key, then press **Save key**. The key goes into **Windows Credential Manager** under `sharlie-local-memory`, through the OS keyring. It is never written to a file.
4. **Team sharing** (optional). It says **Off. Everything stays on this PC.** You can leave it off.

Then press **Start learning**. A strip at the top shows "Learning… 37 of 412 chats" and has a **Cancel** button. Lessons already written stay if you cancel. You can use the window while it learns.

After that, Home has a **Learn now** button to learn your newest chats again; the status line says **Learns when you open Sharlie** until the first pass of the session, then **Last learned …**.
> **[DEV NOTE]** Learning on open isn't wired up yet: the app never registers its learning job, so today new chats are learned only when you press **Learn now**. Don't promise hourly or background learning until the host reports a running schedule.

> **[DEV NOTE]** Coming in this build: the first pass is planned to read only your newest 50 chats and leave older ones for later. Today it reads every new chat, newest first.

## 4. Team folder (sharing with your team)

Sharlie never talks to Google Drive itself. The plan:

1. Install **Google Drive for Desktop** and let it sync your team's shared folder to this PC (for example `G:\My Drive\Sharlie`).
2. In Sharlie's **Settings**, choose that synced folder as the **Team folder**.
3. Turn on sharing. **Team sharing is off until you turn it on.**

When it is on, only lessons marked **work** are copied into a folder for you inside the Team folder. **Personal lessons never leave this PC.** A lesson that isn't marked work counts as personal. Drive for Desktop does the uploading.

> **[DEV NOTE]** Coming in this build: the host already copies only work lessons, and only while sharing is on. But the **Settings** controls for choosing the Team folder and switching sharing on haven't landed yet. Until they do, Settings says "Team sharing isn't available in this version yet", and nothing is shared.

## 5. What Sharlie writes, and where

`%USERPROFILE%` is your user folder, e.g. `C:\Users\Liviu`.

| What | Where |
| --- | --- |
| Settings (profile, chosen model, schedule; never the key) | `%USERPROFILE%\.sharlie\knowledge\settings.json` |
| Which chats were already learned | `%USERPROFILE%\.sharlie\knowledge\ingest-log.json` |
| Lessons (cards, `.json` + `.md`) | `%USERPROFILE%\.sharlie\knowledge\cards\` (plus `inbox\` and `archive\` beside it) |
| Where your knowledge folder is | `%USERPROFILE%\.sharlie\<your Windows user name>.json` |
| **[DEV NOTE]** A small skill that tells Cursor and Claude where your lessons are | `%USERPROFILE%\.cursor\skills\local-knowledge\SKILL.md` and `%USERPROFILE%\.claude\skills\local-knowledge\SKILL.md` |
| Your AI key | Windows Credential Manager, `sharlie-local-memory` |

Other people's email addresses and secrets are removed before anything is sent. Names are not removed from what is sent to the AI, only from saved lessons when Sharlie spots them.

Sharlie does not change any Cursor, Claude or VS Code settings or MCP config files. The only files it adds there are the two `SKILL.md` files above. It keeps no log files; errors show in the window.

## 6. If nothing is found

Sharlie only reads tools it finds installed, and only in these folders:

- **Cursor** (installed at `%LOCALAPPDATA%\Programs\cursor\Cursor.exe`): `%USERPROFILE%\.cursor\projects` and `.cursor\plans`
- **Cursor CLI:** `%USERPROFILE%\.cursor\chats`
- **Claude CLI / Claude Code:** `%USERPROFILE%\.claude\projects`
- **Claude desktop:** `%APPDATA%\Claude\local-agent-mode-sessions`
- **Copilot in VS Code** (needs a `github.copilot-*` extension in `%USERPROFILE%\.vscode\extensions`): `%APPDATA%\Code\User\workspaceStorage` and `...\globalStorage\emptyWindowChatSessions`
- **Copilot CLI:** `%USERPROFILE%\.copilot\session-state`

Press **Show where I look** to see the exact folders on your PC. Use one of the tools for a while, then press **Check again** to look right away. Sharlie also looks again each time its window refreshes. It never starts learning on its own because of a rescan.

If your chats live somewhere else (for example Cursor installed for all users under Program Files, or VS Code Insiders), Sharlie won't see them yet, because there is no setting to add a folder. Press **Show where I look** and send that list to the team.

## If it won't start

The window shows one plain sentence and a **Retry** button. Do what the sentence says, then press **Retry**. The technical text is under **Details** if you want to send it to the team.
