# 02: Write one scrubbed lesson card

**What to build:** Once a profile and an active key are saved, one transcript becomes one markdown card the person can open. The card carries its identity, author, scope, sources, project, title, topics, and summary in the front matter, and the lesson as four short prose parts in the body. A private lesson stays in the personal folder. A lesson a teammate could reuse goes in that team's folder, with no folders inside the team. The file is scrubbed before it exists: other people's names are gone, secrets are replaced, and the person's own identity, project names, and code remain. A card that is missing a required field is never written.

**Blocked by:** 01 Gate learning on profile, key, and model

**Status:** ready-for-agent

- [x] Each lesson is its own markdown file
- [x] Front matter holds `id`, `at`, `author.username`, `author.email`, `author.team`, `scope` (`personal` or `work`), `sources`, `project`, `title`, `topics`, and `summary`
- [x] The body is four prose parts: the situation, what to do, why, and how someone who was not in the chat applies it
- [x] `summary` is one or two sentences
- [x] Each of the four lesson parts stays within about 120 words
- [x] The summary and the lesson stay in the language of the source chat
- [x] `at` is the UTC time on the card
- [x] Author username, email, and team are copied from the saved profile
- [x] The same team string is the same team
- [x] A lesson that would not help another person on the team is `personal` and is filed in `personal/`
- [x] A lesson that would help a teammate is `work` and is filed in `work/<team>/`
- [x] Nothing is nested inside the team folder
- [x] The filename is a readable name, unique in its folder, ending with the card id
- [x] The id is a UUID, and the same id is stored in the front matter
- [x] Two cards in one shared team folder do not overwrite each other
- [x] A card missing any required field is left unwritten
- [x] Before the file exists, other people's names are removed from the title, the lesson, and the topics
- [x] Before the file exists, keys, tokens, and passwords are replaced with `[redacted]`
- [x] The person's own username, email, and team stay on the card
- [x] Project names and code stay on the card
- [x] The file that is stored is the scrubbed card
- [x] `project` reuses an existing knowledge project when the lesson belongs to it
- [x] When the knowledge has no matching project, `project` is the repo or workspace name the tool recorded
- [x] When the tool recorded no repo, `project` is a short name taken from the subject only when the chat is clearly about one product or repo, and that spelling is reused from then on
- [x] A general technique, and any chat that is not clearly about one product or repo, sets `project` to `none`
