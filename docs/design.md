# garnet-scoping: design

How the first version meets [`requirements.md`](requirements.md). The requirements are the authority; this document records the choices made to meet them.

## Stack

An Electron app in plain JavaScript, built with electron-vite and packaged with electron-builder, as the handbook's `electron-tooling.md` describes and as the family's other Electron apps are built. Every dependency is bundled into the build, so the package carries no `node_modules`. The board is the one view that needs React, because the Excalidraw editor is a React component; the rest of the interface is plain DOM.

## Processes

- **Main** (`src/main/`): finds and reads the transcripts and memory stores, watches them, keeps the session models, owns the board files, and refuses every network request.
- **Preload** (`src/preload/`): a narrow bridge, `window.garnet`, with read calls and change events; the board's save and load are the only writes it exposes.
- **Renderer** (`src/renderer/`): the session window (its panels, the board among them), and a page shown only when the machine has no session at all.

## Reading transcripts

`src/main/transcript/` is the one place that knows Claude Code's record format (R6.1).

- **`records.js`** classifies a parsed line into the kinds the app uses: a human message, a system-injected user message (a task notification, a command echo, hook feedback, a skill's body), an assistant message with its text, reasoning and tool calls, a tool result, an attachment, a title, a pull-request link, and the rest. A kind it does not know is counted, not fatal. A human message is recognised by `origin.kind` where the record has it (Claude Code 2.1.18 and later); in older transcripts by elimination, and then marked as inferred.
- **`reader.js`** reads a file from a byte offset to its end and returns whole lines, holding back a final line that has no newline yet, so that a transcript being written is read incrementally and never half a record at a time.
- **`session.js`** folds records into a session model: the turns (each the person's message, the agent's actions, the files and notes touched, the closing message), the plan, the background work started and finished, the session's facts, and the counts of unknown kinds. The model is built once on open and extended with each new batch of lines.

The plan is read from whichever tool the session used: the desktop app's task list (`update_plan`, with its whole-list, advance and done/start forms), or the command line's (`TaskCreate` and `TaskUpdate`, the created task's id read from the call's result; or the older `TodoWrite`).

Background work is a shell command or an agent started in the background, recorded with its id in the call's result, and finished by a task notification carrying the same id.

## The session list

Built from each transcript's size and modification time, the first lines (its working folder and branch) and the last 64 KB (its title, last activity and version), never from whole files (R5.3). One recursive watcher on the projects folder updates it.

## Reading safely

- Nothing under the Claude configuration directory is opened for writing (R5.1).
- A shell action is shown by its description; its command and output are shown only when the person opens that action (R5.2).
- `session_context` and `prompt_snapshot` attachments are never rendered (R5.5).
- `session.webRequest.onBeforeRequest` cancels every request whose scheme is not the app's own (R5.4), before any connection is made. Excalidraw's fonts are copied into the build and found through `EXCALIDRAW_ASSET_PATH`; Excalidraw also lists a CDN beside each bundled font, and those attempts are cancelled like any other (Chromium does not allow a web address to be redirected to a local file). Its file loading, export and image tools are switched off, and windows may not open others.

## The board

Each session's board is three files in `~/.garnet-scoping/boards/`, named by the session's id:

- `<id>.excalidraw`: the board itself, Excalidraw's JSON.
- `<id>.board.md`: the rendition the agent reads, rewritten on every save: each shape's id, kind, text and position, and each connection as `A → B`.
- `<id>.request.json`: written by the agent when it wants to change the board, and removed by the app once applied.

A request is compact:

```json
{
  "add": [
    { "id": "smalt", "kind": "rectangle", "text": "Smalt", "x": 0, "y": 0 },
    { "id": "flax", "kind": "ellipse", "text": "Flax", "x": 300, "y": 0 },
    { "kind": "arrow", "from": "smalt", "to": "flax", "text": "stores in" }
  ],
  "relabel": [{ "id": "smalt", "text": "Smalt API" }],
  "remove": ["old-shape-id"]
}
```

The app expands added shapes and arrows with Excalidraw's own skeleton conversion, so that text sits in its shape and arrows are bound to the shapes they join, then merges the result into the board. A change to the board file from outside the window is merged element by element, the higher `version` winning; the board is written whole to a temporary file and renamed into place.

## Live state and the Sessions panel (R8)

The interface was settled with the owner through a clickable mock-up of the Sessions panel in a session window.

**Sources.** A new module, `src/main/live/`, is the one place that knows Claude Code's live-state format, as `transcript/` is for the transcript's (R6.1, P10).

- It watches `~/.claude/sessions/` (one file per Claude Code process, `<pid>.json`) and reads each file whole on change: `sessionId`, `kind`, `status` (`busy`, `idle`, `waiting`), `waitingFor` and `statusUpdatedAt`. A file is live only if its `pid` is a running process whose start matches `procStart`; otherwise it is stale and ignored, so that a crash leaves no session shown as running (P8).
- Where the folder is missing, or a file carries no field the module recognises, it runs `claude agents --json` every ten seconds with `execFile` (no shell, a five-second timeout, nothing written) and reads the same facts from its rows. Only where both fail is a session's state Unknown, and the panel says that live state is unavailable (R8.5).
- Each session is matched to its transcript by `sessionId`. A session with no live process is Not running.

**State.** The module turns those facts and the session model (`transcript/session.js`) into R8's five states:

- **Working:** `busy`.
- **Waiting for you:** `waiting`; or holding (the board's state file, R2.8); or a next-step question left at the end of the turn (the model's "Asked"). Background sessions (`kind` `bg`) that wait are labelled "background, attach to answer" (R8.2).
- **Idle:** `idle` otherwise, with `statusUpdatedAt` as the time it went idle; "your turn" beside it where the agent spoke last (R2.4).
- **Not running** and **Unknown**, as above.

**Why it waits (R8.4)** comes from the transcript, which records the pending call before the session waits on it: the last tool call with no result yet. A permission wait shows that call's tool and its description (never its command); a question shows the AskUserQuestion input's question and option labels. `waitingFor`, where Claude Code gives a value the module does not recognise, is shown as given.

**Delivery.** The module emits `live:changed` with the state of every session at most twice a second, so that a change reaches the window within R8.1's two seconds.

**The Sessions panel (R8.6)** (`renderer/src/sessions-panel.js`) replaces the list window; the list page remains only for a machine with no session. It is a panel of the session window, beside Desk, Trail, Memory, Discuss and Board in the header's toggles (D9), and shows:

- each session's title, folder, state badge and, when it waits, its reason and since when;
- three views (R8.3): Waiting first (all sessions, those waiting first), Recent first (by project, ordered by last activity) and Alphabetical (projects by name);
- a click on a session opens its window, or brings it forward.

At start the app opens a window on the most recently active session with the panel on. The Dock badge is `app.setBadgeCount` with the number of sessions waiting; on Ubuntu it shows where the `.deb`'s desktop file lets the dock count it (Q8's ruling).

