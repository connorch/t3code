#!/usr/bin/env bash
# Run a T3 Code dev mode from Conductor.
#
# Conductor stops a run script by sending SIGHUP to the process it spawned, then
# SIGKILL 200ms later. `vp run dev` sits above a node dev-runner that spawns Vite
# and the server as grandchildren, so a bare command leaves both alive holding
# the workspace's ports and the next run fails to bind.
#
# `set -m` puts the child in its own process group so the trap can stop the whole
# tree. Bash rather than zsh: zsh refuses `set -m` in a script.
#
# Usage: .conductor/dev.sh [dev|dev:desktop|dev:share|dev:web|dev:server]
set -m

trap 'kill -TERM -$PID 2>/dev/null' HUP INT TERM

vp run "${1:-dev}" &
PID=$!
wait "$PID"
