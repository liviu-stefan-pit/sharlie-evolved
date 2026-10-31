# 05: Import history newest first, then only what changed

**What to build:** The first time the learner can run, it catches up on the transcripts already on the machine, newest first, in batches, for as long as the person stays logged in. After that import finishes, each later run reads only the transcripts that changed since the last success, including work that happened while the machine was off. Transcripts from a tool the person turned off are not part of the import.

**Blocked by:** 03 Show only installed tools, on until turned off; 04 File a repeat, a new claim, and a second source

**Status:** ready-for-agent

- [x] The first learner run after the profile and an active key are present imports every existing transcript from the enabled tools
- [x] That import proceeds newest first
- [x] The import proceeds in batches, back to back, while the person is logged in
- [x] A long history is not sent as one model call
- [x] After the import finishes, a run reads only transcripts that changed since the last successful run
- [x] Transcripts that arrived while the machine was off are picked up on the next run
- [x] A later run does not reread history that was already imported successfully
- [x] A tool that is turned off contributes no transcripts to the import or to a later run
