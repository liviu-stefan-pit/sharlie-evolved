# Shared lesson folder

The shared knowledge base is an ordinary folder on disk. A Google Drive for Desktop path is one such folder. The app reads and writes files at the path the person chose. It does not sign in to Google and it does not call the Drive API.

Several people can point their apps at the same folder. Each app reads whatever is already there, then adds its own lesson. A new lesson can point at lessons that were already in the folder. Those pointers live in the new lesson. The older files stay as they were.

## What is in the folder

Lessons sit side by side in the folder. There are no subfolders to keep in step, and there is no index file for two people to rewrite.

```
<shared folder>/
  ada-lovelace-k3f9-3f1a2c4e-5b6d-4e7f-8a9b-0c1d2e3f4a5b.json
  ada-lovelace-k3f9-3f1a2c4e-5b6d-4e7f-8a9b-0c1d2e3f4a5b.md
  grace-hopper-m2p8-9c02aabb-ccdd-4eef-8899-001122334455.json
  grace-hopper-m2p8-9c02aabb-ccdd-4eef-8899-001122334455.md
```

Each lesson is two files with the same id: one JSON file the app reads, and one Markdown file a person can read. A hidden file whose name starts with a dot is a temp file used while saving. It is not a lesson.

## Ids

An id is the writer id, a hyphen, and a random id:

`ada-lovelace-k3f9-3f1a2c4e-5b6d-4e7f-8a9b-0c1d2e3f4a5b`

The writer id is the person's name slug plus a four-character install id, for example `ada-lovelace-k3f9`. The slug is lower case. Spaces and punctuation become a single hyphen, and accents are dropped. "Ada Lovelace" becomes `ada-lovelace`. "José" becomes `jose`. A name that has no letters or digits the folder can keep, such as 李雷, uses `user` instead, so the writer id is `user-` plus the install id. The install id is four characters from `a-z` and `0-9`, chosen once for that install of the app. The display name stays in the author field. The save is told the writer id; it does not invent one from the display name alone.

Two people with the same display name and different install ids get different writer ids, so their files never collide. A rewrite is refused when the file already there has a different email, or when its id does not belong to this writer id. The previous bytes stay as they were.

The file names are `<id>.json` and `<id>.md`. Ids are unique because of the random part, so two saves do not pick the same file.

## The JSON file

The JSON file is the lesson the app trusts. The fields are:

- `id`
- `title`
- `topics`
- `summary`
- `situation`
- `whatToDo`
- `why`
- `apply`
- `scope` (always `work` in this folder)
- `author` (`username`, `email`, `team`)
- `project`
- `created_at`
- `sources`
- `links` (each one has `id` and `writer`)

```json
{
  "id": "grace-hopper-m2p8-9c02aabb-ccdd-4eef-8899-001122334455",
  "title": "Retry the deploy once",
  "topics": ["deploys"],
  "summary": "Retry a failed deploy once.",
  "situation": "A deploy failed after the lock timed out.",
  "whatToDo": "Retry the deploy once, then read the log.",
  "why": "The lock clears on its own within a minute.",
  "apply": "When a deploy fails on a lock, retry once before changing config.",
  "scope": "work",
  "author": {
    "username": "Grace Hopper",
    "email": "grace@example.com",
    "team": "platform"
  },
  "project": "sharlie",
  "created_at": "2026-11-02T08:00:00.000Z",
  "sources": ["cursor"],
  "links": [
    {
      "id": "ada-lovelace-k3f9-3f1a2c4e-5b6d-4e7f-8a9b-0c1d2e3f4a5b",
      "writer": "ada-lovelace-k3f9"
    }
  ]
}
```

The Markdown file repeats those fields in a short header, then the sections Summary, Situation, What to do, Why, and Apply.

## Rules

Before it writes, the app reads the folder and builds the list of lessons from the files it finds. It does not open a shared index, because two writers would both try to rewrite that file.

The read skips anything it cannot trust, and it does not throw:

- a file it cannot read
- a temp file or a file that is only partly there
- broken JSON
- a file that is not a lesson
- a lesson whose scope is not exactly `work`

A lesson is written only when its scope is exactly `work`. Personal lessons stay on that computer. A lesson with no scope is personal, so it is not written either. The shared folder is left untouched.

Saving writes a temp file in the same folder, then renames it to the real name. The Markdown file is renamed into place first, and the JSON file last. A crash in between can leave a note without its JSON. It cannot leave a JSON file whose note was never written. Anyone reading either sees the previous file or the finished file.

If that rename fails because the name is busy or already there, the app tries the rename five times, about a fifth of a second apart. It does not write over the destination directly. When the tries are used up, the temp file is removed and the save comes back with a short reason. A lesson that was already there stays as it was.

At the start of a save, the app deletes its own temp files that are older than 10 minutes. A temp name is a dot, the lesson id, `.json` or `.md`, the process id, twelve hex characters, and `.tmp`. The match is the whole writer id, so `ada-k3f9` does not remove a temp that belongs to `ada-k3f9-bob-x7y2`. A younger temp file stays. Another writer's temp file stays, however old it is. The same pass removes this writer's own note that is older than 10 minutes and has no matching JSON file. A newer note, a note that already has its JSON, and another writer's note stay. An identical lesson already on disk is left as it is: the save compares size and a hash, skips the rewrite, and does not count as a new share.

A writer only creates new files, or rewrites files that already carry that writer's own id and the same email. A different email, or an id that belongs to another writer, is refused and the file is left alone. A writer does not move, rename, or delete files in the shared folder, and does not change another person's lesson. Links are a list inside the writer's own JSON and Markdown. They name the other lesson's id and that lesson's writer.

A link is added when the new lesson and an existing one share a topic, the same project (other than an empty project or `none`), or a meaningful word in the title. At most 8 links are kept. The same lesson and the same folder contents always pick the same links. Nothing calls a model to decide.

If the folder is missing, or it cannot be written, the save comes back with a short reason. It does not throw, and it does not create the folder.

Reading the folder back gives each work lesson as a node with `synced: true` and the writer slug, so the app can add other people's lessons to its own graph.

## When two people write the same thing

If two people save a lesson with the same title, both files stay. The folder does not merge them and does not ask anyone to pick a winner.

The lesson that is saved while the other one is already visible stores a link to it. The earlier file is not edited. Its bytes stay as they were.

If both saves happen before either one can see the other, both files still stay, and neither is turned into an orphan by deleting or renaming. A later lesson that can see them can link to both.

A half-synced file, such as one Drive has not finished copying, is ignored until it is complete JSON. It is not deleted and it does not stop the rest of the folder from being read.
