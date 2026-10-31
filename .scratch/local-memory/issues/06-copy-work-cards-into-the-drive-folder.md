# 06: Copy work cards into the Drive folder

**What to build:** The person sets a folder that their Drive client already syncs. The publisher copies the work cards into that folder, with the same team folders and the same file bytes, and leaves personal cards on the machine. Copying keeps going after the model key is removed. When the path is empty, nothing is copied. The app does not sign into Google.

**Blocked by:** 02 Write one scrubbed lesson card

**Status:** ready-for-agent

- [x] The person can set the Drive folder path in the app
- [x] The publisher copies `work/` to that path
- [x] The copy keeps the same folders and the same file bytes as the local work cards
- [x] Personal cards are not copied
- [x] A teammate opening the shared folder sees work cards grouped by team and nothing personal
- [x] Publishing continues after the model key is removed
- [x] An empty Drive path means the publisher does not run
- [x] The app writes files into the chosen folder and does not sign into Google
- [x] The publisher runs on its saved interval, which defaults to one hour
