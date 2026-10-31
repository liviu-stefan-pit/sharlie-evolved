# 01: Gate learning on profile, key, and model

**What to build:** A person can save a username, an email, and a team, and can keep more than one SDK key in the operating system vault with exactly one of them active. The active key's provider decides which models are offered, and the cheap model is selected until the person chooses another. The learner does nothing until that profile and an active key are both saved. The learner and the publisher each wait at least an hour between runs.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [x] Username, email, and team can be saved and are still there the next time the window opens
- [x] More than one SDK key can be saved, and exactly one is active
- [x] Switching the active key does not require retyping the keys that were already saved
- [x] Keys are stored in the operating system vault, and they are not written into an ordinary settings file
- [x] An Anthropic key offers `claude-haiku-5-5` as the default, plus `claude-sonnet-5-5` and `claude-opus-5-5`
- [x] An OpenAI key offers `gpt-6-luna` as the default, plus `gpt-6-sol` and `gpt-6-astra`
- [x] The active key's provider is what selects that list, and no other model is offered
- [x] The person can choose the model in the app, and that one model is the model that will write cards and answer lookups
- [x] The learner interval defaults to one hour
- [x] The publisher interval defaults to one hour
- [x] The window refuses a learner interval shorter than one hour
- [x] The window refuses a publisher interval shorter than one hour
- [x] When username, email, or team is missing, the learner does not run
- [x] When no active key is saved, the learner does not run
