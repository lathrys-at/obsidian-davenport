# Cold-start agent

- **Who they are:** The cold-start agent is an agent session that starts
  with no conversational context. The session is the next lead, or a newly
  dispatched subagent.
- **What they already know:** The cold-start agent knows its tools and
  general engineering. The cold-start agent also knows what the text that
  it reads links to.
- **What they don't know:** The cold-start agent does not know anything
  that is not written down. No prior session survives.
- **Why they're reading:** The cold-start agent reads to act immediately
  and correctly.
- **What they must leave with:** The cold-start agent must leave with the
  exact state and the exact paths. The cold-start agent must also leave
  with the next action and the constraints that make wrong actions wrong.
- **What wastes their time:** Ambiguity wastes the cold-start agent's time,
  for example "the usual place". Relative references waste the cold-start
  agent's time, for example "as discussed" and "recently". Instructions
  that assume memory of a session that the cold-start agent never had also
  waste the cold-start agent's time.