**Tests** use synthetic session files and synthetic `claude agents` output, never the machine's own.

## Subagents and compaction (R9, R11)

**Subagents.** The session model (`transcript/session.js`) records each Agent call as a subagent: its type and task from the call, its id, model and (for a foreground one) duration, tokens and tool calls from the call's result, and for a background one the same figures and its report from the completion notice. The main process adds each one's effort from the last records of its own transcript, `<session>/subagents/agent-<id>.jsonl`, and reads that transcript whole when the person opens the row (`subagent:detail`), for its actions and its own subagents. The Subagents panel lists them newest first; a row opens to the actions, the nested subagents and the final report; "Show in Trail" and the action's "Subagent" button lead each to the other.

**Compaction.** `records.js` recognises the boundary record (`system`, subtype `compact_boundary`, with `compactMetadata.trigger`, `preTokens` and `postTokens`) and the summary record by `isCompactSummary`, never by its wording. The model places a compaction item in the Trail where it happened, carrying the summary; the Trail shows it as a marker that opens to the summary's first paragraph and then the whole.

## Background work and wake-ups (R10)

The watcher's hook (`setup/garnet-rewake.sh`), which Claude Code already runs at the end of every turn, keeps that turn's input whole as `<session>.work.json` in the app's folder: Claude Code gives it the session's running background work (`background_tasks`) and its scheduled jobs (`session_crons`). `src/main/work.js` reads it, showing each piece of work by its description, never its command, and works out each job's next run from its five-field schedule. Waiting shows the work the transcript shows at once, adds what only the report shows, lists the jobs and the session's own wake-ups (its ScheduleWakeup calls, from the transcript) with their next time and the first line of their prompt, opening to the whole, and says how old the report is, or that there is none yet. An installation from Set-up Info before this version has no such report until the hook is installed again.

## Board tools for the agent (R12)

