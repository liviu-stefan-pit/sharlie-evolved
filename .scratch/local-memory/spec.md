# Local memory

Status: ready-for-agent

## Problem Statement

Lessons from coding sessions are trapped in the transcripts of several tools. A person finishes a fix or settles a convention, then the next session starts blank, and a teammate on another machine cannot see it either. Copying those transcripts into one growing document makes a pile that is hard to navigate and unsafe to share, because chats contain other people's names, keys, and passwords. The person wants the useful lesson pulled out on its own, kept on the machine, and, when it would help the team, copied to a Drive folder they already sync. They want to look the lessons up again from the IDE and from a graph, without stopping the capture to approve each card.

## Solution

A desktop app for Windows and macOS records two background jobs. While the person is logged in, a learner reads new transcripts from the coding tools installed on the machine and writes one markdown card per lesson into a local knowledge folder. A publisher copies only the work cards into a Drive folder the person chose. Personal cards stay on the machine. The same active key that writes the cards also answers lookups: it sees every card's name and summary, then the full text of the cards it needs. A graph in the app draws the whole local folder. GitHub and the company graph are not part of this version.

## User Stories

1. As a person installing the app, I want the installer to register the learner and the publisher, so that learning and copying start without me leaving a window open.
2. As a person removing the app, I want uninstall to unregister both jobs, so that nothing keeps running afterward.
3. As a person using the app, I want to register and unregister the jobs from the window, so that I can pause the system without uninstalling.
4. As a person using the app, I want the jobs to start when I log in and stop when I log out or the machine shuts down, so that they run only in my session.
5. As a person using the app, I want to open and close the window whenever I like, so that the jobs do not depend on the window staying open.
6. As a person setting up, I want the learner to stay idle until I have saved a username, an email, and a team, so that every card has an author and a team folder.
7. As a person setting up, I want the learner to stay idle until I have saved an SDK key, so that it never calls a model without credentials.
8. As a person setting up, I want to save four SDK keys, Cursor, Copilot, Anthropic, and OpenAI, and keep exactly one active, so that the highest saved key in that order is the one in use until I press Use, and saving another key later does not replace the pin.
9. As a person setting up, I want the keys stored in the operating system vault, so that they are not written into an ordinary settings file.
10. As a person setting up, I want the background model chosen in the app when the active key is Anthropic or OpenAI, so that I control which model writes and reads the knowledge.
11. As a person with an Anthropic key, I want the default model to be Haiku 5.5, with Sonnet 5.5 and Opus 5.5 also listed, so that the cheap model runs unless I choose otherwise.
12. As a person with an OpenAI key, I want the default model to be GPT-6 Luna, with GPT-6 Sol and GPT-6 Astra also listed, so that the cheap model runs unless I choose otherwise.
13. As a person working in Cursor or Claude, I want the discovery skill to name the model the app is using, so that I can see it in the IDE.
14. As a person working in Cursor or Claude, I want that chat to use the model I selected in the IDE, so that the app does not change the IDE's picker.
15. As a person opening the app, I want it to scan for Cursor, Copilot in VS Code, Claude, Cursor CLI, Claude CLI, and Copilot CLI, so that I see which of those tools this machine has.
16. As a person opening the app, I want a label only for tools that are installed, so that missing tools do not fill the window.
17. As a person opening the app, I want each installed tool shown as an indicator, so that I can see what this machine has.
18. As a person opening the app, I want those indicators to stay non-clickable, so that learning reads every installed tool.
19. As a person on a first run, I want every existing transcript imported, newest first, so that the knowledge starts from the work I already did.
20. As a person on a first run, I want that import to proceed in batches while I am logged in, so that years of chat are not forced into one model call.
21. As a person after the import, I want each later run to read only transcripts that changed since the last success, so that a period while the machine was off is still picked up and old history is not reread.
22. As a person learning from several tools, I want one pass to read every enabled source together, so that the same lesson is not stored twice in different words.
23. As a person setting the schedule, I want the learner interval to default to one hour and to refuse anything shorter, so that model calls stay bounded.
24. As a person reading the folder, I want each lesson in its own markdown file, so that I can open a card directly.
25. As a person reading a card, I want the fields in the front matter and the lesson in the body, so that people and agents see the same shape.
26. As a person trusting the folder, I want a card that is missing a required field to be left unwritten, so that the knowledge never contains a partial lesson.
27. As a person who works in more than one language, I want the summary and the lesson to stay in the language of the source chat, so that the wording is the one from the work.
28. As a person coming back to an old lesson, I want each of the four lesson parts kept to about 120 words, so that updates do not make the card endlessly long.
29. As a person whose new chat repeats a known claim, I want that card rewritten in place, so that the folder does not fill with twins.
30. As a person whose new chat adds a different claim, I want a new card that shares a topic with the old one, so that the two stay linked without being merged.
31. As a person whose same lesson showed up in a second tool, I want that tool added to the card's sources, so that the origin stays visible.
32. As a person sharing a team folder, I want the filename to be a readable name plus the card id, so that two people do not overwrite each other.
33. As a person sharing a team folder, I want the id to be a UUID stored in the front matter as well, so that the card keeps a stable identity.
34. As a person with a private lesson, I want it filed under personal, so that notes that would not help a teammate stay on my machine.
35. As a person with a reusable lesson, I want it filed under work and my team name, so that the shared folder is split by team.
36. As a person browsing work cards, I want no further folders inside the team folder, so that the Drive copy stays flat.
37. As a person publishing, I want personal cards left out of the copy, so that they never reach Drive.
38. As a person filing a lesson, I want an existing project name from the knowledge reused when the lesson belongs to it, so that one project does not split into two spellings.
39. As a person filing a lesson, I want the tool's repo or workspace name used when the knowledge has no match, so that the recorded location is kept.
40. As a person filing a lesson, I want a short project name taken from the subject only when the chat is clearly about one product or repo, so that a real project is not dropped.
41. As a person filing a general technique, I want the project set to none, so that a technique does not become a fake project.
42. As a person whose chats mention other people, I want those names removed from the title, the lesson, and the topics before the file exists, so that the knowledge does not keep them.
43. As a person whose chats contain keys, tokens, or passwords, I want them replaced with `[redacted]` before the file exists, so that secrets are not stored or copied to Drive.
44. As a person reading a card, I want my username, email, and team left in place, so that the lesson stays attached to me.
45. As a person reading a card, I want project names and code kept, so that the lesson is still usable.
46. As a person who shares with Drive, I want to set the folder path in the app, so that work cards are copied there.
47. As a person who shares with Drive, I want the copy to keep the same folders and the same file bytes, so that Drive holds the cards unchanged.
48. As a person who removes the model key, I want publishing to continue, so that sharing does not depend on the model.
49. As a person who wants everything local, I want publishing to stay off when the Drive path is empty, so that nothing is uploaded.
50. As a person setting the schedule, I want the publisher interval to default to one hour and to refuse anything shorter, so that copies stay bounded.
51. As a person who already runs the Drive client, I want the app to write files and not sign into Google, so that the client I installed does the upload.
52. As a person asking the knowledge a question, I want the lookup to send every card's file name and summary first, so that the model can see the catalog without every full lesson.
53. As a person asking the knowledge a question, I want the full text of only the cards the model picks, so that the answer is grounded in those lessons.
54. As a person in Cursor or Claude, I want a discovery skill that points at the local knowledge and names the model, so that the IDE can find the cards.
55. As a person on this machine, I want personal and work cards both included in lookup and in the graph, so that the local knowledge is the whole folder.
56. As a person reviewing the knowledge, I want to click a node in the graph and see what is in it, so that I can look at a lesson after it has already been written.
57. As a person looking at the window, I want the graph drawn with force-graph on the Nord palette, so that the view matches the dark Nordic screens: canvas `#2e3440`, panels `#3b4252`, text `#eceff4`, ice accent `#88c0d0`, and `#a3be8c` only for the synced status.
58. As a teammate opening the shared Drive folder, I want to see work cards grouped by team and nothing personal, so that I can read reusable lessons from the people on that team.

