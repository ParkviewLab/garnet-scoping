# garnet-scoping: requirements, draft 3

## Purpose

A person working with an AI coding agent sees only what the agent chooses to say. The agent's state (its plan and the step it is on, the files it has read and written, the memory notes it consults, the work it is waiting on, the question it has asked) is already written down as the agent works, in the transcript Claude Code keeps for each session, but not anywhere the person looks. garnet-scoping makes that state visible: for any session, a window that shows it, derived live from the transcript, so that the person can follow the agent's work as it happens and review it afterwards.

This document states what the app must do, not how. It separates what has been decided from what is proposed and what is still open; design starts only when it has been reviewed.

## Definitions

- **Session:** one Claude Code conversation, from any of its front ends (the desktop app, the command line).
- **Transcript:** the file in which Claude Code records a session as it runs, one per session, in the user's Claude configuration directory, grouped by the folder the session was started in (its project). Its format is Claude Code's own and is not documented; it may change with any release.
- **Desk:** the panel of a session's window that shows the session's present state (R2); before D9 it named the whole window.
- **Memory store:** the folder of Markdown notes Claude Code keeps per project, each note carrying a name, a description and a type in its frontmatter, which the agent reads and writes to remember things between sessions.

## Decided

These were ruled before this document was written.

- D1. garnet-scoping is a desktop application, separate from the agent and from any editor. It lists sessions, and for any session opens a Desk in its own window.
- D2. A Desk shows the session's present state, with the session's trail beneath it (R2, R3).
- D3. A Desk has a Memory pane (R4).
- D4. The app runs on macOS and on Ubuntu (the first versions ran on macOS only).
- D5. The repository is public, under the garycoding account, and the code is licensed under AGPL-3.0-or-later.
- D6. The app is named garnet-scoping; "Desk" names a part of its window (since D9, one of the window's panels), not the app.
- D7. Changes to the details are expected to follow from use: the first version is the starting point, not a fixed design.
- D8. Each session has one window, holding its Desk and its board (R7); the board is a shared whiteboard of shapes with text, lines and arrows.
- D9. The window's panels, Desk (the present state), Trail, Memory, Discuss (R2.7) and Board, are each turned on and off. When the board is shown beside other panels it takes half the window, on the side (left, right, top or bottom) set in Settings; the other panels share the remaining half.

## Settled under the go-ahead

These were proposed and then settled under the instruction to proceed as recommended toward the first release (2026-10-19); they are the author's recommendations, not separate rulings, and may be revisited in use.

- S1. All sessions on the machine are listed, the recently active first (P1).
- S2. The app makes no network connection, enforced in code (P2, R5.4).
- S3. An action's raw output is shown only for the action the person picks (P3, R5.2).
- S4. The name and icon are reserved as the project's unregistered marks (P4).
- S5. Subagents' and background agents' own transcripts are left out of the first version (Q1).
- S6. Messages the person sends while the agent is working appear in the trail where they arrived, marked as sent mid-turn (Q2).
- S7. A Desk can show the session's working folder, and any touched file, in the system's file manager (the Finder on macOS) (Q3).
- S8. Finished sessions stay listed; nothing is hidden by age (Q4).

## Requirements

### R1. Sessions

R1.1. The app lists the sessions it finds on the machine, grouped by project, each with its title, its project folder, and the time of its last activity; a session whose transcript was written in the last ten minutes is marked as recently active. (Whether a session is still open cannot be read from its transcript, so the mark is about activity, not about the session's state.)

R1.2. A Desk can be opened for any listed session, and several Desks can be open at once, one per window.

R1.3. A Desk updates as its transcript grows, without the person doing anything.

### R2. The present state

What the session is doing now, at the top of the Desk:

R2.1. **The plan:** the agent's current task list and the step in progress, as the agent last set it. In a desktop-app session this is the task list the app shows under the agent's message; in a command-line session it is the agent's to-do list. Both are read where the transcript records them.

R2.2. **Now:** the agent's last few actions, newest first, each by the one-line description the agent gave it (for a shell command) or its tool and target (for a file read, an edit, a web request), with its time.

R2.3. **Waiting:** work the agent has started in the background and not yet seen finish, with how long it has been running.

R2.4. **Last word:** the agent's last message and, if the agent's turn ended with no message from the person after it, that this is the agent's turn awaiting the person. The Desk does not try to decide whether the message holds a question; it shows that the agent has spoken last.

R2.5. **Touched this turn:** the files read and written, and the memory notes read and written, since the person's last message.

R2.6. **Session facts:** the model and effort, the working folder and branch, linked pull requests, and how much of the context budget is left, where the transcript records them.

R2.7. **Discuss:** the person can mark any row of Plan, Now, Trail, Memory or For you to discuss with the agent: the right-click menu marks it without a note or with one; a double-click marks it too. A marked row shows a badge reading "Discuss" at its right-hand end, before its time where it has one, so that rows still start alike (on a For-you file, on the tile's top-left corner): filled while it is a request to discuss, outlined once turned off or answered. A click on the badge turns the request off, and the badge stays so that a further click requests it again. Marks are kept in the session's state file beside its board and counted at the head of the board's rendition. They are listed, open ones first, in a Discuss panel (a fifth panel toggle) and in the drop-down of a Discuss button in the header, which shows the number of open requests. Choosing an entry shows its item where it is: its panel is turned on, a Trail turn opened, an action no longer in Now found in the Trail, and the item scrolled into view with a yellow highlight that fades over two seconds. The agent answers in the conversation and records a one-line answer with its request (`"discussed"`), which the Desk shows under the row.

R2.8. **Hold:** a button on the window's header lets the person ask the agent to stop after its current step. The request shows as "Hold requested"; the agent finishes the step it is in, starts no other, and confirms with `"holding": true` in a request, after which the button shows "Holding"; the person releases the hold with the same button. Nothing the agent is running is cancelled. The hold is kept in the session's state file and stated at the head of the board's rendition; only the agent can confirm a hold, and only the person can request or release one.

R2.9. **For you:** the files the agent has sent the person in this session (the desktop app's file cards), newest first, each with its caption and time and a thumbnail for an image. A click previews the file in an overlay over the Desk (an image large, a PDF in Chromium's viewer, Markdown rendered, text and code as text, anything else by name and size), with buttons to open it in its default app, show it in the Finder, or discuss it. The right-click menu offers Discuss, Discuss with a note, Open in its default app and Show in the Finder, and a double-click marks it to discuss, as on every row (R2.7). A file no longer on disk is shown as gone; a file overwritten since it was sent shows its present content.

### R3. The trail

R3.1. Beneath the present state, the session turn by turn, newest at the bottom: each turn shows the person's message (with its images), the agent's actions in order with their descriptions, the files and notes touched, and the agent's closing message or recap.

R3.2. A turn's details collapse to one line and expand on request, so that a long session stays readable.

R3.3. The agent's reasoning is shown where the transcript keeps it, and marked as absent where it does not; it is never inferred.

### R4. The Memory pane

R4.1. Lists every note in the memory store of the session's project, grouped by type, each with its name and description, and marks the notes read or written in this session.

R4.2. Any note can be read in the Desk as rendered Markdown.

R4.3. The pane updates as notes are written, including during the session.

### R5. Reading safely

R5.1. The app reads the transcripts and the memory stores; it never writes, moves or deletes anything in the Claude configuration directory.

R5.2. A transcript can hold anything a tool printed, secrets included. The Desk shows each action by its description and target, not by its output; an action's raw output is not shown unless the person asks for that action's output.

R5.3. A long session's transcript can run to tens of megabytes: a Desk reads it incrementally, and opens within two seconds on a current laptop for a session of that size. The session list is built from each file's size, time and a few lines at its ends, never by reading whole files.

R5.4. The app makes no network connection: every request that is not to the app's own files is refused in code, whatever part of the app makes it.

R5.5. Records that hold the session's setup rather than its work (the system prompt, the account's context) are never shown.

### R6. Format drift

R6.1. The app reads the transcript through one module that knows the kinds of record it uses. A kind it does not know is counted, not fatal, and the Desk shows the count, so that a change in Claude Code's format is visible rather than silent.

R6.2. The app records the Claude Code versions it was checked against, reads the version each transcript records, and says when a session's version is newer than any it was checked against.

R6.3. What the Desk shows can be traced to the records it was derived from, so that when a part goes blank after an update, the missing kind of record can be found.

### R7. The board

R7.1. A session's window has a board beside its Desk: a whiteboard on which the person places shapes (rectangles, ellipses, diamonds), writes text in them, and joins them with lines and arrows. Freehand drawing is not part of the board. Images are (R7.8).

R7.2. The board is kept in an Excalidraw file per session (Excalidraw's format and editor are MIT), in a folder of the app's own outside every repository and outside the Claude configuration directory, at a path without spaces derived from the session's id. The window shows the path and copies it, so that the agent can be told where the board is.

R7.3. Beside the board file the app keeps a plain-text rendition, current with every change: each shape's id, kind, text and rough position, and each connection as "A → B" with its label. The agent reads the rendition rather than the board's full JSON.

R7.4. The agent changes the board by writing a short request file beside it, listing shapes to add (kind, text, position, and connections by shape id) and shapes to remove or relabel. The app expands the request into full Excalidraw elements, merges it into the board, and removes the request file; the agent never writes Excalidraw's full format.

R7.5. The person's edits and the agent's requests merge by element, so that neither overwrites the other: a change to the board file from outside the window is merged element by element, the newer version of each element winning, and the board file is always written whole and atomically.

R7.6. The board carries two signals from the person to the agent. **Editing** is a checkbox that any change the person makes to the board checks, and that the person unchecks when done, so the agent knows whether the board is still being changed. **Review** is a toggle the person turns on to ask the agent to read the board now, which also unchecks Editing; the agent turns it off, with its request, once it has read the board. Both are off by default, kept on disk beside the board, and stated at the head of the rendition.

R7.7. The person's signals (Review, Discuss, Hold) reach the agent without a message from the person. Two routes are provided. A **watcher**, a shell script that Claude Code itself runs in every session as an `asyncRewake` hook, at the end of each turn and when a session is resumed, exits when a new signal appears and so wakes the session at once, with a description of the new signal; a rule in the person's `~/.claude/CLAUDE.md` says how to answer. One watcher runs per session; it never depends on the agent remembering to start it, and, being a hook rather than a background command, it does not make the desktop app report the session as working. It never runs at a new session's start: Claude Code waits for a SessionStart hook to finish before the session answers, whether or not it is `asyncRewake`, so a watcher there holds the session until a signal arrives; a new session is therefore watched from the end of its first turn, and the watcher script itself exits at once if it is started there. A **channel**, an MCP server shipped in the app and run by Claude Code over stdio with the app's own binary, pushes each signal into the session the moment it appears; Claude Code loads channels only in terminal sessions started with it, as a research preview, so the watcher remains for the desktop app until that changes. The app's **Set-up Info** window gives the person copyable text that has Claude install the watcher, the hook and the rule, and the command that starts a terminal session with the channel. The channel uses Node's standard library only and opens no network connection.

R7.8. The board takes images: the person drops or pastes one, or places it with the image tool; the agent adds one by naming an image file in a request (`{"kind": "image", "path": "…"}`), scaled to at most 480 points on its longer side unless a width is given. Each image is kept in the board file, as the editor needs, and written once as its own file in a folder beside the board (`<session>.files/`), so that the agent can open it; the rendition lists each image with its position, size and file. PNG, JPEG, GIF, WebP and SVG are taken, up to 20 MB each.

R7.9. A session that continues an earlier one under a new id (resumed or forked: its transcript begins with the earlier records, which keep their own session id) takes over the earlier session's board when its window first opens, by copy: the drawing and its images, merged with any shapes the new board already has, and the Discuss marks already turned off or answered. Signals still open stay with the session they were given to, and the earlier board is left unchanged. This happens once; the board file records the session it was continued from, and the board's header says so.

## Proposed: seeing more of what sessions do (2026-11-14)

These requirements are proposed, not decided: they extend R1, R2, R3 and R7 and await review, and each open question below (Q5 to Q16) is a choice for the owner. Where one changes what exists now, it says so. Every new row a requirement adds to a session's window can be marked to discuss as R2.7 gives the rows of Plan, Now, Trail, Memory and For you; this extends R2.7's list, since the northstar asks each new view to offer a signal (intent 2).

### R8. Live state

Now: the session list shows a session's title, folder and time of last activity, and marks it recently active when its transcript was written in the last ten minutes (R1.1); a Desk says when the agent has spoken last and the turn is the person's (R2.4), but shows a session stopped inside a turn, on a permission request or a question, as at work, and neither knows whether the session is still running.

R8.1. Each live session's state is one of: **Working**, **Idle** (with the time it became idle), or **Waiting for you**. It is shown on the session's row in the list and on the header of its window, and it is current within two seconds of the session's state changing. Idle stands beside R2.4's "your turn", which still says that the agent has spoken last.

R8.2. A session that is not running is shown as such, distinct from Idle, so that a finished session is never taken for one waiting.

R8.3. The list can be sorted so that sessions waiting for the person come first, and the number of sessions waiting for the person is shown where the person sees it without opening the app (on macOS, the Dock icon's badge; on Ubuntu, Q8).

R8.4. **Why it waits:** when a session is waiting for the person, the Desk says on what, and since when: a permission request, named by the tool and its one-line description as R5.2 names actions (never the raw command or input); or a question put through Claude Code's question tool (AskUserQuestion). A waiting reason disappears when the session moves on.

R8.5. Where the source of live state is missing or reads nothing the app recognises, the app falls back to what it shows now (R1.1, R2.4) and says that live state is unavailable, as R6 requires of format drift.

### R9. Dispatches

Now: a subagent appears as the action that started it, in Now and the Trail (R2.2, R3.1), and that action's output, shown on request (R5.2), is its final report; one started in the background is also listed in Waiting while it runs (R2.3), and its completion notice appears in the Trail. Its own actions are not shown (S5).

R9.1. The window has a sixth panel, **Dispatches**, turned on and off like the others; this adds it to D9's list. It lists every subagent the session started, including those started in the background, newest first: its agent type, the task description it was given, the model it ran on, whether it is still running, and, once finished, its duration, its token count and its number of tool calls.

R9.2. A dispatch's row expands to its own actions, shown as R2.2 and R3.1 show the session's (descriptions and targets, with raw output only for the action the person picks, R5.2), and to its final report.

R9.3. A dispatch's row is linked to the action in the Trail that started it, and that action to the row, so that either leads to the other.

### R10. Background work and wake-ups

Now: Waiting (R2.3) lists background work that the transcript shows was started and not yet seen to finish, inferred from its records.

R10.1. Waiting lists the session's running background work as Claude Code reports it at the end of each turn: each item's description and how long it has run, and the command by its description, with its raw text only for the item the person picks (R5.2).

R10.2. Waiting also lists the session's scheduled wake-ups: each one's next time ("wakes at 14:30"), whether it recurs, and the prompt it will send (its extent is Q11).

R10.3. Where the report is unavailable (the hook is not installed, or the session predates it), Waiting falls back to what it shows now, and says so.

### R11. Compaction

Now: a compaction is not shown. The summary the session continues from is recorded as a message of the person's kind, and the reader hides it as a system record, so the Trail runs on past the compaction with no sign of it.

R11.1. Where the session's context was compacted, the Trail shows a marker at that point: when it happened, whether the person or Claude Code started it, and how much context it replaced.

R11.2. The marker expands to the summary the agent continues from, so that the person can see what the agent still holds of the earlier session. The summary is the session's work, not its setup (R5.5).

R11.3. The summary is never shown as a message from the person (R3.1).

### R12. Board tools for the agent

Now: the agent reads the rendition and writes a request file (R7.3, R7.4), which also carries its Discuss answers, a confirmed hold and a finished review (R2.7, R2.8, R7.6). The app applies board changes only while the window has its board open and reports the outcome only on the board's status line; the agent is not told what was refused, and a request that is not valid JSON stays on disk unapplied.

R12.1. The agent can read the board, add shapes, answer a Discuss mark and confirm a hold through tools it calls by name, each of which answers at once with what changed or why it was refused.

R12.2. The tools change nothing that R7.5 protects: the person's edits and the agent's requests merge by element, and neither overwrites the other.

R12.3. Where the tools are not available in a session, the request file (R7.4) still works.

### Proposed defaults

- P5. **Install:** the hooks and any extension these require are installed as the watcher is (R7.7): from text in the Set-up Info window, which the person pastes into a session and Claude carries out; the app itself still writes nothing in the Claude configuration directory (R5.1), and keeps what the hooks record in its own folder.
- P6. **Order:** R8 first, then R9 and R11, then R10 and R12, each its own pull request.
- P7. **Subagents:** R9 takes up what S5 left out of the first version.

### Open questions

- Q5. Whether Dispatches lists background sessions (sessions of their own, started with `claude --bg` or from agent view) as well as subagents; and its name: Subagents if it lists subagents alone, or Dispatches with background sessions included and the term defined under Definitions (the handbook and `claude agents` both use "dispatch" more widely).
- Q6. What the app installs (P5): new hooks in the person's Claude settings, and for R12 an extension Claude Code loads; whether Claude installs them from that text, as for the watcher, or the person installs them by hand, and whether R5.1 needs restating to say that Claude, at the person's request, writes there.
- Q7. Is the waiting count on the Dock (R8.3) wanted, or only the sort?
- Q8. What Ubuntu shows in place of the Dock badge (R8.3), given D4.
- Q9. Whether a session waiting on a question the agent asked shows the question's text, or only that there is one (R8.4).
- Q10. Whether R8 reads live state from Claude Code's documented session listing, which costs a process each time it is read, or from a file Claude Code writes per session, which is undocumented (design, but it decides how current R8.1 can be).
- Q11. Whether R10.2 shows a scheduled prompt's full text or only its first line.
- Q12. Whether the compaction summary (R11.2) is shown in full, or only its opening, given that it can run to thousands of words.
- Q13. Whether the board tools (R12) replace the request file or sit beside it (R12.3 proposes beside).
- Q14. Whether R12's extension also loads in a terminal session (not yet tried), or the channel server (R7.7) must offer the tools there.
- Q15. Whether R9 shows a dispatch's effort level beside its model.
- Q16. What `Waiting for you` means for a background session that no terminal is attached to (`claude attach`).

### Feasibility, probed 2026-11-14

Probed on Claude Code 2.1.325, in test sessions driven as the desktop app drives them; none of this is built. Live state and its waiting reason (R8) are reported by Claude Code's session listing and by a file it writes per process (`~/.claude/sessions/<pid>.json`, carrying the session's id, its status and when that changed), both of which showed "waiting" with "permission prompt" while a permission request was open; a hook that runs on each permission request receives the tool and its input at once. The end-of-turn hook already installed for the watcher receives the running background work and the session's cron jobs (R10). Each subagent has its own transcript and a short description file beside the session's, and its effort is recorded on each assistant record of its own transcript, as the session's is (R9). For a subagent in the foreground, the session's transcript records its model, duration, tokens and tool calls; for one in the background, the figures arrive in its completion notice (not yet seen on 2.1.325) and the model only in its own transcript and description file. A compaction is recorded in the transcript itself, with the summary that follows it (R11). An extension loaded into a test session registered a tool the model called, which wrote a request file (R12); not yet tried in the desktop app itself, where the person is asked once to allow such an extension, and its reply to the model needs the shape Claude Code expects. Not yet seen: what is reported when a session waits on a question rather than a permission (Q9), and whether a wake-up set with ScheduleWakeup is reported with the cron jobs.

## Proposed and settled

These were the defaults proposed during the discussion; S1 to S4 above settle them.

- P1. **Which sessions:** all sessions on the machine are listed, the live ones first and the finished ones below, since a finished session's record is as readable as a live one's.
- P2. **No network:** the app makes no network connection of any kind, since a transcript can hold anything.
- P3. **Raw output:** R5.2 as written: an action's output is shown only for the action the person picks, never in bulk and never by default.
- P4. **Name and icon:** reserved as the project's unregistered marks, as for the other apps of the family, with a statement in `LICENSING.md` once the app has an icon.

## Open questions, settled

S5 to S8 above settle these.

- Q1. Subagents and background agents keep transcripts of their own beside the session's. Should a Desk show them, nested under the action that started them, or leave them out of the first version?
- Q2. Should the Desk show the session's own record of the person's mid-turn messages separately, or only as they appear in the trail?
- Q3. Should the app be able to open a session's working folder or a touched file in the system's file manager or editor?
- Q4. How long a finished session stays in the list: always, or until it is older than some age?