`setup/garnet-board/` is a Claude Code extension (a mod) that Claude installs from Set-up Info. It registers three tools: `board_read` (the rendition), `board_change` (add, relabel and remove, as in a request) and `board_answer` (Discuss answers, a finished review, a confirmed hold). Each writes the same request file the agent can write by hand, tagged with a request id, and waits up to four seconds for `<session>.outcome.json`, which the app writes for every request: what it changed and any problems, that the change waits until the board is open, that the request was not valid JSON (the request is then removed), or what it did with the signals. The tool answers the agent in plain text, the only answer shape Claude Code accepts from such a tool (probed 2026-11-14). The extension finds the boards folder as the app does (`GARNET_SCOPING_BOARDS`, else `~/.garnet-scoping/boards`). The request file remains for sessions without the extension (R12.3).

## Questions on the board (R13)

A right-click on the board opens the app's own menu (Add question, Remove this exchange on any piece of one, and More… for the editor's own menu), caught before the editor's. Add question opens a balloon to type into, its arm already drawn to the point clicked; Enter places it. A balloon is a rounded rectangle with its text, and its arm is two locked line elements over its edge (a filled wedge that covers the border where the arm leaves, and the arm's two sides) plus a small dot at the tip, the one piece of the arm the person drags. `renderer/src/questions.js` holds the geometry; after every change the board recomputes each arm so that it leaves the side facing its tip, and the tip stays on what it points at (a fixed place on a shape, moving with it; the nearest edge of the answer a follow-up follows; or a point of the board). Each piece carries `customData.garnet` with its role and its exchange.

