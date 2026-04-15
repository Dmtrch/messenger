/**
 * Client-side structured logger.
 *
 * - Writes to console with level prefix.
 * - Stores last MAX_ENTRIES entries in IndexedDB (key: "error_log").
 * - Flushes accumulated entries to POST /api/client-errors every 30 s
 *   or when the batch reaches FLUSH_THRESHOLD.
 */

import { get as idbGet, set as idbSet } from 'idb-keyval'
import { getServerUrl } from '@/config/serverConfig'
import { useAuthStore } from '@/store/authStore'

const IDB_KEY = 'error_log'
const MAX_ENTRIES = 200
const FLUSH_THRESHOLD = 10
const FLUSH_INTERVAL_MS = 30_000

export type LogLevel = 'error' | 'warn' | 'info'

export interface LogEntry {
  timestamp: string
  level: LogLevel
  message: string
  userId: string | null
  route: string
  details?: unknown
}

// Pending entries not yet flushed to server.
const pending: LogEntry[] = []
let flushTimer: ReturnType<typeof setInterval> | null = null

function currentUserId(): string | null {
  try {
    return useAuthStore.getState().currentUser?.id ?? null
  } catch {
    return null
  }
}

function currentRoute(): string {
  return window.location.pathname
}

async function appendToIdb(entry: LogEntry): Promise<void> {
  try {
    const stored: LogEntry[] = (await idbGet(IDB_KEY)) ?? []
    stored.push(entry)
    if (stored.length > MAX_ENTRIES) stored.splice(0, stored.length - MAX_ENTRIES)
    await idbSet(IDB_KEY, stored)
  } catch {
    // IndexedDB might not be available (private browsing, etc.) — ignore.
  }
}

async function flush(): Promise<void> {
  if (pending.length === 0) return
  const batch = pending.splice(0)
  const serverUrl = getServerUrl()
  if (!serverUrl) return
  try {
    await fetch(`${serverUrl}/api/client-errors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries: batch }),
    })
  } catch {
    // Network unavailable — entries are still in IndexedDB.
  }
}

function record(level: LogLevel, message: string, details?: unknown): void {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    userId: currentUserId(),
    route: currentRoute(),
    ...(details !== undefined ? { details } : {}),
  }

  // Console output.
  if (level === 'error') console.error(`[logger]`, message, details ?? '')
  else if (level === 'warn') console.warn(`[logger]`, message, details ?? '')
  else console.info(`[logger]`, message, details ?? '')

  void appendToIdb(entry)

  pending.push(entry)
  if (pending.length >= FLUSH_THRESHOLD) void flush()
}

/** Start the periodic flush timer (call once at app startup). */
export function initLogger(): void {
  if (flushTimer !== null) return
  flushTimer = setInterval(() => void flush(), FLUSH_INTERVAL_MS)
}

export const logger = {
  error(message: string, details?: unknown) { record('error', message, details) },
  warn(message: string, details?: unknown)  { record('warn',  message, details) },
  info(message: string, details?: unknown)  { record('info',  message, details) },
}
