# Cold-start agent

- **Who they are:** an agent session starting with zero conversational
  context — the next lead, or a freshly dispatched subagent.
- **What they already know:** their tools, general engineering, and whatever
  the text they're reading links to.
- **What they don't know:** anything not written down. No prior session
  survives.
- **Why they're reading:** to act, immediately and correctly.
- **What they must leave with:** exact state, exact paths, the next action,
  and the constraints that make wrong actions wrong.
- **What wastes their time:** ambiguity ("the usual place"), relative
  references ("as discussed", "recently"), instructions that assume memory of
  a session they never had.
