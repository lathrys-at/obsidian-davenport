# Development process

The operating procedure for this repository, written for the agents who run it —
a session lead and the subagents it dispatches — and for the humans reviewing
their output. CLAUDE.md carries the short version; this file is canonical where
they overlap.

## Authorship and approval

**The lead finalizes and posts all GitHub text.** Issue bodies, PR bodies, and
comments reach GitHub only through the lead. Drafting sits with whoever holds
the context: a subagent about to push a branch drafts its PR body; a reviewer
drafts the finding it knows best. A subagent draft follows the writing process
below, lands in the session folder's `drafts/` (see
[Filesystem state](#filesystem-state)), and its path is reported to the lead,
who refines and posts it. Subagents never post.

**Posting does not wait for approval.** Durable text — issue bodies, PR
bodies, design rulings, review distillations — posts without prior user
approval. The lead surfaces the embedded decisions to the user in session as
a digest, and revises posted text on their feedback. Design reaches the user
before it hardens: plans and spec-touching decisions go through the user per
[Feature design](#feature-design). Mechanical text — status notes, hold
comments, CI chatter — posts under the template rules. Drafts may stage in
`~/.cache/davenport-dev/drafts/` while being composed.

## The writing process

Every piece of descriptive writing — documentation files, issue bodies and
comments, PR bodies and comments — is produced in this order:

1. **Purpose.** State what this text is for. "To have written something rather
   than nothing" is not a purpose; if no consumer is waiting for the text,
   don't write it.
2. **Template.** If a template applies (`.github/ISSUE_TEMPLATE/`,
   `.github/PULL_REQUEST_TEMPLATE.md`, `docs/dev/templates/`), read it and
   follow the instructions embedded in it as comments.
3. **Outline.** List what the text must contain before writing any of it.
4. **Audience.** Name the intended reader and read their audience card
   ([`docs/dev/audience/`](audience/)). Reason about their state of mind:
   why they are reading, what they already know, what they must leave with,
   what wastes their time. This determines how the outline becomes text.
5. **Draft.** Write the draft.
6. **Simplify.** Apply the asd-ste100 skill (Simplified Technical English,
   ASD-STE100) to the draft. This step is mandatory for all technical
   documentation. Keep each fact, each condition, and each scope qualifier.
   If a rule of the standard removes necessary precision, keep the precision
   and record the conflict.
7. **Post.** Post the text. Tell the user about the decisions embedded in it,
   and revise the posted text on their feedback.

### Language

- Plain and utilitarian, in every register. No ornamental descriptors ("the
  heart of the product", "powerful", "seamless") — state what the thing is
  and does, and let the work describe itself.
- No session or historical framing in durable text: "as ruled", "as
  discussed", "per the design phase", "recently" say nothing to a reader who
  was not there. State the decision itself; cite the issue that records it
  when the why matters.
- No LLM-isms, no needless emphasis, no over-description, no inflating the
  importance of what was done.
- Technical documentation follows Simplified Technical English (ASD-STE100).
  The asd-ste100 skill states the rules and the procedure.

## Comment discipline

Code is self-describing. Modules, types, and functions get documentation
comments as the language's conventions dictate (eg `///` and `//!` in Rust) — the
contract, never the history. Comments are plain and simple prose: subsection
anchors — spec `§` references, test-plan IDs, issue numbers — never appear in
code comments, and a comment links out to documentation only when absolutely
necessary. Inline comments are limited to exactly two forms:

- justifications for exceptional code (eg unsafe blocks, silencing warnings, etc.)
- looks-wrong-but-correct-because-X guards, where the code reads as a bug
  without the comment (the arXiv adapter's 429/503 swap is the canonical
  example).

Comments, error messages, dialogue text, and instruction text follow
Simplified Technical English (ASD-STE100). The asd-ste100 skill states the
rules. Where a rule of the standard removes necessary precision, precision
wins, and the comment records nothing about the conflict — the text simply
keeps the longer form.

Everything else — narration of what the next line does, `(#NNN)` citations,
"as of" framing, session context — is a review finding, not a nit.
Architecture and rationale live in-tree but out-of-line (this directory, crate
`ARCHITECTURE.md` files) or in issues.

## Decision records

Design decisions and their rationale are recorded in GitHub issues at decision
time. Repo docs describe only what exists — no in-tree ADR file, no rationale
sections that go stale. A doc may cite the issue that decided a shape; it never
restates the debate.

## Feature design

A feature issue's body states the problem; it never carries a design. The
design is produced with the user in plan mode, and the approved plan is
reproduced as a comment on the issue — the substantive plan only, stripped of
process notes — before implementation begins. The issue then carries the why
in its body and the agreed how in its comments; implementation does not start
ahead of the posted plan.

Design is exploratory and led by the lead: research is delegated to subagents
where useful; when the solution space is genuinely open, subagents sketch and
elaborate alternative approaches in parallel; and the emerging shape is
bounced off the user as it forms — trade-offs and open questions reach the
user early, not after the plan has hardened. The consensus that survives this
is what plan mode presents for approval.

## Filesystem state

All mutable dev-session state lives under `~/.cache/davenport-dev/` — never
`/tmp` (parallel agents clobber each other there) and never `.claude/`
(configuration only: under git worktrees, "which `.claude/`" has no stable
answer).

```
~/.cache/davenport-dev/
  drafts/                # lead staging for text being composed — survives sessions
  session-{id}/          # lead-owned shared state for one lead session
    manifest.md          # written by the lead: purpose, layout, active agents
    drafts/              # subagent → lead draft handoff — reaped with the session
    reviews/pr-{n}.md    # review relay files
  agent-{id}/
    tmp/                 # that agent's private scratch — nobody else's
```

Ownership:

- A subagent writes only to its own `agent-{id}/tmp/` and to session paths its
  dispatch prompt named explicitly. The convention constrains the lead's
  choices; a subagent follows handed paths and never guesses.
- The session folder's contents and meaning are the lead's to define, recorded
  in its `manifest.md` so the tree is self-describing.
- IDs are legible and lead-assigned — `session-20260806-wave4`,
  `agent-28-impl` — never random. Clobber-safety comes from the lead never
  assigning an ID twice concurrently.

Lifecycle: the lead creates the session dir at session start and each agent
dir at dispatch; reaps `agent-{id}/` when that agent exits; reaps
`session-{id}/` at wave end once everything durable has been posted to
GitHub, with any unfinished text moved to `drafts/`. Nothing under this root
is load-bearing beyond a session except `drafts/`.

[`scripts/dev-dirs.sh`](../../scripts/dev-dirs.sh) creates the layout
idempotently and prints resolved absolute paths. It resolves the project name
from the base checkout even when run inside a linked worktree, so every agent
lands on the same root. Shell state does not persist between an agent's tool
calls, so dispatch prompts carry the resolved paths verbatim; the script
exists so nobody derives a path by hand.

## Merge machinery

One issue → one branch → one PR, `Fixes #N` in the body. Branch names are
`‹type›/‹issue#›-‹slug›`, with type one of `feat`, `fix`, `docs`, `chore`,
`refactor`, `test`, `xfail`. Main is PR-only, squash-merge only, linear
history. Open PRs as drafts; mark ready once review findings are addressed;
then `gh pr merge --squash --auto` — the single required check `ci-ok` gates
the merge. Never auto-merge a draft.

GitHub's closing-keyword parser ignores negation: "does not close #N" still
closes #N when the squash commit lands. Keep closing keywords away from issue
numbers the PR must not close.

## Review gates

Every substantive PR gets an independent review before merge. Reviews are
exhaustive, not sampled:

- cover every hunk of the diff (for a sweep, every file in scope);
- verify claims empirically where cheap — run the code, grep for the
  counter-case — rather than taking the diff's word for it;
- end with an explicit coverage statement naming what was and was NOT checked;
- verify that new or changed comments, error messages, dialogue text, and
  instruction text follow Simplified Technical English (ASD-STE100), and that
  the author applied the asd-ste100 skill.

Conformance to this document is a required check; a breach is a finding.
Findings relay through the session folder's `reviews/pr-{n}.md`; the durable
distillation posts as a PR comment before merge, per
[`templates/review-distillation.md`](templates/review-distillation.md).
Design-affecting findings escalate to the user — they are never auto-resolved.

## Defect workflow

A defect out of scope for the task in hand is captured as resumable state, not
fixed inline and not left as prose:

1. an issue with a clear problem statement (repro, expected vs actual);
2. a branch — `fix/…` with the fix, or `xfail/…` when it carries only a red
   reproducing test and no fix;
3. the branch pushed and linked from the issue.

The failing test is the spec; the pushed branch is the handoff.

## Phase-boundary sweeps

At phase boundaries, several independent lenses (e.g. concurrency, security,
contracts, test integrity, docs) each review the whole codebase against
`main`, then cross-ratify each other's findings before they consolidate into a
single tracking issue that dispositions every finding. Fix PRs cite the sweep
issue.