## Implementation Decisions

- The app is an Electron shell on Windows and macOS. The window is for settings, identity, the model, the tool list, and the graph. It is not the process that learns or publishes.
- Two scheduled jobs run in the user session. They are registered at install, removed on uninstall, and can be registered or unregistered from the window. They start at login and stop at logout or shutdown.
- The learner and the publisher have separate intervals. Each defaults to one hour. The window refuses a value under one hour.
- The learner runs only when an SDK key is saved and username, email, and team are all saved. Otherwise it does not run. On an empty graph the person presses Start learning. That click does nothing until the profile is complete and the active SDK has a model list. The hourly job stays idle until that click succeeds.
- The first learner run after those are present imports all existing transcripts from the enabled tools, newest first, in batches, back to back while the session lasts. When that import finishes, a run reads only transcripts changed since the last successful run.
- One learner pass reads every enabled source before it writes, so the same claim from two tools becomes one card. The card's sources list gains the extra tool.
- Enabled sources are the installed members of this set: Cursor, Copilot in VS Code, Claude, Cursor CLI, Claude CLI, and Copilot CLI. The window lists only the ones it finds, as indicators. Every installed tool is read.
- A person can save four SDK keys: Cursor, Copilot, Anthropic, and OpenAI. Exactly one is active. All keys live in the operating system credential store.
- Cursor is the default, then Copilot, then Anthropic, then OpenAI. When the person has not pinned a key, the highest saved key in that order is the one in use. Pressing Use pins that key, and saving another key later does not replace the pin.
- Anthropic offers `claude-haiku-5-5` (default), `claude-sonnet-5-5`, and `claude-opus-5-5`. OpenAI offers `gpt-6-luna` (default), `gpt-6-sol`, and `gpt-6-astra`. No other model ids for those two. A saved Cursor key stores the model ids and display names Cursor returns for it, and the first id stays selected until the person picks another. Copilot has no model list. When the active key has a model list, that chosen model writes cards, chooses personal or work, chooses update or new, and answers lookups.
- A discovery skill for Cursor and a discovery skill for Claude name the chosen model and point at the local knowledge. An IDE chat uses the model selected in that IDE. The app does not change the IDE's picker.
- A lookup sends every card's file name and summary, then the full text of the cards the model selects. Personal and work cards on the machine are both included.
- Each card is one markdown file. Front matter holds `id`, `at`, `author.username`, `author.email`, `author.team`, `scope` (`personal` or `work`), `sources`, `project`, `title`, `topics`, and `summary`. The body is four prose parts: the situation, what to do, why, and how someone who was not in the chat applies it. A missing required field means the card is not written.
- `summary` is one or two sentences. Each lesson part stays within about 120 words. The summary and the lesson stay in the language of the source chat. `at` is the UTC time on the card.
- The same claim rewrites the existing card inside that size. A different claim creates a new card that shares a topic. An update does not append.
- The author fields are copied from the profile. Email is the person identity. The team string is exact: the same string is the same team.
- `project` is chosen in order: reuse an existing knowledge project when the lesson belongs to it; otherwise the repo or workspace the tool recorded; otherwise a short name when the chat is clearly about one product or repo, and that spelling is reused from then on; otherwise `none`. A general technique stays `none`.
- Scope is `personal` when the lesson would not help another person on the team, and `work` when it would. Personal cards go in `personal/`. Work cards go in `work/<team>/` with no folders under the team. The agent chooses the folder with that test.
- The filename is a readable name, unique in its folder, ending with the card id. The id is a UUID and is also stored in the front matter.
- Before the file is written, other people's names are removed from the title, the lesson, and the topics, and keys, tokens, and passwords are replaced with `[redacted]`. Project names and code stay. The stored file is the scrubbed card, and the Drive copy is that same file.
- The publisher copies `work/` to the Drive path the person set, preserving folders and file bytes. It does not need the model key. It does not sign into Google. An empty Drive path means it does not run.
- The graph draws the whole local tree, personal included, using force-graph. A click shows what is in that node. The web is the person, the team, the project, the source, the topic, and the card between them, taken from the cards in the folder. Colors are Nord: canvas `#2e3440`, panels `#3b4252`, text `#eceff4`, accent `#88c0d0`, synced status `#a3be8c`.

