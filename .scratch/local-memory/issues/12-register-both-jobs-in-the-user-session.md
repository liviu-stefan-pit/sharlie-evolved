# 12: Register both jobs in the user session

**What to build:** Installing the app registers the learner and the publisher with the user session on Windows and on macOS. Both start when the person logs in and stop when they log out or the machine shuts down, and neither needs the window left open. Removing the app unregisters both. Register and unregister in the window pause and resume those same jobs.

**Blocked by:** 10 Open the window; 11 Learn from the installed tools

**Status:** ready-for-agent

- [ ] Installing the app registers the learner and the publisher
- [ ] After install, learning and copying run without a window left open
- [ ] The jobs start when the person logs in
- [ ] The jobs stop when the person logs out or the machine shuts down
- [ ] The jobs run only in that person's session
- [ ] Removing the app unregisters both jobs
- [ ] After uninstall, neither job keeps running
- [ ] Register in the window registers these same two jobs
- [ ] Unregister in the window unregisters both, so the person can pause the system without uninstalling
- [ ] Opening or closing the window leaves the jobs as they are
- [ ] The learner job is the one that imports and then reads changes, on its saved interval
- [ ] The publisher job is the one that copies work cards to the Drive folder, on its saved interval
- [ ] Publishing continues after the model key is removed
- [ ] An empty Drive path means the publisher does not run
- [ ] Personal cards are not copied
- [ ] The app writes files into the chosen folder and does not sign into Google
