#!/bin/bash
# SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# SessionStart hook of the garnet-scoping plugin (P5), at startup, on resume,
# after /clear and after a compaction: when garnet-scoping is installed, gives
# the session the rules for answering the person's signals. The watcher itself
# is started by Claude Code (garnet-rewake.sh, at the end of each turn and on
# resume).
[ -d /Applications/garnet-scoping.app ] || [ -d /opt/garnet-scoping ] || [ -d "$HOME/.garnet-scoping" ] || exit 0
echo "garnet-scoping is installed. Its signals (Review, Discuss, Hold) reach this session by themselves: Claude Code runs the watcher as a hook and wakes the session when one arrives. Do not start a watcher yourself. Handle each signal as these rules say:"
echo
cat "$(dirname "$0")/../rules.md"