A question is kept in the board's state as a draft, with Editing ticked, until the person presses Review, which sends every draft at once; the watcher's Review signal says how many questions it holds. Each question records what its arm points at and a picture of the area round it (`<session>.q-<id>.png`, from the editor's own export). The agent answers with `answers` in a request, or the board tool; the window places each answer as a note in the agent's colour, joined to its question, and a right-click on the note asks a follow-up whose arm points at it. Remove this exchange, deleting a question or an answer, or the agent's `removeExchange` removes every piece of the exchange at once. The rendition lists the exchanges under "## Questions", and leaves their pieces out of the shapes.

## Notes from the agent and receipts (R14, R15)

**Notes.** The agent pins a one-line note with `notes` in a request or the board tool, naming its item as `plan:<step>`, `file:<path>`, `shape:<id>` or `last-message`; the board's state keeps it. The Desk shows an open note on its item, in the agent's colour, and lists every note at the head of the Discuss panel, where the person confirms it, corrects it with a line, or dismisses it. The watcher reports each answer as a signal; the agent never waits for it.

**Receipts.** The watcher already records the signals it has delivered (`<session>.watched`) and its own process (`<session>.watcher.pid`). The app reads both, whenever they change, and shows each request to discuss as Sent, Delivered (the watcher woke the session with it, labelled as not meaning read) and Answered, the Hold button's title likewise; and a warning under the header whenever no watcher is running for an idle session, with the number of signals waiting and how they will next be delivered. While the session is working, no watcher is expected (the watcher exits once it has woken the session), so the line under the header says only that signals reach the agent when its turn ends, in muted text, and receipts read Delivering… rather than Not delivered.

## Asides and Away (R16, R17)

**Asides.** "Ask aside…" on any row's menu keeps the question in the board's state. The garnet-board extension inside Claude Code polls the state every 1.5 s, answers each new aside with one tool-less completion over the session's own transcript (`$.model.fork`, low effort), and writes the answer to `<session>.asides.json`; the app, the state file's only writer, folds it in, and the row shows it under a label saying a copy with no tools answered, with "Ask the agent instead" to turn it into a Discuss mark. A fork started from a timer answered in under a second (probed 2026-11-14); it sees the session as of its last request.

**Away.** The header's Away button keeps `away` in the state (on, the time given for the return, when it began, when it ended). The watcher tells the agent when the person goes away (keep questions for their return, carry on with what does not need them, assume nothing) and when they come back (welcome them and take them through what is pending, one item at a time); the Sessions panel marks the session; on return, a line under the header counts what came while the person was away.

## Installing as a Claude Code plugin (P5)

`setup/garnet-scoping-plugin/` is the plugin: `.claude-plugin/plugin.json`, `hooks/hooks.json`, the three hook scripts, the board tools module (`hooks/register.ts`, formerly the garnet-board extension, its tools now named `mcp__garnet-scoping__board_*`) and `rules.md`, the text that was the `CLAUDE.md` section. `hooks.json` lists the module and the command hooks together: SessionStart on `startup|resume|clear|compact` runs `garnet-session-start.sh`, which prints `rules.md` into the session; SessionStart on `resume` and Stop run `garnet-rewake.sh` as `asyncRewake`, as before. The scripts find one another through `CLAUDE_PLUGIN_ROOT`, so no path under `~/.claude` is written into them.

At each start the app writes a local marketplace to `~/.garnet-scoping/claude-plugin/` (`src/main/plugin.js`): `.claude-plugin/marketplace.json` naming one plugin, and the plugin's folder, its `plugin.json` given the app's own version. Each file goes to a temporary name and is moved over the old one. Claude Code copies an installed plugin to its cache by version, so the copy the app rewrites is read only by `claude plugin install` and `claude plugin update`. Set-up Info gives the commands: `claude plugin marketplace add ~/.garnet-scoping/claude-plugin` and `claude plugin install garnet-scoping@garnet-scoping` once; `claude plugin marketplace update garnet-scoping` and `claude plugin update garnet-scoping@garnet-scoping` after an app update. It also gives text to paste into a session that has Claude remove the earlier installation.

Each session window reads, and never writes, `~/.claude/plugins/installed_plugins.json` (the plugin's version) and `~/.claude/settings.json` (whether `enabledPlugins` turns it off, and whether a hook still names `garnet-rewake.sh` or `garnet-session-start.sh` under `~/.claude/hooks`), and checks for `~/.claude/mods/garnet-board` and a "garnet-scoping signals" heading in `~/.claude/CLAUDE.md`. It says which is the case (not installed, disabled, another version, or an earlier installation left beside it, which would run a second watcher) with a button to open Set-up Info.

## The manual (R18, P14 to P16)

The mock-up the owner reviewed is [`manual-mockup.html`](manual-mockup.html): a session window with a **?** on each panel and **How do I…** in the Help menu, and the manual window beside it playing a lesson.

**Entry points.** Each panel's header carries a **?** at its right; it drops down the lessons whose script names that panel, each with Play, and a last line, "All lessons, How do I…". The Help menu's How do I… (⌘? on macOS, F1 on Ubuntu) opens the manual window with its search field focused; the search matches every word typed against each lesson's title and captions.

**The manual window.** One per app, opened beside the session window it was called from. Its top shows the lesson's number and title and "← All lessons"; below, a stage holding the demo session's window, drawn by the same renderer as a real session window; below that, the controls: Pause and Play, Back a step, Replay, Captions, Sound, and the step counter. A lesson marked macOS only, such as lesson 2, is not listed on Ubuntu.

**The demo's window.** The manual window is a session window opened on a fresh copy of the demo, in the app's own folder (`manual-demo` beside its settings), whose board, memory and work files are read and written there and never in `~/.garnet-scoping/boards`. Its Sessions panel lists the demo's four sessions alone (the CSV parser, and three others: one waiting on a question, one idle, one no longer running), so that no lesson opens a real session; another demo session's window opens on the same copy; its state is always Working, or Waiting for you while its own Hold is on, and it is never counted on the Dock. Replay and Back a step make a fresh copy and reopen the window where it was, which then does the earlier steps without pointer or voice, each given time to take effect.

**A lesson's script.** A JSON file per lesson in `manual/lessons/`, holding its number, title, group, the panels that list it, the platforms it plays on, and its steps. A step names the element it acts on by a `data-ui` attribute the interface carries for the purpose (`data-ui="hold"`, `data-ui="panel-plan"`), the action (point, click, type a given text, wait), and the caption, which is also what the voice says. The last step is the try: the pointer withdraws, the caption asks the person to act, and the manual waits for that action on the named element, with Skip the try beside it.

**Lessons outside the window.** Two lessons teach what lies in the app's other windows: 25 (Set-up Info) and 27 (Settings). A `window` step opens that window; a lesson cannot point inside it, nor have the person try it on the demo, since Settings would change the person's own setting. These two lessons therefore end without a try, a departure from R18.6 confined to them. For lesson 26, the demo's window always shows the notice that the install is stale.

**The agent's side.** A lesson that shows a reply (an aside answered, a note pinned, a request answered) has an `agent` step, which writes into the demo's copy what an agent would: a request to its board, or the answer to the last aside. Nothing is sent to a real agent.

**Playing.** The pointer is an overlay that moves to the named element's centre over about a second; a click is shown as a brief ring and then performed on the demo, so the demo's own code changes what it shows (Hold turns to Holding). Each step's audio plays as its caption appears; the next step starts when both the audio and a minimum time have passed. Back a step restores the demo to the state recorded before that step; Replay restores it to the start.

**The demo session** (P16) is a folder in `manual/demo/` holding a short transcript, a board and a state file, read by the same code that reads a real session. The manual window gives that code the demo folder in place of the boards folder, so a lesson's Hold or Review is written there and goes nowhere; the folder is copied afresh for each lesson, so one lesson's clicks never carry into the next.

**Voice-over** (P14). The audio is made when a lesson is written, not when it is played: `scripts/voice-lessons.mjs` has phonorheos speak each changed caption, and each lesson's closing line, in the voice bf_emma into a WAV file (`phonorheos say --to-file`), and macOS's `afconvert` compresses it to AAC at 32 kbit/s as `manual/audio/<lesson>-<step>.m4a` (`<lesson>-done.m4a` for the closing line), with the text's hash in `manual/audio/index.json`. The 166 files of the 28 lessons come to 3.9 MB (as WAV they would be about ten times that). The script therefore runs on a Mac; the app plays the files on every system with the renderer's own audio element, and never calls phonorheos. A step waits for its voice to end and for its caption's reading time, whichever is longer.

**Kept current** (R18.11). A test reads every lesson and fails when a `data-ui` name a step uses is no longer present in the renderer's source, when a lesson's panel no longer exists, or when a caption's hash differs from the one its audio was made from. The last means that a changed caption cannot ship with the old voice.

**What phonorheos provides.** phonorheos 0.10.0 renders speech to a file without playing it: `POST /render` returns the speech as WAV (24 kHz, mono, 16-bit) once complete, and `phonorheos say --to-file <path.wav>` writes it (phonorheos decision R1). It writes WAV only, since Opus would add a C library to its three signed builds; the compression to AAC is done here, by the script above.

## Resizing panels (R19)

`layout()` in `session.js` places a splitter element between each pair of visible neighbours each time the open panels change: between the Desk's sections in their order, and between the Desk and the board when both are shown. The stage sets each child's CSS `order` by the board's side, so the splitter between the Desk and the board sits between them on every side. A splitter's orientation follows its container's flex direction: the Desk is always a row, and the stage a column when the board is above or below.

Sizes are kept as flex weights: one per Desk panel (defaults 2.4 Sessions, 3 Desk, 5 Trail, 2.2 Memory, 2.2 Discuss, 3 Subagents, the shares used before splitters) and the board's share of the stage (default 0.5). A drag moves weight between the two neighbours only, clamped so that neither falls below 90 px, using pointer capture so that the board's canvas beneath does not take the pointer. A double-click restores the two neighbours' defaults. The weights are stored in `localStorage` under `garnet.sizes`, beside `garnet.panels`; the manual window keeps them in memory, as it does the panels. The board is told to measure itself again after each change.

## Spawned sessions (R20)

`src/main/spawned.js` reads the desktop app's session records, `local_*.json` two folders under `~/Library/Application Support/Claude/claude-code-sessions/`, on macOS only (elsewhere it returns nothing). From each it takes `sessionId`, `cliSessionId` and `spawnedFrom.sessionId`, and keeps them by file and modification time, so that a refresh reads only the records that changed. It returns, for each transcript id, the transcript id of the session that started it. `listSessions` adds that as `parent` to each session; a record it cannot parse, or one without those fields, adds nothing (R20.3).

The Sessions panel orders the top-level sessions as before (R8.3) and places each session's spawned sessions after it, in the same order, recursively, a session whose parent is not in the list being top-level. In the by-project views a spawned session follows its parent even when its own folder differs. Each spawned row is indented 18 px a level, with a 1 px line at its left in the line colour, and its second line reads "started by the session above · <ago>". A parent's row has a chevron (`data-ui: session-fold`) that folds its spawned sessions; the folded set is kept in `localStorage` under `garnet.sessions.folded`, and a folded parent's title is followed by "· N spawned". The filter matches spawned sessions on their own; a match keeps its parent's row in view, so the indentation keeps its meaning.

## Versions checked

The app carries the list of Claude Code versions its reader was checked against, and the Desk says when a session's version is newer than any of them (R6.2). The first version was checked against 2.1.170 to 2.1.299, and later against versions up to 2.1.325.
