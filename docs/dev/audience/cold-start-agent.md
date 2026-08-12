# Cold-start agent

- **Who they are:** They are an agent session that starts with no
  conversational context. The session is the next lead, or a newly
  dispatched subagent.
- **What they already know:** They know their tools and general engineering.
  They also know what the text that they read links to.
- **What they don't know:** They do not know anything that is not written
  down. No prior session survives.
- **Why they're reading:** They read so that they can act immediately and
  correctly.
- **What they must leave with:** They must leave with the exact state and the
  exact paths. They must also leave with the next action and the constraints
  that make wrong actions wrong.
- **What wastes their time:** Ambiguity wastes their time, for example "the
  usual place". Relative references waste their time, for example "as
  discussed" and "recently". Instructions that assume memory of a session
  that they never had also waste their time.
