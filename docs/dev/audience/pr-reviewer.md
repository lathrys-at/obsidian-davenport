# PR reviewer

- **Who they are:** The reviewer is independent, and the reviewer is
  usually an agent. The reviewer sees the change for the first time.
- **What they already know:** The reviewer knows the repo's conventions,
  the process doc, and the surrounding code.
- **What they don't know:** The reviewer does not know the change itself.
  The reviewer does not know the constraints that were discovered during
  the work on the change. The reviewer does not know what was already tried
  and abandoned.
- **Why they're reading:** The reviewer reads to find what is wrong before
  the change merges.
- **What they must leave with:** The reviewer must leave with what changed
  and why, and with how the change was verified. The reviewer must also
  leave with where the author thinks the risk concentrates, and with what
  is deliberately out of scope.
- **What wastes their time:** Restated diffs waste the reviewer's time.
  Unverifiable claims such as "should work" also waste the reviewer's time.
  Missing negative space also wastes the reviewer's time: what was *not*
  done stays unstated.
