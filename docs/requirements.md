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
- D5. The repository is public, in the ParkviewLab organisation, and the code is licensed under AGPL-3.0-or-later. It began under the garycoding account and moved to ParkviewLab on 2026-11-21: by then it was a released tool of the lab, used in every Claude Code session, rather than an exploration. The old address redirects, and garycoding/garnet-scoping must not be recreated.
- D6. The app is named garnet-scoping; "Desk" names a part of its window (since D9, one of the window's panels), not the app.
- D7. Changes to the details are expected to follow from use: the first version is the starting point, not a fixed design.
- D8. Each session has one window, holding its Desk and its board (R7); the board is a shared whiteboard of shapes with text, lines and arrows.
- D9. The window's panels, Desk (the present state), Trail, Memory, Discuss (R2.7) and Board, are each turned on and off. When the board is shown beside other panels it takes half the window until the person moves the divider (R19), on the side (left, right, top or bottom) set in Settings; the other panels share the remaining half.

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

R7.7. The person's signals (Review, Discuss, Hold) reach the agent without a message from the person. Two routes are provided. A **watcher**, a shell script that Claude Code itself runs in every session as an `asyncRewake` hook, at the end of each turn and when a session is resumed, exits when a new signal appears and so wakes the session at once, with a description of the new signal; the rules for answering are given to every session by the garnet-scoping plugin (P5). One watcher runs per session; it never depends on the agent remembering to start it, and, being a hook rather than a background command, it does not make the desktop app report the session as working. It never runs at a new session's start: Claude Code waits for a SessionStart hook to finish before the session answers, whether or not it is `asyncRewake`, so a watcher there holds the session until a signal arrives; a new session is therefore watched from the end of its first turn, and the watcher script itself exits at once if it is started there. A **channel**, an MCP server shipped in the app and run by Claude Code over stdio with the app's own binary, pushes each signal into the session the moment it appears; Claude Code loads channels only in terminal sessions started with it, as a research preview, so the watcher remains for the desktop app until that changes. The app's **Set-up Info** window gives the person the commands that install the garnet-scoping plugin, which carries the watcher, its hooks and the rules (P5), and the command that starts a terminal session with the channel. The channel uses Node's standard library only and opens no network connection.

R7.8. The board takes images: the person drops or pastes one, or places it with the image tool; the agent adds one by naming an image file in a request (`{"kind": "image", "path": "…"}`), scaled to at most 480 points on its longer side unless a width is given. Each image is kept in the board file, as the editor needs, and written once as its own file in a folder beside the board (`<session>.files/`), so that the agent can open it; the rendition lists each image with its position, size and file. PNG, JPEG, GIF, WebP and SVG are taken, up to 20 MB each.

R7.9. A session that continues an earlier one under a new id (resumed or forked: its transcript begins with the earlier records, which keep their own session id) takes over the earlier session's board when its window first opens, by copy: the drawing and its images, merged with any shapes the new board already has, and the Discuss marks already turned off or answered. Signals still open stay with the session they were given to, and the earlier board is left unchanged. This happens once; the board file records the session it was continued from, and the board's header says so.

## Proposed: seeing more of what sessions do (2026-11-14)

These requirements are proposed, not decided: they extend R1, R2, R3, R6 and R7, R13 and R14 add two ways of asking, R15 adds receipts for signals, R16 adds asides, R17 an Away toggle, and R18 a manual, and all of them await the owner's review. The owner ruled on the questions of display and communication on 2026-11-14 (listed under Rulings); how the data is read from Claude Code is set by the proposed defaults below, each with its reason, and any of it can still be overturned in review. Where one changes what exists now, it says so. Every new row a requirement adds to a session's window (a subagent, a waiting reason, a wake-up, a compaction marker) can be marked to discuss as R2.7 gives the rows of Plan, Now, Trail, Memory and For you; this extends R2.7's list, since the northstar asks each new view to offer a signal (intent 2). Such a mark stays with its row as R2.7's do, and a row that has gone (a waiting reason that has passed) is kept, marked as past, while a mark on it is open.

### R8. Live state

Now: the session list shows a session's title, folder and time of last activity, and marks it recently active when its transcript was written in the last ten minutes (R1.1); a Desk says when the agent has spoken last and the turn is the person's (R2.4), but shows a session stopped inside a turn, on a permission request or a question, as at work, and neither knows whether the session is still running.

R8.1. Each session's state is one of: **Working**; **Idle** (with the time it became idle); **Waiting for you**; **Not running** (no Claude Code process holds it; it can be resumed); or **Unknown** (the app cannot read its state, R8.5). It is shown on the session's row in the list and on the header of its window, and, while the session files are readable (P8), it is current within two seconds of the session's state changing. Idle stands beside R2.4's "your turn", which still says that the agent has spoken last. The "recently active" mark of R1.1 remains for sessions whose state is Not running.

R8.2. A session is **Waiting for you** when it is stopped inside a turn on a permission request or on a question put through Claude Code's question tool (AskUserQuestion); when it is holding (R2.8); or when its turn ended with a question in the desktop app's next-step box (R2.4's "Asked"). A turn that simply ended is Idle, whether or not the agent's last message asks anything (R2.4). A background session (started with `claude --bg`) that waits is Waiting for you, labelled "background, attach to answer"; Claude Code does not record whether a terminal is attached (probed 2026-11-14), so the label is shown whenever a background session waits.

R8.3. The list offers three views, in this order: **Waiting first**, every session in one list with those waiting first; **Recent first**, by project, the projects and the sessions in each ordered by last activity, most recent first; and **Alphabetical**, the projects in alphabetical order, the sessions in each most recent first. The number of sessions waiting for the person is shown on the Dock icon's badge on macOS (which needs the person's permission for notifications), and on Ubuntu on the dock icon where the system supports a count, and nowhere where it does not.

R8.4. **Why it waits:** when a session is waiting for the person, the Desk says on what, and since when: a permission request, named by the tool and its one-line description as R5.2 names actions (never the raw command); a question put through the question tool, shown with its text and the labels of its options, which are the agent's words, not a tool's output (taken from the transcript where live state does not carry them); a hold; or a next-step question. A reason the app does not recognise is shown as Claude Code gives it, and counted as waiting. A waiting reason is removed when the session moves on, unless a Discuss mark on it is open.

R8.5. Where the source of live state is missing or reads nothing the app recognises (P8), the app falls back to what it shows now (R1.1, R2.4), shows the state as Unknown, and says that live state is unavailable, as R6 requires of format drift.

R8.6. **The Sessions panel:** the session list (R1.1, with R8.1 to R8.3) is a panel of the session window, turned on and off like the others; this adds it to D9's list and replaces the separate list window. Choosing a session in it opens that session's window, or brings it forward if open. The app opens on a window for the most recently active session, with the Sessions panel on.

### R9. Subagents

Now: a subagent appears as the action that started it, in Now and the Trail (R2.2, R3.1), and that action's output, shown on request (R5.2), is its final report; one started in the background is also listed in Waiting while it runs (R2.3), and its completion notice appears in the Trail. Its own actions are not shown (S5).

R9.1. The window has a sixth panel, **Subagents**, turned on and off like the others; this adds it to D9's list. It lists every subagent the session started, including those started in the background, newest first: its agent type, the task description it was given, the model it ran on with its effort level beside it ("Opus 5.5, max"), whether it is still running, stopped without finishing (its session ended first), or finished, and, once finished and where Claude Code recorded them, its duration, its token count and its number of tool calls. Background sessions are not listed here: each is a session of its own, with its own row in the list (R1.1).

R9.2. A subagent's row expands to its own actions, shown as R2.2 and R3.1 show the session's (descriptions and targets, with raw output only for the action the person picks, R5.2), and to its final report. A subagent that a subagent started is shown beneath it.

R9.3. A subagent's row is linked to the action in the Trail that started it, and that action to the row, so that either leads to the other.

R9.4. A Discuss mark on a subagent's row or on one of its actions reaches the session's agent as any mark does; the agent answers from the subagent's transcript, which the mark names.

### R10. Background work and wake-ups

Now: Waiting (R2.3) lists background work that the transcript shows was started and not yet seen to finish, inferred from its records.

R10.1. Waiting lists the session's running background work from both sources: what the transcript shows (as now), and what Claude Code reports at the end of each turn. Work started or finished in the middle of a turn is shown from the transcript at once; the end-of-turn report confirms it and adds what the transcript does not show. Each item shows its description and how long it has run, and the time of the last report is shown. A command is shown by its description, with its raw text only for the item the person picks (R5.2).

R10.2. Waiting also lists the session's scheduled wake-ups: each one's next time ("wakes at 14:30"), whether it recurs, and the prompt it will send, by its first line, expandable to the whole of it.

R10.3. Where the report is unavailable (the hook is not installed, or the session predates it), Waiting shows what the transcript shows, as now, and says so.

### R11. Compaction

Now: a compaction is not shown. The summary the session continues from is recorded as a message of the person's kind, and the reader hides it as a system record because its opening words match a fixed list, so the Trail runs on past the compaction with no sign of it.

R11.1. Where the session's context was compacted, the Trail shows a marker at that point: when it happened, whether the person or Claude Code started it, and how much context it replaced.

R11.2. The marker expands to the summary the agent continues from, so that the person can see what the agent still holds of the earlier session: its first paragraph, expandable to the whole, shown rendered in a box that scrolls. The summary is the session's work, not its setup (R5.5).

R11.3. The summary is recognised by the field Claude Code marks it with, not by its wording, and is never shown as a message from the person (R3.1).

### R12. Board tools for the agent

Now: the agent reads the rendition and writes a request file (R7.3, R7.4), which also carries its Discuss answers, a confirmed hold and a finished review (R2.7, R2.8, R7.6). The app applies board changes only while the window has its board open and reports the outcome only on the board's status line; the agent is not told what was refused, and a request that is not valid JSON stays on disk unapplied.

R12.1. The agent can do through tools it calls by name everything the request file does: read the board; add, relabel and remove shapes and images; answer a Discuss mark; confirm a hold; and report a finished review. Each tool answers at once: with what changed; with why it was refused; or, for a board change while the board is not open, that the change is queued and will be applied when it opens, and the agent can ask afterwards what became of it.

R12.2. The tools change nothing that R7.5 protects: the person's edits and the agent's requests merge by element, and neither overwrites the other. The tools and the request file sit beside each other and go through the same merge.

R12.3. The tools are offered in every session where Claude Code loads the garnet-scoping plugin (P5), in the desktop app and in the terminal; where they are not available, the request file (R7.4) still works.

### R13. Questions on the board

Now: the person asks about something on the board only by Review, which tells the agent to read the board without saying what about (R7.6), or in the conversation, away from the thing asked about.

R13.1. A right-click anywhere on the board offers **Add question**. It places a speech balloon (a rounded rectangle whose pointer arm is part of its outline) with the arm's tip at the point clicked, on a shape, a mark the person drew, or empty board, and the person types the question into the balloon; Enter sends it and Escape discards it.

R13.2. A sent question reaches the agent as a signal, as a Discuss mark does (R2.7, R7.7), with its text, what its arm points at, and a picture of the area round that point, so that the agent sees the person's marks as drawn. The header counts the open questions as it counts open Discuss marks.

R13.3. The agent answers on the board: a note in a colour of its own, joined to the question by a line. An answer that needs more than a few lines is given in the conversation, and the note says so. A right-click on the agent's latest answer offers **Add question**, which places a follow-up balloon whose arm already points at that answer; the questions and answers of one exchange form a chain.

R13.4. Every balloon and note can be dragged on its own; the arms and lines that join the chain, and the first arm's tip on the thing asked about, stay attached and reshape as it moves.

R13.5. A right-click on any piece of an exchange offers **Remove this exchange**, which removes every balloon, note and link in it at once. The agent can remove an exchange too, through its board requests (R7.4) or tools (R12), and says in the conversation which one it removed and why.

R13.6. The person's balloons and the agent's notes differ in colour and shape, so that whose words they are is never in doubt.

### R14. Notes from the agent

Now: only the person can point at an item to raise it (R2.7); an assumption the agent makes in place of asking is visible only if it says so in the conversation.

R14.1. The agent can pin a one-line note to a plan step, a board shape, a file it sent the person, or its own last message, through its board requests (R7.4) or tools (R12): an assumption it made ("Assumed: sorted by date, newest first") or a thing it wants looked at.

R14.2. The Desk shows each note on its item with a badge, counts the open notes in the header, and lists them as it lists Discuss marks, leading to the item as R2.7 does.

R14.3. The person answers a note with **Confirm**, **Correct** (with one line) or **Dismiss**, and the answer reaches the agent as a signal, as a Discuss answer does. The agent does not wait for it.

R14.4. A note is the agent's report, not the record (northstar, axiom 2), and is shown as such.

### R15. Receipts for signals

Now: a signal the person gives (Review, Discuss, Hold, and a question on the board, R13) shows only that it was given, and its answer once the agent records one; nothing shows whether it reached the session, and when no watcher is running for the session (R7.7) the signal waits unseen with nothing to say so.

R15.1. Every signal shows its receipt in three steps: **Sent**, **Delivered** (the watcher, or the channel, has passed it to the session and woken it) and **Answered** (the agent has recorded its answer: a Discuss answer, a finished review, a confirmed hold, an answer on the board). Delivered means the session was woken with the signal, not that the agent has read it, and is labelled so.

R15.2. When no watcher or channel is running for a session, its window says so plainly, with the signals that are waiting, when they will next be delivered (the watcher starts again at the end of the agent's next turn), and a way to open Set-up Info. A signal given meanwhile shows **Not delivered**.

R15.3. Signals that were waiting are marked Delivered when a watcher or channel next passes them on.

### R16. Asides

Now: a question about the agent's work reaches only the agent, by Discuss (R2.7), and is answered when the agent reaches a step boundary, which can be long in coming; asking costs the agent a pause in its work.

R16.1. A row's right-click menu offers **Ask aside** beside Discuss. The person types a question (prefilled with a suggestion), and a copy of the session, taken from its transcript as it stands, answers it at once under the row, while the agent works on undisturbed and is not told.

R16.2. An aside's answer says what it is: answered by a copy of the session that has no tools, so it explains from what the session has done and can be wrong; it is never shown as the agent's own answer (northstar, axiom 2).

R16.3. Asides and their answers are kept with the session's marks (R2.7), so that the agent can read them later and the person can turn one into a Discuss mark when the agent itself should answer.

R16.4. An aside uses tokens on the person's account; the app says so where it is asked, and asks nothing on its own.

### R17. Away

Now: the agent cannot tell whether the person is there, and it cannot tell whether the board on which it places an image is open.

R17.1. The window's header has an **Away** toggle, with an optional time of return ("away until 15:00"). Turning it on or off reaches the agent as a signal (R7.7) and shows on the session's row in the list (R8).

R17.2. While the person is away, the agent does not sit idle on a question: it keeps the question for the person's return and moves on to work that does not need the person's answer, stopping only when nothing is left that can be done without it. It makes no assumption in the person's place. Permission requests are Claude Code's and are not affected.

R17.3. Turning Away off reaches the agent as a signal. The agent then welcomes the person back and takes them through what happened and what is pending (the work done, then each kept question) one at a time, as the person answers. A time of return that passes is shown by the app and changes nothing until the person turns Away off.

R17.4. The state the agent reads also says whether this session's window is open and its board shown, worded as a fact about the window and not about the person's attention (northstar: nothing is inferred from silence).

### R18. The manual

Now: the app has no manual of its own; the README and Set-up Info describe installation, not use.

R18.1. The app carries an animated manual made of short lessons, each teaching one task in under thirty seconds, played on the app's own interface with a moving pointer, captions and a voice-over.

R18.2. A lesson is found where the person is: from a **?** on each panel, which lists that panel's lessons, and from a **How do I…** search over all of them. There is no course to follow from start to finish.

R18.3. The manual works without a network connection: lessons, captions and voice-over ship inside the app.

R18.4. The manual is designed before any lesson is made: the list of lessons and where each is offered, the script of each, how its animation is produced and kept current as the interface changes, and the voice. That design is put to the owner, as every design is.

R18.5. A lesson plays in a manual window of its own, which opens beside the person's session window, on a demo session shipped with the app. The person's own session stays in view while a lesson plays, and nothing a lesson does reaches a real session: it sends no signal and changes no board.

R18.6. When a lesson has played, it asks the person to do its step themselves on the demo ("Your turn: press Hold on the demo") and confirms when they have. The person can skip this.

R18.7. While a lesson plays, the person can pause and resume it, go back one step, replay it from the start, show or hide the captions, and turn the voice off or on; a counter shows the step. There is no speed control: a lesson is under thirty seconds and can be paused or stepped back.

R18.8. The voice-over is spoken in phonorheos's voice bf_emma, a voice no session speaks with, so that the manual is never mistaken for an agent.

R18.9. The lessons, each one task, in five groups:

- **Getting around:** 1. Find the sessions waiting for you. 2. Read the Dock count (macOS only; on Ubuntu the count reaches only some launchers). 3. Switch between Waiting first, Recent first and Alphabetical. 4. Find a session by title or folder. 5. Open another session's window. 6. Turn panels on and off. 29. See the sessions another session started (R20). 30. Find out what anything is with What's This (R21).
- **Following the agent:** 7. Read the Desk at a glance. 8. See why a session is waiting. 9. Follow the Trail turn by turn. 10. Read what the agent keeps in Memory. 11. See what the agent's subagents are doing. 12. Spot a compaction and read its summary. 13. Check the work running in the background and the wake-ups.
- **Talking to the agent:** 14. Ask the agent about a row (Discuss). 15. Ask an aside without interrupting. 16. Pause the agent with Hold. 17. Tell the agent you are away, and come back. 18. Answer a note the agent pinned for you. 19. Check that a signal reached the agent.
- **Working on the board:** 20. Draw shapes and connect them. 21. Ask a question on the board. 22. Follow up and remove an exchange. 23. Ask the agent to review the board. 24. Mark up a mock-up the agent placed.
- **Setting up:** 25. Set up Claude Code with Set-up Info. 26. Update the install when the app says it is stale. 27. Choose the board's side in Settings. 28. Preview and open the files the agent sent you.

R18.10. A lesson is found from a **?** at the right of each panel's header, which lists that panel's lessons, and from **How do I…** in the Help menu (⌘? on macOS; F1 on Ubuntu, where F1 is the usual key for help), which opens the manual window with a search over every lesson's title and captions.

R18.11. A lesson stays correct as the interface changes: a check fails when an element a lesson acts on no longer exists, so a lesson cannot silently show what the app no longer has.

R18.12. The manual window cannot be taken for a session window: it is framed by teal diagonal stripes, a colour and a pattern no other window uses, so that it stands apart without colour vision as well as with it; its top is a strip in the same teal saying that it practises on a demo session and that nothing in it reaches the person's real sessions, with the lesson's controls and a **Leave the manual** button that closes it; its title is "garnet-scoping Manual"; and each session in its Sessions panel is tagged "demo". Teal was chosen as a safe colour (green in the safety-sign standards), apart from the garnet of the app's accent and the blue of its Working badge; yellow stripes were declined as reading as a hazard.

### R19. Resizing panels

R19.1. Open panels are separated by splitters: a divider between each pair of neighbouring panels that the person drags to move the space between them. A divider between panels side by side is vertical and drags left and right; the divider between the Desk's panels and the board, when the board is above or below them (D9), is horizontal and drags up and down.

R19.2. A drag changes only the two panels either side of the divider, and neither is made smaller than 90 px.

R19.3. A divider thickens and shows the resize cursor while hovered or dragged. The divider between the Desk's panels and the board is drawn stronger than those between the Desk's panels.

R19.4. A double-click on a divider gives its two panels their default sizes back: the board half the window (D9), and the Desk's panels their usual shares.

R19.5. The sizes are remembered as the open panels are, across windows and restarts.

### R20. Spawned sessions

Now: a session that another session started (through the desktop app's start-session tool) is listed as any other, at the top level of its project, with nothing to say which session started it.

R20.1. In the Sessions panel, a spawned session is listed beneath the session that started it, indented, with a line joining it to that session; its second line reads "started by the session above" in place of its folder. A session spawned by a spawned session is indented one step further.

R20.2. A session that has spawned sessions shows a chevron that folds them away and back; while folded, its title is followed by the number spawned ("· 1 spawned"). The fold is remembered per session, as the panels are (R19.5).

R20.3. A spawned session whose parent is not listed (its transcript is gone, or it belongs to another project), and every session started outside the desktop app, is listed at the top level, as now.

R20.4. The order of R8.3 applies to the top-level sessions; a parent's spawned sessions follow it, in the same order among themselves.

### R21. What's This

Now: a lesson is found from a panel's **?**, which lists that panel's lessons, or by searching How do I… (R18.10); nothing says what a single control is for.

R21.1. A **What's This** mode turns the pointer into the help cursor (an arrow with a question mark). It is entered from a **?** button at the right of the window's header, from "What's This?" in the Help menu, and by a shortcut: ⌥⌘? on macOS, beside How do I…'s ⌘?, and ⇧F1 on Ubuntu.

R21.2. While the mode is on, a line under the header says what it does and how to leave it, and the element under the pointer is outlined with its name, so that the person sees what a click will ask about.

R21.3. A click in the mode asks about the element clicked and never acts on it: a card beside the element gives its name, what it is (and, where the element is a control, what it does), what it is for, and the lessons that act on it, each of which opens the manual on that lesson. Where no lesson acts on the element itself, the card lists the lessons of the panel that holds it, and says so.

R21.4. The mode ends after one click, or on Esc; a click with Shift held keeps it on, for asking about several things in turn. A click outside the card, or Esc, closes the card.

R21.5. Every element the manual names (R18.11) has its name, explanation and purpose, and a check fails when one lacks any of them, so that a card cannot be blank for a control the app has.

### Rulings, 2026-11-14

- **Waiting count:** both the count on the Dock and the waiting-first order (R8.3); on Ubuntu, a dock count where the system supports one and nothing where it does not.
- **Order:** three views, Waiting first, Recent first and Alphabetical (R8.3), settled on seeing the panel built.
- **Sessions panel:** the session list is a panel of the window, not a window of its own; the app opens on the most recently active session with that panel on (R8.6).
- **Background sessions waiting:** shown as Waiting for you, labelled "background, attach to answer" (R8.2).
- **Questions:** a waiting question is shown with its text and option labels (R8.4).
- **The panel:** named Subagents, listing subagents only; background sessions stay rows of their own (R9.1).
- **Effort:** each subagent's effort is shown beside its model (R9.1).
- **Long text:** a wake-up's prompt and a compaction summary are shown by their opening, expandable to the whole (R10.2, R11.2).
- **Board tools:** beside the request file, through the same merge (R12.2), offered wherever the extension loads (R12.3).
- **Install:** as the watcher is, by Claude from text the person pastes (P5).
- **Questions on the board:** asked from the right-click menu, typed into a balloon pointing at the spot clicked, answered on the board, chained by follow-ups, removable by either side (R13); demonstrated in mock-ups on 2026-11-14.
- **Notes from the agent:** accepted (R14).
- **Receipts:** accepted (R15), demonstrated in a mock-up.
- **Asides:** accepted (R16), demonstrated in a mock-up.
- **Away:** accepted (R17): while away, the agent keeps its questions and moves on with work that does not need the person; on return it takes the person through what is pending, one item at a time.
- **Manual:** proposed by the owner; lessons with voice-over, found from each panel and by search (R18); designed first, then made last, once the features it teaches exist.
- **Resizing panels:** splitters between open panels, vertical or horizontal as the panels lie, with a 90 px minimum and a double-click reset (R19); demonstrated in a mock-up on 2026-11-15.
- **What's This:** a mode that asks what any element is, entered from a header button, the Help menu or ⌥⌘? (⇧F1 on Ubuntu), one click per entry with Shift to keep it on, answered by a card with a description and the element's lessons (R21); proposed by the owner and demonstrated in a mock-up on 2026-11-21.
- **Spawned sessions:** indented beneath the session that started them, foldable by a chevron (R20); demonstrated in a mock-up on 2026-11-21.
- **The manual window's frame:** teal diagonal stripes round the window, a teal practice strip with Leave the manual, its own title and demo tags (R18.12); chosen 2026-11-21 from six rendered frames, the pattern so that it reads without colour vision.
- **Install as a plugin:** the Claude Code side of the app (hooks, board tools, rules) is one Claude Code plugin, replacing the pasted set-up text (P5), ruled 2026-11-21 after the probes recorded under P5.
- **The manual's design**, ruled 2026-11-14 and 2026-11-15 on mock-ups: a manual window of its own with a demo session (R18.5); each lesson played, then tried on the demo, with a skip (R18.6); the controls of R18.7, without speed; the voice bf_emma, chosen by ear from five (R18.8); the 28 lessons of R18.9; the entry points of R18.10.
- **Declined:** Discuss controls drawn in the Claude conversation itself (a selection there carries no row id, and the interaction was poor); pausing, dropping or reordering plan steps from the Desk (dropping or moving a step can break the steps after it, and a pause is a sentence in the conversation); pins re-given to the agent after a compaction (what must survive a compaction is kept on disk, in memory notes, the board and the repository, which the agent can read again).

### Proposed defaults

- P5. **Install:** everything the app needs inside Claude Code (the watcher and its hooks, the board tools of R12, and the rules for answering signals) is one Claude Code plugin, `garnet-scoping`, at the app's own version. The app keeps a local plugin marketplace in its own folder (`~/.garnet-scoping/claude-plugin`), written at each start; the person installs from it once with two `claude plugin` commands, given in Set-up Info, and updates with two more after an app update. The rules are printed into each session by the plugin's session-start hook, at startup, on resume and after a compaction, so nothing is written into the person's `~/.claude/CLAUDE.md`. R5.1 stands: the app never writes in the Claude configuration directory; Claude Code's own plugin commands do, when the person runs them. The app reads Claude Code's record of installed plugins and says when the plugin is missing, disabled, or of another version than the app, and when pieces of the earlier installation (the hooks in `settings.json`, the scripts in `~/.claude/hooks`, the extension in `~/.claude/mods`, the section in `CLAUDE.md`) remain, which would run a second watcher; Set-up Info gives the text that has Claude remove them. Probed 2026-11-21 on Claude Code 2.1.325 and the desktop app: one plugin's `hooks.json` carries command hooks and a hooks module together, and a test session ran both and loaded the plugin's skill; text printed by a plugin's session-start hook was in the session's context from its first turn; the plugin, installed from a local marketplace, was listed on the desktop app's Plugins page ("Installed locally, Hooks & skill") and its tool reached a session already running; each version is cached apart (`~/.claude/plugins/cache/<marketplace>/<plugin>/<version>`), so a watcher running from an earlier version is not disturbed by an update.
- P6. **Order:** R8 first, then R9 and R11, then R10 and R12, then R13 to R17, each its own pull request; R18, the manual, last.
- P7. **Subagents:** R9 takes up what S5 left out of the first version.
- P8. **Source of live state:** the app watches the files Claude Code writes per process (`~/.claude/sessions/<pid>.json`), which change the moment a session's state does, and treats a file whose process has gone as stale. Where those files are missing or unrecognised, it reads Claude Code's documented listing (`claude agents --json`) at a slower interval; only where both fail is the state Unknown. Reason: the files are undocumented but cost nothing to watch; the listing is documented and is the check on them. The listing is the only process the app runs; probed on 2.1.325, it wrote nothing under `~/.claude`, behaved identically with the network and writes there blocked, and took about 0.1 s. That probe is repeated whenever the checked Claude Code versions are raised.
- P9. **What the hooks record:** in the app's own folder only; no raw command, prompt or tool input beyond what the session's transcript already holds; deleted when that session's transcript is.
- P10. **Format drift:** R6's requirement extends to every new source: the session files, the listing, hook input, and subagents' transcripts and description files. Each is checked against the versions it was probed on.
- P11. **The compaction summary** is recognised by `isCompactSummary`, and the boundary by its `compact_boundary` record, which carries what R11.1 shows.
- P12. **Receipts** are read from what the watcher already writes in the app's folder: `<session>.watcher.pid` (whether a watcher is running, checked against a live process) and `<session>.watched` (the signals it has delivered). The channel records what it delivers in the same way. Reason: both files exist today and nothing reads them (verified 2026-11-14).
- P13. **Asides** are answered by a single tool-less completion over the session's own transcript, the prefix served from Claude Code's prompt cache where it is still warm (`$.model.fork`, in use in a mod on this machine). Probed 2026-11-14 in the desktop app: a fork started while the agent was running a 25-second command answered in 2.9 s, before the command ended, without interrupting the agent. It sees the session as of the agent's last request, so an aside knows everything up to the step in progress but not that step's own result, and its answer says so.
- P14. **Voice-over** is spoken by phonorheos, the lab's local speech app, when the lessons are made, and the audio ships with the app; phonorheos today only plays speech and keeps it in memory (checked 2026-11-14: no endpoint returns audio or writes a file), so making the voice-over needs a way to render speech to a file added to phonorheos first, a change in that repository.
- P15. **Lessons replay the interface, not video:** each lesson is a script of steps (point at an element, click, type, wait), each step naming the element it acts on and its caption, which the manual window plays on the app's own interface with an overlaid pointer. Reason: a recording goes stale with every interface change and weighs tens of megabytes, while a script names elements, so R18.11's check can find a lesson whose element has gone, and the same named element checks the person's own try (R18.6).
- P16. **The demo session** is a fixture shipped with the app: a transcript, a board and a state file in a folder of its own, read by the same code as a real session, so that a lesson shows the real panels; the manual window writes signals only to that folder, never to the boards folder.
- P17. **Spawned sessions** are read from the desktop app's own record of each session (`~/Library/Application Support/Claude/claude-code-sessions/…/local_<id>.json`), which holds the session's transcript id (`cliSessionId`) and, for a spawned session, the record id of the session that started it (`spawnedFrom.sessionId`). The record is undocumented; it is read only, and where it is missing or unrecognised every session is listed at the top level (R20.3, R6). Found 2026-11-21 on desktop app sessions running Claude Code 2.1.328; transcripts themselves do not name the parent.

### Open questions

None. Q17 and Q18 were settled by probes on 2026-11-14: a terminal session started with `--plugin-dir` loads R12's extension and called its tool within five seconds, so the channel server is not needed for the tools; and Claude Code does not record whether a terminal is attached to a background session (the listing and the session file carry the same fields attached and not), which R8.2 now reflects.

### Feasibility, probed 2026-11-14

Probed on Claude Code 2.1.325, in test sessions driven as the desktop app drives them; none of this is built. Live state and its waiting reason (R8) are reported by Claude Code's session listing and by a file it writes per process (`~/.claude/sessions/<pid>.json`, carrying the session's id, its status and when that changed), both of which showed "waiting" with "permission prompt" while a permission request was open; a hook that runs on each permission request receives the tool and its input at once. The end-of-turn hook already installed for the watcher receives the running background work and the session's cron jobs (R10). Each subagent has its own transcript and a short description file beside the session's, and its effort is recorded on each assistant record of its own transcript, as the session's is (R9). For a subagent in the foreground, the session's transcript records its model, duration, tokens and tool calls; for one in the background, the figures arrive in its completion notice (not yet seen on 2.1.325) and the model only in its own transcript and description file. A compaction is recorded in the transcript itself, with the summary that follows it (R11). An extension loaded into a test session registered a tool the model called, which wrote a request file (R12); not yet tried in the desktop app itself, where the person is asked once to allow such an extension, and its reply to the model needs the shape Claude Code expects. Not yet seen: what is reported when a session waits on a question rather than a permission, and whether a wake-up set with ScheduleWakeup is reported with the cron jobs.

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
