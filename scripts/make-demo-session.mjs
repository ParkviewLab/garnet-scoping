// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Writes the manual's demo session (R18.5, P16) into manual/demo/: a short,
// invented transcript in which an agent writes a CSV parser, with the memory
// note, the file it sends the person, and the board it starts from. Nothing
// here is copied from a real session.
//
// Two placeholders are replaced when the manual copies the demo for a lesson:
// __DEMO__, the folder the copy is in (the session's working folder, and the
// home of its memory store), and the times, which are moved so that the last
// record is a minute old. Run: node scripts/make-demo-session.mjs

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const OUT = join(import.meta.dirname, '..', 'manual', 'demo')
export const DEMO_ID = '00000000-0000-4000-8000-00000000de30'
const CWD = '__DEMO__/csv-parser'
const NOTE = '__DEMO__/.claude/projects/demo/memory/csv-quirks.md'

let second = 0
const at = (step = 20) => new Date(Date.UTC(2026, 0, 1, 9, 0, (second += step))).toISOString()
const base = () => ({ sessionId: DEMO_ID, cwd: CWD, gitBranch: 'feature-parser', version: '2.1.325', entrypoint: 'claude-desktop', timestamp: at() })
const human = (text) => ({ ...base(), type: 'user', origin: { kind: 'human' }, message: { role: 'user', content: text } })
const assistant = (parts) => ({ ...base(), type: 'assistant', message: { model: 'claude-opus-5-5', content: parts }, effort: 'medium' })
const say = (t) => ({ type: 'text', text: t })
const tool = (id, name, input) => ({ type: 'tool_use', id, name, input })
const result = (id, content, toolUseResult = null) => ({
  ...base(),
  type: 'user',
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, is_error: false }] },
  ...(toolUseResult ? { toolUseResult } : {}),
})
const notice = (taskId, summary, report, usage) => ({
  ...base(),
  type: 'user',
  origin: { kind: 'task-notification' },
  message: {
    role: 'user',
    content: `<task-notification>\n<task-id>${taskId}</task-id>\n<status>completed</status>\n<summary>${summary}</summary>\n<result>${report}</result>\n<usage>subagent_tokens: ${usage.tokens}\ntool_uses: ${usage.tools}\nduration_ms: ${usage.ms}</usage>\n</task-notification>`,
  },
})

