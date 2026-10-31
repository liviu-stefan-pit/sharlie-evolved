# 09: Run both jobs in the user session

**What to build:** Installing the app registers the learner and the publisher, so both start with the person logged in and neither needs the window left open. Removing the app unregisters both, so nothing keeps running afterward. From the window, the person can register or unregister the jobs and pause the system without uninstalling. The jobs start at login and stop at logout or shutdown. Opening or closing the window leaves them as they are. The window is where the person sets identity, the model, the tool list, and looks at the graph. The jobs are what learn and publish.

**Blocked by:** 05 Import history newest first, then only what changed; 06 Copy work cards into the Drive folder

**Status:** ready-for-agent

- [x] Install registers the learner and the publisher
- [x] After install, learning and copying run without a window left open
- [x] Uninstall unregisters both jobs
- [x] After uninstall, neither job keeps running
- [x] The window can register both jobs
- [x] The window can unregister both jobs, so the person can pause the system without uninstalling
- [x] The jobs start when the person logs in
- [x] The jobs stop when the person logs out or the machine shuts down
- [x] The jobs run only in that person's session
- [x] The person can open and close the window at any time
- [x] Closing the window does not stop a registered job
- [x] Opening the window does not by itself start learning or publishing
- [x] The learner job is the one that imports and then reads changes
- [x] The publisher job is the one that copies work cards
