# 10: Open the window

**What to build:** The person launches the desktop app on Windows or macOS and gets the window. It is where they set who they are, the key, the model, which installed tools to learn from, the Drive folder, and the two intervals, and where they look at the graph. The jobs do not live in this window: opening it does not start them, and closing it does not stop them.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [x] The person can launch the app on Windows and on macOS and see the window
- [x] The window uses the Nord palette: canvas `#2e3440`, panels `#3b4252`, text `#eceff4`, accent `#88c0d0`
- [x] Username, email, and team can be saved and are still there the next time the window opens
- [x] Until username, email, and team are all saved, the learner does not run
- [x] More than one SDK key can be saved, and exactly one is active
- [x] Switching the active key does not require retyping the keys already saved
- [x] Keys are stored in the operating system vault and are not written into an ordinary settings file
- [x] An Anthropic key offers `claude-haiku-5-5` as the default, plus `claude-sonnet-5-5` and `claude-opus-5-5`
- [x] An OpenAI key offers `gpt-6-luna` as the default, plus `gpt-6-sol` and `gpt-6-astra`
- [x] No other model is offered
- [x] The person can choose the model in the window, and that model is the one that writes cards and answers lookups
- [x] Saving the key and the model updates the Cursor and Claude discovery skills so they name that model and point at the local knowledge
- [x] An IDE chat keeps the model selected in that IDE
- [x] The window shows a label only for the installed members of Cursor, Copilot in VS Code, Claude, Cursor CLI, Claude CLI, and Copilot CLI
- [x] Each installed tool starts enabled
- [x] Turning an installed tool off skips its transcripts, and turning it back on includes them again
- [x] The person can set the Drive folder path in the window
- [x] An empty Drive path means the publisher does not run
- [x] The learner interval and the publisher interval each default to one hour
- [x] The window refuses a learner or publisher interval shorter than one hour
- [x] The person can register both jobs from the window, and can unregister both to pause the system without uninstalling
- [x] Opening the window does not by itself start learning or publishing
- [x] Closing the window does not stop a registered job
- [x] The graph draws every local card, personal and work, with force-graph
- [x] A node is a person, a team, a project, a source, a topic, or a card, and the links come from the cards in the local folder
- [x] A work card that the publisher has copied shows as synced, in `#a3be8c`
- [x] A card that has not been copied does not show as synced
- [x] `#a3be8c` is used only for the synced status
- [x] Clicking a node shows what is in it
