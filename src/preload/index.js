// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>
// SPDX-License-Identifier: AGPL-3.0-or-later
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('garnet', {
  listSessions: () => ipcRenderer.invoke('sessions:list'),
  openSession: (info) => ipcRenderer.invoke('sessions:open', info),
  onSessionsChanged: (fn) => ipcRenderer.on('sessions:changed', () => fn()),
  live: {
    get: () => ipcRenderer.invoke('live:get'),
    onChanged: (fn) => ipcRenderer.on('live:changed', (_e, l) => fn(l)),
  },
  onShowPanel: (fn) => ipcRenderer.on('panel:show', (_e, p) => fn(p)),
  view: () => ipcRenderer.invoke('session:view'),
  detail: (actionId) => ipcRenderer.invoke('session:detail', actionId),
  subagent: (agentId) => ipcRenderer.invoke('subagent:detail', agentId),
  onChanged: (fn) => ipcRenderer.on('session:changed', () => fn()),
  listMemory: () => ipcRenderer.invoke('memory:list'),
  readMemory: (path) => ipcRenderer.invoke('memory:read', path),
  showInFinder: (path) => ipcRenderer.invoke('finder:show', path),
  // The words for the system's file manager: the Finder on macOS.
  fileManager: process.platform === 'darwin' ? 'the Finder' : 'the file manager',
  openFile: (path) => ipcRenderer.invoke('file:open', path),
  readFile: (path) => ipcRenderer.invoke('file:read', path),
  discuss: (op) => ipcRenderer.invoke('session:discuss', op),
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (s) => ipcRenderer.invoke('settings:set', s),
    onChanged: (fn) => ipcRenderer.on('settings:changed', (_e, s) => fn(s)),
  },
  board: {
    open: () => ipcRenderer.invoke('board:open'),
    save: (scene) => ipcRenderer.invoke('board:save', scene),
    ready: () => ipcRenderer.invoke('board:ready'),
    outcome: (o) => ipcRenderer.invoke('board:outcome', o),
    picture: (qid, bytes) => ipcRenderer.invoke('board:picture', qid, bytes),
    onRequest: (fn) => ipcRenderer.on('board:request', (_e, r) => fn(r)),
    onExternal: (fn) => ipcRenderer.on('board:external', (_e, els) => fn(els)),
    onPending: (fn) => ipcRenderer.on('board:pending', () => fn()),
    setState: (next) => ipcRenderer.invoke('board:set-state', next),
    onState: (fn) => ipcRenderer.on('board:state', (_e, s) => fn(s)),
  },
})
