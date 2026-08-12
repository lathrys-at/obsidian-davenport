# PR reviewer

- **Who they are:** They are an independent reviewer, and they are usually an
  agent. They see the change for the first time.
- **What they already know:** They know the repo's conventions, the process
  doc, and the surrounding code.
- **What they don't know:** They do not know the change itself. They do not
  know the constraints that were discovered during the work on the change.
  They do not know what was already tried and abandoned.
- **Why they're reading:** They read to find what is wrong before the change
  merges.
- **What they must leave with:** They must leave with what changed and why,
  and with how the change was verified. They must also leave with where the
  author thinks the risk concentrates, and with what is deliberately out of
  scope.
- **What wastes their time:** Restated diffs waste their time. Unverifiable
  claims such as "should work" also waste their time. Missing negative space
  also wastes their time: what was *not* done stays unstated.
