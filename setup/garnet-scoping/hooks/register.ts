// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// garnet-scoping's board tools (R12): the hooks module of the garnet-scoping
// plugin (P5), which Claude Code loads, so that
// the agent reads and changes the board, and answers the person's signals,
// by calling tools, each answering at once with what became of the call.
// The tools write the same request file the agent can write by hand (R7.4);
// garnet-scoping applies it and writes the outcome beside it.

import type { Register } from 'claude-code'

const WAIT_MS = 4000
const ASIDE_MS = 1500
const asked = new Set() // asides this session has already sent to a copy
// The boards folder, as garnet-scoping keeps it: GARNET_SCOPING_BOARDS, or
// ~/.garnet-scoping/boards.
let base = ''

function describe(o: any) {
  if (!o) return 'Sent. garnet-scoping has not answered within four seconds: it may not be running. The request stays on disk and is applied when the app reads it.'
  if (o.error) return `Refused: ${o.error}`
  if (o.queued) return `Queued: ${o.note}`
  const parts = []
  if (o.added) parts.push(`added ${o.added}`)
  if (o.relabelled) parts.push(`relabelled ${o.relabelled}`)
  if (o.removed) parts.push(`removed ${o.removed}`)
  if (o.reviewed) parts.push('marked the review done')
  if (o.answered) parts.push(`placed ${o.answered} answer${o.answered === 1 ? '' : 's'} on the board`)
  if (o.pinned) parts.push(`pinned ${o.pinned} note${o.pinned === 1 ? '' : 's'}`)
  if (o.notesRefused) parts.push(`refused ${o.notesRefused} note${o.notesRefused === 1 ? '' : 's'} (unknown item: use plan:, file:, shape: or last-message)`)
  if (o.discussed) parts.push(`recorded ${o.discussed} Discuss answer${o.discussed === 1 ? '' : 's'}`)
  if (o.holding) parts.push('confirmed the hold')
  if (o.holdIgnored) parts.push('ignored "holding": no hold was requested')
  const did = parts.length ? `Done: ${parts.join(', ')}.` : 'Nothing changed.'
  return o.problems?.length ? `${did} Problems: ${o.problems.join('; ')}.` : did
}

async function send($: any, base: string, id: string, request: Record<string, unknown>) {
  const requestId = `r${Date.now().toString(36)}`
  await $.fs.write(`${base}/${id}.request.json`, JSON.stringify({ ...request, requestId }))
  for (let waited = 0; waited < WAIT_MS; waited += 200) {
    await $.clock.sleep(200)
    try {
      const o = JSON.parse(String(await $.fs.read(`${base}/${id}.outcome.json`)))
      if (o.requestId === requestId) return describe(o)
    } catch {}
  }
  return describe(null)
}

