# 11: Learn from the installed tools

**What to build:** With a username, an email, a team, and an active key saved, the learner reads the transcripts of the tools installed on this machine and calls whichever of the four keys is active, Cursor, Copilot, Anthropic, or OpenAI, to write or update one scrubbed card per lesson. Copilot has no model list. Cursor uses the list stored for that key. Anthropic and OpenAI use their built-in lists. The chosen model is the one selected in the app. The first run imports the history that is already there. Later runs read only what changed. A question from Cursor or Claude is answered from those cards by that same active key.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] The learner reads transcripts from each installed tool: Cursor, Copilot in VS Code, Claude, Cursor CLI, Claude CLI, and Copilot CLI
- [ ] An installed tool is read even if it was previously turned off
- [ ] The learner calls whichever of the four keys is active, and that call is what writes or updates the card
- [ ] Until username, email, and team are all saved, the learner does not run
- [ ] Until an active key is saved, the learner does not run
- [ ] The first run after the profile and an active key are present imports every existing transcript from the installed tools
- [ ] That import proceeds newest first
- [ ] The import proceeds in batches, back to back, while the person is logged in
- [ ] A long history is not sent as one model call
- [ ] After the import finishes, a run reads only transcripts that changed since the last successful run
- [ ] Transcripts that arrived while the machine was off are picked up on the next run
- [ ] A later run does not reread history that was already imported successfully
- [ ] One pass reads every installed source together before it writes, so the same claim from two tools becomes one card
- [ ] The card that lands in the local folder is one scrubbed markdown lesson, filed under `personal/` or `work/<team>/`, with secrets replaced by `[redacted]` and other people's names removed
- [ ] A lookup from Cursor or Claude, through the discovery skill, sends every card's file name and summary first, then the full text of only the cards the model picks
- [ ] Personal cards and work cards on this machine are both included in that lookup
- [ ] The active key answers the lookup. When that key is Anthropic or OpenAI, the model is the one chosen in the app, and the IDE's model picker is left as it is
