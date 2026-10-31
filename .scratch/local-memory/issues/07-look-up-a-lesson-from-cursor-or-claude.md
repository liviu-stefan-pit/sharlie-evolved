# 07: Look up a lesson from Cursor or Claude

**What to build:** From Cursor or from Claude, a person can ask the local knowledge a question. The lookup first shows the model every card's file name and summary, personal and work together, then the full text of only the cards the model picks. The model that answers is the model chosen in the app. A discovery skill in each of those two tools points at the local knowledge and names that model. The chat itself keeps whatever model the person selected in the IDE.

**Blocked by:** 02 Write one scrubbed lesson card

**Status:** ready-for-agent

- [x] A lookup sends every card's file name and summary first
- [x] The lookup then sends the full text of only the cards the model picks
- [x] Personal cards and work cards on this machine are both included
- [x] The model that answers is the model chosen for the app, the same one that writes cards
- [x] A Cursor discovery skill points at the local knowledge and names that model
- [x] A Claude discovery skill points at the local knowledge and names that model
- [x] A chat in Cursor or Claude uses the model selected in that IDE
- [x] The app does not change the IDE's model picker
