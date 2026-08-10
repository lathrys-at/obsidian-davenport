#!/bin/sh
# Resolve and create the shared dev-state layout under ~/.cache/<project>-dev
# (docs/dev/process.md, "Filesystem state"). Prints VAR=path lines; eval the
# output to use them in the current command:
#
#   eval "$(scripts/dev-dirs.sh --session 20260806-wave4 --agent 28-impl)"
#
# The project name comes from the base checkout's directory name even when run
# inside a linked worktree, so every agent resolves the same root.
set -eu

session="" agent=""
while [ $# -gt 0 ]; do
  case "$1" in
    --session) session="${2:?$1 needs a value}"; shift 2 ;;
    --agent)   agent="${2:?$1 needs a value}"; shift 2 ;;
    *) echo "usage: $0 [--session ID] [--agent ID]" >&2; exit 2 ;;
  esac
done

common_dir="$(git rev-parse --path-format=absolute --git-common-dir)"
project="$(basename "$(dirname "$common_dir")")"
root="${XDG_CACHE_HOME:-$HOME/.cache}/${project}-dev"

mkdir -p "$root/drafts"
echo "DEV_STATE_ROOT=$root"
echo "DEV_STATE_DRAFTS=$root/drafts"

if [ -n "$session" ]; then
  mkdir -p "$root/session-$session/drafts"
  echo "DEV_STATE_SESSION=$root/session-$session"
fi

if [ -n "$agent" ]; then
  mkdir -p "$root/agent-$agent/tmp"
  echo "DEV_STATE_AGENT_TMP=$root/agent-$agent/tmp"
fi
