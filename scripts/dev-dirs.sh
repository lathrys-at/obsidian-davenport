#!/bin/sh
# This script makes the shared dev-state directories under
# ~/.cache/<project>-dev, and the script prints absolute paths. The file
# docs/dev/process.md gives the layout. Each line of the output has the form
# NAME=path. To set the names as shell variables, use the output of the
# script as the argument of eval. Run eval in the same command that uses the
# paths:
#
#   eval "$(scripts/dev-dirs.sh --session 20260806-wave4 --agent 28-impl)"
#
# The project name is the directory name of the base checkout. The script
# reads that same name when it runs inside a linked worktree. Thus every
# agent gets the same root directory.
set -eu

session="" agent=""
while [ $# -gt 0 ]; do
  case "$1" in
    --session) session="${2:?$1 needs an ID}"; shift 2 ;;
    --agent)   agent="${2:?$1 needs an ID}"; shift 2 ;;
    *) echo "unknown argument $1. usage: $0 [--session ID] [--agent ID]" >&2; exit 2 ;;
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