## Testing Decisions

The product does not exist in this repo yet, so there is no existing test seam to extend. The seam is the knowledge pipeline as seen from outside: given a profile, a key, a set of transcripts, and a Drive path, the local folder and the Drive folder contain the right cards, and a lookup returns summaries then the chosen bodies. Tests assert those files and that lookup result. They do not assert how a job is scheduled, how the window is drawn, or which library reads a transcript.

A good test feeds transcripts and settings in, then reads cards, the published tree, and the lookup payload out. It covers a missing profile, a missing key, a first import, a later run that sees only changes, a repeated claim, a second claim, a personal card that is not published, a scrubbed secret, a shared filename that does not collide, a project reused from the knowledge, a project left as `none`, and an interval refused when it is under one hour.

There is no prior test suite in this repo to copy.

## Out of Scope

- GitHub, a company database, and an MCP server that reads that database. The Drive folder is the end of the pipeline in this version.
- Signing into Google, or any upload other than writing into a folder the person already syncs.
- A review step before a card is written. Inspection happens afterward, in the graph, the local folder, or Drive.
- A second model for search or for yes-or-no decisions. Embeddings, a local vector index, and a separate decision model are not part of this version.
- Topic folders, an inbox, or an archive. The team folder is flat.
- An interval shorter than one hour.
- Showing tools that are not installed.
- Changing the model selected inside an IDE chat.
- Teaching Copilot a discovery skill. The skills in this version are for Cursor and Claude. Copilot remains a transcript source.

## Further Notes

The capture is automatic on purpose. The size limit, the scrub, and the personal folder are what keep that from filling the shared folder with raw chats.

