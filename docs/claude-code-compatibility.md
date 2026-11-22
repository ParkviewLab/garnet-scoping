# Checking a new Claude Code version

garnet-scoping reads files that Claude Code writes for its own use: the transcripts, the session files, the desktop app's session records. None of them is a published interface, and any release of Claude Code may change them (R6). The app therefore carries the range of versions its reader was checked against (`CHECKED_VERSIONS` in `src/main/transcript/session.js`), and the Desk says when a session runs a newer version or writes records the reader does not know. This document is the procedure for checking a newer version, and the record of every check made.

## When to check

- The Desk shows "This session's Claude Code (…) is newer than any this app was checked against", or "Records of kinds this version does not know: …".
- Claude for Mac or the Claude Code CLI has been updated, and a release of garnet-scoping is about to be cut.

## The procedure

Work on a branch `fix-claude-code-<version>`. The repository is public: what is copied into it from the transcripts is record types and field names only, never a record's content, a path, a session id or a host name.

1. **Note the versions.** The version a session runs is on the Desk's notice and in `~/.claude/sessions/<pid>.json` (`version`). The CLI's own version (`claude --version`) matters separately, because the app runs the CLI's `claude agents --json`; the desktop app carries its own Claude Code, which may be newer.
2. **Read the transcripts with the app's reader.** `npm run check:claude-code` (the script `scripts/check-claude-code.mjs`) reads every transcript under `~/.claude/projects` with the app's own `classify()` and reports, for transcripts written by versions above the checked range: record types the reader does not know, attachment types never seen in older transcripts, and fields new to a known record type. It prints names and counts only. `--since <version>` sets the lower bound.
3. **Decide each finding.** Look at the shape of each new type or field (its keys and the kinds of their values) and at what it marks, then:
   - **ignore it:** add the type to `IGNORED_TYPES` in `src/main/transcript/records.js`, under a comment naming the version and what it holds, and add it to the test of ignored types in `tests/session.test.js`;
   - **read it:** where it changes what the Desk should show (a human message read as system, a field moved, as `model` moved to `identity.modelId` in 2.1.304), change the reader, test it with a synthetic record, and record the fact in `docs/design.md`;
   - **put it to the owner:** where it could be shown and nothing requires it, ignore it now and ask whether to show it.
4. **Read the changelog.** The entries above the checked version in `https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md`, searched for: transcript, jsonl, session file, `claude agents`, hooks (SessionStart, Stop, asyncRewake, hook input), plugins and marketplaces, working directory, spawned or side sessions. The changelog has never announced a transcript format change; the reader's report in step 2 is what finds them.
5. **Check the live state.** The session files `~/.claude/sessions/<pid>.json` still carry what `src/main/live/state.js` reads: an integer `pid`, a string `sessionId`, `status` one of busy, idle and waiting, `kind`, `waitingFor`, and an integer `statusUpdatedAt`. If the CLI's version changed, repeat the read-only check of `claude agents --json`: it must give the same rows when run under a sandbox that denies network access and writes under `~/.claude`:

   ```
   (version 1)
   (allow default)
   (deny network*)
   (deny file-write* (subpath "/Users/<you>/.claude"))
   ```

   saved as `ro.sb` outside the repository and run as `sandbox-exec -f ro.sb claude agents --json`.
6. **Check spawned sessions.** The desktop app's records under `~/Library/Application Support/Claude/claude-code-sessions/*/*/local_*.json` still carry `cliSessionId`, and `spawnedFrom.sessionId` where a session was started by another (R20).
7. **Check the plugin and the hooks.** In a session running the new version: the SessionStart hook's rules appear at start and after compaction; the transcript's `stop_hook_summary` records show no failed hooks (`failedHookErrorIndexes` empty, from 2.1.328); the board tools `mcp__garnet-scoping__board_*` are offered; a Review on the board wakes the idle session.
8. **Raise the range.** Set `CHECKED_VERSIONS.highest` to the version checked, and the same version in `README.md` and in `docs/design.md` ("Versions checked"). Run `npm run lint` and `npx vitest run`, rerun step 2 (it should report no transcripts above the new bound), and add a row to the record below.
9. **Open the pull request** into `develop`, titled `fix: Claude Code <version> compatibility`, its description listing what each step found. The merge and the release (a patch release) each need the owner's ask.

## The record of checks

| Date | Versions | Found | Pull requests |
|---|---|---|---|
| 2026-11-01 | 2.1.304 to 2.1.309 | No unknown record types. The model attachment moved to `identity.modelId`. The watcher had to exit when its Claude Code process ended (`GARNET_WATCH_OWNER`). | PR 57 (v0.8.3) |
| 2026-11-14 | 2.1.310 to 2.1.325 | First pass: no unknown record types in 4,616 records; changelog silent on the format. Later in 2.1.325 sessions: `tools-used`, `dev-mods` and `session-owner` records, now ignored. `claude agents --json` shown read-only under a no-network, no-write sandbox. | PR 62, PR 70 (v0.9.0) |
| 2026-11-21 | 2.1.326 to 2.1.328 | `relocated` records (`relocatedCwd`, `sessionId`; no `version`), the folder a session moved to; ignored. New fields read correctly as they are: `pluginPrompt` on user messages that carry `origin.kind` "plugin" (read as system), `isAbortedMidStream` on an assistant message cut off while streaming, `failedHookErrorIndexes` on `stop_hook_summary`. Session files, spawned-session records, hooks and board tools unchanged. The CLI stayed at 2.1.325; `claude agents --json` rechecked under the sandbox all the same. Changelog silent on the format. | PR 118 |