// Answers the person's asides (R16): each one by a single completion over
// this session's own transcript, with no tools, so that the agent itself is
// not interrupted; the answer goes to <session>.asides.json for the app.
async function answerAsides($: any) {
  if (!base) return
  const id = await $.session.id()
  let state: any
  try {
    state = JSON.parse(String(await $.fs.read(`${base}/${id}.state.json`)))
  } catch {
    return
  }
  const waiting = (state.asides ?? []).filter((a: any) => !a.answeredAt && !asked.has(a.id))
  for (const a of waiting) {
    asked.add(a.id)
    const prompt = `An aside from the person, who is watching your work in garnet-scoping. They ask about this item of your work: "${a.text}". Their question: "${a.question}". Answer in at most four plain sentences, from what you have done so far in this session. You cannot act or check anything now; say so if the answer needs checking.`
    let reply: any
    try {
      reply = await $.model.fork({ prompt, effort: 'low' })
    } catch (err) {
      reply = { isAnswered: false, reason: String(err) }
    }
    let answers: any = {}
    try {
      answers = JSON.parse(String(await $.fs.read(`${base}/${id}.asides.json`)))
    } catch {}
    answers[a.id] = reply?.isAnswered ? { answer: String(reply.text) } : { error: `No answer: ${reply?.reason ?? 'unknown'}` }
    await $.fs.write(`${base}/${id}.asides.json`, JSON.stringify(answers))
  }
}

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    const r = await $.process.run(['/bin/sh', '-c', 'printf %s "${GARNET_SCOPING_BOARDS:-$HOME/.garnet-scoping/boards}"']).catch(() => null)
    base = String(r?.stdout ?? '')
    $.clock.every(ASIDE_MS, () => answerAsides($))
    await $.tool.register({ name: 'board_read', description: "Reads this session's garnet-scoping board as text: every shape with its id, kind, text and position, the connections, and the person's signals (review, Discuss, hold).", inputSchema: { type: 'object' }, isDeferred: false })
    await $.tool.register({
      name: 'board_change',
      description: 'Changes the board: add shapes, text, images and connections; relabel or remove shapes by id. Answers with what changed, why something was refused, or that the change waits until the board is open.',
      inputSchema: {
        type: 'object',
        properties: {
          add: { type: 'array', description: 'Items: { id?, kind: rectangle|ellipse|diamond|text|image|arrow|line, text?, x?, y?, path? (image), width?, from?, to? (arrow, line) }', items: { type: 'object' } },
          relabel: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, text: { type: 'string' } } } },
          remove: { type: 'array', items: { type: 'string' } },
          removeExchange: { type: 'array', description: 'Exchange ids (x…) of settled questions to remove from the board, with every balloon, answer and link in them; say in the conversation which and why.', items: { type: 'string' } },
        },
      },
      isDeferred: false,
    })
    await $.tool.register({
      name: 'board_answer',
      description: "Answers the person's signals: answers (to questions on the board), discussed (a one-line answer to each Discuss mark by its id), reviewed (the board has been read), holding (stopped at a requested hold).",
      inputSchema: {
        type: 'object',
        properties: {
          discussed: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, answer: { type: 'string' } } } },
          reviewed: { type: 'boolean' },
          holding: { type: 'boolean' },
          notes: { type: 'array', description: 'One-line notes to pin to an item instead of stopping to ask: { on: "plan:<step text>" | "file:<path>" | "shape:<id>" | "last-message", text: "Assumed: …" }. Carry on without waiting; the answer comes as a signal.', items: { type: 'object', properties: { on: { type: 'string' }, text: { type: 'string' } } } },
          answers: { type: 'array', description: 'Answers to questions asked on the board, by question id (q…): a few lines each, placed as a note joined to the question.', items: { type: 'object', properties: { id: { type: 'string' }, text: { type: 'string' } } } },
        },
      },
      isDeferred: false,
    })
    return next(e)
  })
  on('tool.call', { tool: 'mcp__garnet-scoping__board_read' }, async ($) => {
    const id = await $.session.id()
    try {
      return { result: String(await $.fs.read(`${base}/${id}.board.md`)) }
    } catch {
      return { result: 'This session has no board yet: open its window in garnet-scoping.' }
    }
  })
  on('tool.call', { tool: 'mcp__garnet-scoping__board_change' }, async ($, e: any) => {
    const { add, relabel, remove, removeExchange } = e
    return { result: await send($, base, await $.session.id(), { ...(add ? { add } : {}), ...(relabel ? { relabel } : {}), ...(remove ? { remove } : {}), ...(removeExchange ? { removeExchange } : {}) }) }
  })
  on('tool.call', { tool: 'mcp__garnet-scoping__board_answer' }, async ($, e: any) => {
    const { discussed, reviewed, holding, answers, notes } = e
    return { result: await send($, base, await $.session.id(), { ...(discussed ? { discussed } : {}), ...(reviewed ? { reviewed: true } : {}), ...(holding ? { holding: true } : {}), ...(answers ? { answers } : {}), ...(notes ? { notes } : {}) }) }
  })
}