const PLAN = ['Read the existing reader', 'Write the parser', 'Write its tests', 'Run the tests']
const records = [
  { type: 'custom-title', customTitle: 'Demo: a CSV parser', sessionId: DEMO_ID },
  human('Add a CSV parser to the project, with tests. Quoted fields can hold commas and line breaks.'),
  assistant([say('I will read what the project has, then write the parser and its tests.'), tool('t1', 'mcp__ccd_turn__update_plan', { items: PLAN.map((content, i) => ({ content, status: i ? 'pending' : 'in_progress' })) })]),
  result('t1', 'Plan shown.'),
  assistant([tool('t2', 'Read', { file_path: `${CWD}/src/reader.js` })]),
  result('t2', 'export function readLines(text) { return text.split(/\\r?\\n/) }'),
  assistant([tool('t3', 'Read', { file_path: NOTE })]),
  result('t3', 'Quoted fields may hold the delimiter and line breaks; a doubled quote is a literal quote.'),
  assistant([
    tool('t4', 'Agent', { description: 'Survey CSV edge cases', subagent_type: 'Explore', prompt: 'List the edge cases a CSV parser must handle, with one example each.', run_in_background: true, model: 'sonnet' }),
    tool('t5', 'mcp__ccd_turn__update_plan', { advance: true }),
  ]),
  result('t4', 'Async agent launched.', { isAsync: true, agentId: 'a-demo-1', status: 'async_launched' }),
  result('t5', 'Plan updated.'),
  assistant([tool('t6', 'Write', { file_path: `${CWD}/src/parse.js`, content: '// the parser' })]),
  result('t6', 'File created.'),
  notice('a-demo-1', 'Survey CSV edge cases finished', 'Eight cases: empty fields, quoted delimiters, quoted line breaks, doubled quotes, a final line without a newline, a byte-order mark, trailing spaces, and rows of unequal length.', { tokens: 18240, tools: 9, ms: 41000 }),
  assistant([tool('t7', 'mcp__ccd_turn__update_plan', { advance: true }), tool('t8', 'Write', { file_path: `${CWD}/tests/parse.test.js`, content: '// eight cases' })]),
  result('t7', 'Plan updated.'),
  result('t8', 'File created.'),
  assistant([tool('t9', 'SendUserFile', { files: [`${CWD}/samples/edge-cases.csv`], caption: 'The eight edge cases the tests cover, as one file.', status: 'normal' })]),
  result('t9', 'Sent.'),
  assistant([tool('t10', 'mcp__ccd_turn__wrap_up', { recap: 'The parser and its eight tests are written; the tests have not run yet.', ask: 'Shall I run the tests now?', actions: [{ label: 'Run them' }, { label: 'Not yet' }] })]),
  result('t10', 'Shown in the next-step box.'),
  assistant([say('The parser handles quoted commas and line breaks, and the tests cover the eight edge cases the survey found. Shall I run them?')]),
  human('Yes, run them, and check back in ten minutes on the slow fixtures.'),
  { ...base(), type: 'system', subtype: 'compact_boundary', compactMetadata: { trigger: 'auto', preTokens: 180000, postTokens: 9000 } },
  { ...base(), type: 'user', isCompactSummary: true, message: { role: 'user', content: 'Summary: a CSV parser and eight tests were written for the project; the person asked for the tests to be run and a check in ten minutes on the slow fixtures.' } },
  assistant([tool('t11', 'mcp__ccd_turn__update_plan', { start: 4 }), tool('t12', 'Bash', { command: 'npm test -- parse', description: 'Run the parser tests', run_in_background: true })]),
  result('t11', 'Plan updated.'),
  result('t12', 'Command running in background with ID: b-demo-2.', { backgroundTaskId: 'b-demo-2' }),
  assistant([tool('t13', 'ScheduleWakeup', { delaySeconds: 600, reason: 'check the slow fixtures', prompt: 'Check the slow fixtures' }), tool('t14', 'Bash', { command: 'npm run lint', description: 'Check the code style' })]),
  result('t13', 'Scheduled.'),
]

const memory = `---
name: csv-quirks
description: How this project's CSV files are quoted
metadata:
  type: project
---

Quoted fields may hold the delimiter and line breaks; a doubled quote inside a quoted field is a literal quote. The files come from a spreadsheet export and may begin with a byte-order mark.
`

const sample = 'case,example\nempty field,"a,,c"\nquoted comma,"""a,b"""\nquoted line break,"line one\nline two"\ndoubled quote,"say ""hi"""\n'

// The board the demo starts from, as a request the app applies when the copy's
// board first opens: the shapes a lesson on reading the board points at.
const board = {
  add: [
    { id: 'reader', kind: 'rectangle', text: 'reader.js (lines)', x: 0, y: 0 },
    { id: 'parser', kind: 'rectangle', text: 'parse.js (fields)', x: 260, y: 0 },
    { id: 'tests', kind: 'ellipse', text: 'eight tests', x: 260, y: 180 },
    { kind: 'arrow', from: 'reader', to: 'parser', text: 'lines' },
    { kind: 'arrow', from: 'tests', to: 'parser' },
  ],
}

mkdirSync(join(OUT, 'memory'), { recursive: true })
mkdirSync(join(OUT, 'boards'), { recursive: true })
mkdirSync(join(OUT, 'csv-parser', 'samples'), { recursive: true })
writeFileSync(join(OUT, 'session.jsonl'), records.map((r) => JSON.stringify(r)).join('\n') + '\n')
writeFileSync(join(OUT, 'memory', 'csv-quirks.md'), memory)
writeFileSync(join(OUT, 'csv-parser', 'samples', 'edge-cases.csv'), sample)
writeFileSync(join(OUT, 'boards', `${DEMO_ID}.request.json`), JSON.stringify(board, null, 2) + '\n')
console.log(`wrote ${records.length} records and the demo's files to ${OUT}`)
