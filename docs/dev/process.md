# Development process

This document is the operating procedure for this repository. It has two
audiences: the agents that run the repository, and the humans that review the
output of those agents. The agents are a session lead and the subagents that
the lead dispatches. CLAUDE.md carries the short version. Where CLAUDE.md and
this document overlap, this document is canonical.

## Authorship and approval

**The lead finalizes and posts all GitHub text.** Issue bodies, PR bodies, and
comments reach GitHub only through the lead. Whoever holds the context
writes the draft. A subagent drafts its PR body when the subagent is about to
push a branch. A reviewer drafts the finding that the reviewer knows best. A
subagent draft follows the writing process below. The subagent puts the draft
in the session folder's `drafts/` (see [Filesystem state](#filesystem-state)).
The subagent reports the path of the draft to the lead. The lead refines the
draft and posts it. Subagents never post.

**The lead does not wait for approval to post.** Durable text — issue bodies,
PR bodies, design rulings, review distillations — posts without prior user
approval. The lead tells the user in session about the embedded decisions, as a
digest. The lead revises the posted text when the user gives
feedback. Design reaches the user before the design hardens. The user must
approve plans and decisions that touch the spec, as
[Feature design](#feature-design) specifies. The lead posts mechanical
text — for example, status notes, hold comments, and CI chatter — under
the template rules. Drafts can stay in `~/.cache/davenport-dev/drafts/` while the lead
composes them.

## The writing process

Descriptive writing includes documentation files, issue bodies and comments,
and PR bodies and comments. Produce every piece of descriptive writing in this
order:

1. **Purpose.** State what this text is for. "To have written something rather
   than nothing" is not a purpose. If no consumer waits for the text, do not
   write it.
2. **Template.** If a template applies (`.github/ISSUE_TEMPLATE/`,
   `.github/PULL_REQUEST_TEMPLATE.md`, `docs/dev/templates/`), read that
   template. Then follow the instructions that this template carries as
   comments.
3. **Outline.** List what the text must contain. Make this list before
   the draft.
4. **Audience.** Name the intended reader. Read the audience card of that
   reader ([`docs/dev/audience/`](audience/)). Think about the state of mind
   of that reader. Ask why the reader reads the text, and what the reader
   already knows. Ask what the reader must leave with, and what wastes the
   reader's time. The answers determine how the outline becomes text.
5. **Draft.** Write the draft.
6. **Simplify.** Apply the asd-ste100 skill (Simplified Technical English,
   ASD-STE100) to the draft. This step is mandatory for all text that this
   process covers. Keep each fact, each condition, and each scope qualifier.
   If a rule of the standard removes necessary precision, keep the
   precision. Record the conflict in the text that presents the change: the
   pull request body, or the session digest.
7. **Post.** The lead posts the text. The lead tells the user about the
   decisions that the text carries. The lead revises the posted text when
   the user gives feedback.

### Language

- Write plain and utilitarian text, in every register. Do not use ornamental
  descriptors ("the heart of the product", "powerful", "seamless"). State what
  the thing is and what the thing does, and let the work describe itself.
- Do not put session framing or historical framing in durable text. The
  phrases "as ruled", "as discussed", "per the design phase", and "recently"
  say nothing to a reader who was not there. State the decision itself. Cite
  the issue that records the decision when the why matters.
- Do not use LLM-isms. Do not use needless emphasis. Do not over-describe. Do
  not inflate the importance of the completed work.
- All text that this process covers follows Simplified Technical English
  (ASD-STE100). The asd-ste100 skill states the rules and the procedure.

## Comment discipline

Code is self-describing. Modules, types, and functions get documentation
comments, as the conventions of the language dictate (eg `///` and `//!` in
Rust). These comments state the contract and never the history. Comments are
plain and simple prose. Subsection anchors — spec `§` references, test-plan
IDs, issue numbers — never appear in code comments. A comment links out to
documentation only when this is absolutely necessary. Inline comments have
exactly two permitted forms:

- justifications for exceptional code (eg unsafe blocks, silencing warnings, etc.)
- looks-wrong-but-correct-because-X guards, for code that reads as a bug
  without the comment (the arXiv adapter's 429/503 swap is the canonical
  example).

All other comment content is a review finding, not a nit. This content
includes narration of what the next line does, `(#NNN)` citations, "as of"
framing, and session context. Architecture and rationale live in-tree but
out-of-line (this directory, crate `ARCHITECTURE.md` files) or in issues.

Comments, error messages, dialogue text, and instruction text follow
Simplified Technical English (ASD-STE100). The asd-ste100 skill states the
rules. If a rule of the standard removes necessary precision, keep the
precise longer form. Do not add a comment about the conflict.

## Decision records

GitHub issues record design decisions and their rationale at decision time.
Repo docs describe only what exists. The repository has no in-tree ADR file,
and repo docs have no rationale sections that go stale. A doc can cite the
issue that decided a shape. A doc never restates the debate.

## Feature design

The body of a feature issue states the problem. The body never carries a
design. The lead produces the design with the user in plan mode. The lead then
posts the approved plan as a comment on the issue, before implementation
begins. This comment carries the substantive plan only, without the process
notes. The issue then carries the why in its body and the agreed how in its
comments. Implementation starts only after the lead posts the plan.

Design is exploratory, and the lead directs the design. The lead delegates research
to subagents where this is useful. When the solution space is genuinely open,
subagents sketch and elaborate alternative approaches in parallel. The lead
asks the user to react to the emerging shape as the shape forms. Trade-offs
and open questions reach the user early, and not after the plan hardens. The
consensus that survives this process is what plan mode presents for
approval.

## Filesystem state

All mutable dev-session state lives under `~/.cache/davenport-dev/`. This
state never lives in `/tmp`, because parallel agents clobber each other there.
This state never lives in `.claude/`, which holds configuration only: under
git worktrees, the question "which `.claude/`" has no stable answer.

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

- A subagent writes only to its own `agent-{id}/tmp/` and to the session paths
  that its dispatch prompt named explicitly. The convention constrains the
  choices of the lead. A subagent follows the paths that it receives, and
  never guesses a path.
- The lead defines the contents and the meaning of the session folder. The
  lead records them in the `manifest.md` of that folder, so the tree describes
  itself.
- The lead assigns IDs, and the IDs are legible: `session-20260806-wave4`,
  `agent-28-impl`. IDs are never random. Clobber-safety comes from one rule:
  the lead never assigns an ID twice at the same time.

Lifecycle: the lead creates the session dir at session start, and the lead
creates each agent dir at dispatch. The lead reaps `agent-{id}/` when that
agent exits. The lead reaps `session-{id}/` at wave end, only after the lead
posts all durable text to GitHub. During this reap, the lead moves any
unfinished text to `drafts/`. Under this root, only `drafts/` is load-bearing
beyond a session.

[`scripts/dev-dirs.sh`](../../scripts/dev-dirs.sh) creates the layout
idempotently and prints the resolved absolute paths. The script resolves the
project name from the base checkout, even when it runs inside a linked
worktree. Thus every agent lands on the same root. Shell state does not
persist between the tool calls of an agent. Therefore dispatch prompts carry
the resolved paths verbatim. The script exists so that nobody derives a path
by hand.

## Merge machinery

Each issue gets one branch, and each branch gets one PR. The PR body contains
`Fixes #N`. Branch names are `‹type›/‹issue#›-‹slug›`. The type is one of
`feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `xfail`. Main is PR-only,
squash-merge only, and linear history. Open PRs as drafts. The lead marks a
PR ready after the review findings are addressed. Then the lead runs
`gh pr merge --squash --auto`. The single required check `ci-ok` gates the
merge. Never auto-merge a draft. Three rules do not apply to an automated
dependency-update pull request: the branch name, the `Fixes #N` line, and the
draft state. Every other rule of this section applies to such a pull request,
and the required check `ci-ok` gates its merge.

The closing-keyword parser of GitHub ignores negation: the text "does not
close #N" still closes #N when the squash commit lands. Keep closing keywords
away from the issue numbers that the PR must not close.

## Review gates

Every substantive PR gets an independent review before merge. Reviews are
exhaustive, not sampled:

- cover every hunk of the diff (for a sweep, cover every file in scope);
- verify claims empirically where this is cheap: run the code, or grep for the
  counter-case. Do not trust the claim of the diff;
- verify that new or changed comments, error messages, dialogue text, and
  instruction text follow Simplified Technical English (ASD-STE100);
- verify that the text keeps the precise longer form where the standard
  removes necessary precision;
- end with an explicit coverage statement. This statement names what you
  checked and what you did NOT check.

Conformance to this document is a required check, and a breach is a finding.
Findings relay through the `reviews/pr-{n}.md` file of the session folder. The
lead posts the durable distillation as a PR comment before merge, as
[`templates/review-distillation.md`](templates/review-distillation.md)
specifies. Design-affecting findings escalate to the user, and nobody
auto-resolves them.

## Defect workflow

A defect that is out of scope for the task in hand must be captured as
resumable state. Nobody fixes this defect inline, and nobody leaves it as
prose. The resumable state is:

1. an issue with a clear problem statement (repro, expected vs actual);
2. a branch: `fix/…` when the branch carries the fix, or `xfail/…` when the
   branch carries only a red reproducing test and no fix;
3. the branch, pushed and linked from the issue.

The failing test is the spec. The pushed branch is the handoff.

## Phase-boundary sweeps

At phase boundaries, several independent lenses (e.g. concurrency, security,
contracts, test integrity, docs) each review the whole codebase against
`main`. The lenses then cross-ratify each other's findings. After that, the lead
consolidates the findings into a single tracking issue that dispositions
every finding. Fix PRs cite the sweep issue.
