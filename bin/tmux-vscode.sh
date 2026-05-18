#!/bin/bash
# Starts a new tmux session for VS Code terminals.
# Each terminal gets its own session named vscode-<N>.
#
# Uses TERM=xterm-vscode so tmux.conf can disable alternate screen
# only for VS Code, leaving iTerm2 sessions unaffected.

TMUX_BIN=/usr/local/bin/tmux
PREFIX="vscode"

# Find next available number
n=0
while $TMUX_BIN has-session -t "${PREFIX}-${n}" 2>/dev/null; do
  n=$((n + 1))
done

SESSION="${PREFIX}-${n}"

unset TMUX
export TERM=xterm-vscode

exec $TMUX_BIN new-session -s "$SESSION" \; \
  set mouse off \; \
  set destroy-unattached on
