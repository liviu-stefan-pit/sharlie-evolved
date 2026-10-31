# 03: Show only installed tools, on until turned off

**What to build:** Opening the app shows which of the known coding tools this machine actually has. Each installed tool is an indicator, not a control, and learning reads every one of them. A tool that is not installed does not appear, and its transcripts are not read.

**Blocked by:** 01 Gate learning on profile, key, and model

**Status:** ready-for-agent

- [x] The app scans for Cursor, Copilot in VS Code, Claude, Cursor CLI, Claude CLI, and Copilot CLI
- [x] The window shows a label only for the tools from that set that are installed
- [x] Tools that are not installed do not appear
- [x] Each installed tool is shown as an indicator
- [x] Those indicators are not clickable
- [x] Every installed tool's transcripts are read
