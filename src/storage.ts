import {
  compareEventOrder, createAttempt, DAY_MS, defaultData, FSRS_PARAMETERS, LEGACY_SCHEDULER_VERSION, localDay,
  PARAMETER_SET_ID, progressFromEvents, scheduleAttempt, schedulerSnapshot, SCHEDULER_VERSION,
  type AppData, type AttemptEvent, type AttemptInput, type Settings, type StudySession,
  type WordProgress, type LegacyScheduleAnchors,
} from './engine'

export type { AppData, StudySession, Settings } from './engine'

const DATABASE_NAME = 'wrieng-learning'
const STORE_NAME = 'app'
const STATE_KEY = 'state'
const MIGRATION_BACKUP_KEY = 'pre-fsrs-v1-backup'
const RESTORE_SAFETY_KEY = 'before-migration-backup-restore'
const MAX_EVENTS = 50_000
export const MAX_BACKUP_BYTES = 100_000_000
const MAX_CLOCK_SKEW_MS = 5 * 60_000
let databasePromise: Promise<IDBDatabase> | undefined

function database(): Promise<IDBDatabase> {
  if (!globalThis.indexedDB) return Promise.reject(new Error('IndexedDB is unavailable. Enable browser storage to save your progress.'))
  databasePromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME)
    }
    request.onsuccess = () => {
      request.result.onversionchange = () => { request.result.close(); databasePromise = undefined }
      resolve(request.result)
    }
    request.onerror = () => { databasePromise = undefined; reject(request.error ?? new Error('Cannot open local storage.')) }
    request.onblocked = () => { databasePromise = undefined; reject(new Error('Close another WriEng tab to finish updating storage.')) }
  })
  return databasePromise
}

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
function identifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 200 && !['__proto__', 'constructor', 'prototype'].includes(value)
}
function timestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 8_640_000_000_000_000
}
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid backup: ${message}`)
}
function validateSettings(raw: unknown): Settings {
  assert(object(raw), 'missing settings.')
  assert(Number.isInteger(raw.dailyNewLimit) && Number(raw.dailyNewLimit) >= 0 && Number(raw.dailyNewLimit) <= 100, 'new-word limit must be 0–100.')
  assert(Array.isArray(raw.selectedDecks) && raw.selectedDecks.length <= 100 && raw.selectedDecks.every(identifier), 'invalid deck selection.')
  assert(typeof raw.timezone === 'string' && raw.timezone.length <= 100, 'invalid timezone.')
  try { localDay(0, raw.timezone) } catch { throw new Error('Invalid backup: unsupported timezone.') }
  assert(typeof raw.onboardingComplete === 'boolean' && typeof raw.soundEnabled === 'boolean' && typeof raw.reducedMotion === 'boolean', 'invalid preferences.')
  assert(typeof raw.speechRate === 'number' && Number.isFinite(raw.speechRate) && raw.speechRate >= 0.25 && raw.speechRate <= 2, 'invalid speech rate.')
  return {
    dailyNewLimit: Number(raw.dailyNewLimit), selectedDecks: [...raw.selectedDecks] as string[], timezone: raw.timezone,
    onboardingComplete: raw.onboardingComplete, soundEnabled: raw.soundEnabled, reducedMotion: raw.reducedMotion, speechRate: raw.speechRate,
  }
}

function validateEvent(raw: unknown): AttemptEvent {
  assert(object(raw), 'invalid attempt.')
  assert(identifier(raw.id) && identifier(raw.wordId) && identifier(raw.roundId) && identifier(raw.firstAttemptId), 'invalid attempt IDs.')
  assert(raw.sessionId === null || identifier(raw.sessionId), 'invalid session ID.')
  assert(raw.mode === 'typed' || raw.mode === 'handwriting', 'invalid attempt mode.')
  assert(raw.result === 'correct' || raw.result === 'incorrect' || raw.result === 'self-rated', 'invalid attempt result.')
  assert(raw.mode !== 'handwriting' || raw.result === 'self-rated', 'handwriting cannot claim an automatic result.')
  assert(raw.requestedRating === 'again' || raw.requestedRating === 'hard' || raw.requestedRating === 'good', 'invalid rating.')
  assert(typeof raw.hinted === 'boolean' && typeof raw.revealed === 'boolean' && typeof raw.retry === 'boolean', 'missing recall evidence.')
  assert(timestamp(raw.at) && timestamp(raw.startedAt) && raw.startedAt <= raw.at, 'invalid attempt times.')
  // Earlier schema-v1 backups only recorded assessment time. Preserve compatibility honestly.
  const submittedAt = raw.submittedAt === undefined ? raw.at : raw.submittedAt
  assert(timestamp(submittedAt) && submittedAt >= raw.startedAt && submittedAt <= raw.at, 'invalid submission time.')
  assert(typeof raw.timezone === 'string' && raw.timezone.length <= 100, 'invalid attempt timezone.')
  assert(raw.schedulerVersion === SCHEDULER_VERSION || raw.schedulerVersion === LEGACY_SCHEDULER_VERSION, 'unsupported scheduler version.')
  if (raw.schedulerVersion === SCHEDULER_VERSION) assert(raw.parameterSetId === PARAMETER_SET_ID, 'unsupported FSRS parameter set.')
  assert(raw.answer === null || (typeof raw.answer === 'string' && raw.answer.length <= 500), 'invalid original answer.')
  assert(typeof raw.hasInk === 'boolean' && (raw.mode === 'handwriting' || raw.hasInk === false), 'invalid ink evidence.')
  assert(raw.mode !== 'handwriting' || raw.answer === null, 'handwriting cannot claim recognized text.')
  const event = createAttempt({
    id: raw.id, wordId: raw.wordId, mode: raw.mode, result: raw.result, rating: raw.requestedRating,
    hinted: raw.hinted, revealed: raw.revealed, retry: raw.retry, sessionId: raw.sessionId ?? undefined,
    roundId: raw.roundId, firstAttemptId: raw.firstAttemptId, startedAt: raw.startedAt, at: raw.at, timezone: raw.timezone,
    submittedAt,
    answer: typeof raw.answer === 'string' ? raw.answer : undefined, hasInk: raw.hasInk,
  })
  // Preserve historical v1 aided-Hard events from the earliest v1 build; never relabel them as FSRS.
  const historicalHard = raw.schedulerVersion === LEGACY_SCHEDULER_VERSION && raw.result !== 'incorrect'
    && (raw.hinted || raw.revealed || raw.retry) && raw.effectiveRating === 'hard' && raw.requestedRating !== 'again'
  assert((raw.effectiveRating === event.effectiveRating || historicalHard) && raw.firstAttempt === event.firstAttempt && raw.firstAttemptId === event.firstAttemptId && raw.localDay === event.localDay, 'attempt evidence or effective rating was altered.')
  if (raw.schedulerVersion === LEGACY_SCHEDULER_VERSION) {
    const { parameterSetId: _parameterSetId, ...legacy } = event
    return { ...legacy, effectiveRating: raw.effectiveRating as AttemptEvent['effectiveRating'], schedulerVersion: LEGACY_SCHEDULER_VERSION }
  }
  return event
}

function validateSession(raw: unknown): StudySession | null {
  if (raw === null) return null
  assert(object(raw), 'invalid active session.')
  assert(identifier(raw.id) && Array.isArray(raw.queue) && raw.queue.length <= 10_000 && raw.queue.every(identifier), 'invalid session queue.')
  assert(Number.isInteger(raw.index) && Number(raw.index) >= 0 && Number(raw.index) <= raw.queue.length, 'invalid session position.')
  assert(['study', 'recall', 'feedback', 'done'].includes(String(raw.stage)), 'invalid session stage.')
  assert(raw.mode === 'typed' || raw.mode === 'handwriting', 'invalid session mode.')
  const latestSessionTime = Date.now() + MAX_CLOCK_SKEW_MS
  assert(timestamp(raw.startedAt) && raw.startedAt <= latestSessionTime, 'invalid session start.')
  for (const field of ['response', 'answer', 'draft']) {
    assert(raw[field] === undefined || (typeof raw[field] === 'string' && raw[field].length <= 500), `invalid session ${field}; expected at most 500 characters.`)
  }
  for (const field of ['hinted', 'revealed', 'retry', 'forgot', 'correct', 'hasInk']) {
    assert(raw[field] === undefined || typeof raw[field] === 'boolean', `invalid session ${field}; expected a boolean.`)
  }
  for (const field of ['presentedAt', 'submittedAt', 'completedAt']) {
    assert(raw[field] === undefined || (timestamp(raw[field]) && raw[field] >= raw.startedAt && raw[field] <= latestSessionTime), `invalid session ${field}.`)
  }
  for (const field of ['roundId', 'firstAttemptId']) {
    assert(raw[field] === undefined || identifier(raw[field]), `invalid session ${field}.`)
  }
  assert(raw.pendingResult === undefined || ['correct', 'incorrect', 'self-rated'].includes(String(raw.pendingResult)), 'invalid session pending recall result.')
  // Session extras are JSON only, bounded with the backup, and never interpreted as executable data.
  assert(JSON.stringify(raw).length <= 1_000_000, 'session is too large.')
  return JSON.parse(JSON.stringify(raw)) as StudySession
}

function validateScheduler(raw: unknown): void {
  assert(object(raw) && raw.version === SCHEDULER_VERSION && raw.algorithm === 'FSRS-6' && raw.packageVersion === '5.4.2' && raw.parameterSetId === PARAMETER_SET_ID, 'unsupported FSRS scheduler configuration.')
  const params = raw.parameters
  assert(object(params), 'missing FSRS parameters.')
  for (const key of ['request_retention', 'maximum_interval', 'enable_fuzz', 'enable_short_term', 'w', 'learning_steps', 'relearning_steps'] as const) {
    assert(JSON.stringify(params[key]) === JSON.stringify(FSRS_PARAMETERS[key]), `unsupported FSRS parameter ${key}.`)
  }
}

function validateAnchors(raw: unknown, events: Map<string, AttemptEvent>): LegacyScheduleAnchors {
  assert(object(raw) && Object.keys(raw).length <= MAX_EVENTS, 'invalid migration anchors.')
  const anchors: LegacyScheduleAnchors = {}
  for (const [id, value] of Object.entries(raw)) {
    assert(identifier(id) && object(value) && value.eventId === id && identifier(value.wordId), 'invalid migration anchor IDs.')
    const event = events.get(id)
    assert(event && event.schedulerVersion === LEGACY_SCHEDULER_VERSION && event.wordId === value.wordId, 'migration anchor has no matching v1 event.')
    assert(timestamp(value.dueAt) && value.dueAt >= event.at && value.dueAt <= event.at + 365 * DAY_MS, 'invalid migration anchor due time.')
    anchors[id] = { wordId: value.wordId, eventId: id, dueAt: value.dueAt }
  }
  return anchors
}

function legacyAnchors(raw: unknown, events: Map<string, AttemptEvent>): LegacyScheduleAnchors {
  const anchors: LegacyScheduleAnchors = {}
  if (!object(raw)) return anchors
  for (const [wordId, value] of Object.entries(raw)) {
    if (!object(value) || !identifier(value.lastEventId)) continue
    const event = events.get(value.lastEventId)
    if (event?.schedulerVersion !== LEGACY_SCHEDULER_VERSION || event.wordId !== wordId || value.wordId !== wordId || value.lastReviewedAt !== event.at) continue
    assert(timestamp(value.dueAt) && value.dueAt >= event.at && value.dueAt <= event.at + 365 * DAY_MS, 'invalid stored v1 due time.')
    anchors[event.id] = { wordId, eventId: event.id, dueAt: value.dueAt }
  }
  return anchors
}

/** V1 event evidence remains immutable; only the app envelope and derived FSRS state migrate. */
export function validateData(raw: unknown): AppData {
  assert(object(raw), 'expected a JSON object.')
  assert(raw.schemaVersion === 2 || raw.schemaVersion === 1 || raw.schemaVersion === 0 || raw.schemaVersion === undefined, 'unsupported schema version.')
  const legacy = raw.schemaVersion !== 1 && raw.schemaVersion !== 2
  if (raw.schemaVersion === 2) validateScheduler(raw.scheduler)
  const defaults = defaultData()
  const settings = validateSettings(legacy ? { ...defaults.settings, ...(object(raw.settings) ? raw.settings : {}) } : raw.settings)
  assert(Array.isArray(raw.events) && raw.events.length <= MAX_EVENTS, 'invalid attempt history or too many attempts.')
  const events = raw.events.map(validateEvent)
  const seen = new Map<string, AttemptEvent>()
  for (const event of events) {
    const prior = seen.get(event.id)
    assert(!prior || JSON.stringify(prior) === JSON.stringify(event), 'conflicting records share an event ID.')
    seen.set(event.id, event)
  }
  // Treat events as the source of truth; a hand-edited progress entry cannot manufacture mastery.
  const deduplicated = [...seen.values()].sort(compareEventOrder)
  const anchors = raw.schemaVersion === 2 ? validateAnchors(raw.legacyScheduleAnchors, seen) : legacyAnchors(raw.progress, seen)
  return {
    schemaVersion: 2, events: deduplicated, progress: progressFromEvents(deduplicated, anchors), settings,
    session: validateSession(raw.session ?? null),
    scheduler: schedulerSnapshot(), legacyScheduleAnchors: anchors,
  }
}

function readStored(raw: unknown): AppData {
  return raw === undefined ? defaultData() : validateData(raw)
}

function fitsBackupLimit(json: string): boolean {
  // A UTF-8 file can use more bytes than its JavaScript string length.
  return json.length <= MAX_BACKUP_BYTES && new TextEncoder().encode(json).byteLength <= MAX_BACKUP_BYTES
}

function serializeBackup(data: AppData): string {
  const json = JSON.stringify(data)
  assert(fitsBackupLimit(json), 'learning history exceeds the 100 MB backup limit; export before continuing.')
  return json
}

export async function loadData(): Promise<AppData> {
  return updateData(data => data)
}

async function updateData(update: (data: AppData) => AppData, legacyImport?: unknown): Promise<AppData> {
  const db = await database()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    const request = store.get(STATE_KEY)
    let updated: AppData
    let updateError: unknown
    request.onsuccess = () => {
      try {
        const raw: unknown = request.result
        updated = update(readStored(raw))
        // Every committed state must remain exportable and importable under the same limit.
        serializeBackup(updated)
        const backupSource = object(raw) && raw.schemaVersion !== 2 ? raw : legacyImport
        if (object(backupSource) && backupSource.schemaVersion !== 2) {
          const backup = store.get(MIGRATION_BACKUP_KEY)
          backup.onsuccess = () => {
            try {
              if (backup.result === undefined) store.put({ createdAt: Date.now(), sourceSchema: backupSource.schemaVersion === 1 ? 1 : 0, data: backupSource }, MIGRATION_BACKUP_KEY)
              store.put(updated, STATE_KEY)
            } catch (error) { updateError = error; transaction.abort() }
          }
        } else store.put(updated, STATE_KEY)
      } catch (error) { updateError = error; transaction.abort() }
    }
    transaction.oncomplete = () => resolve(updated)
    transaction.onerror = () => reject(updateError ?? transaction.error ?? new Error('Unable to save progress. Your previous progress is unchanged.'))
    transaction.onabort = () => reject(updateError ?? transaction.error ?? new Error('Saving was interrupted. Your previous progress is unchanged.'))
  })
}

function mergeData(existing: AppData, incoming: AppData): AppData {
  const events = new Map(existing.events.map(event => [event.id, event]))
  for (const event of incoming.events) {
    const prior = events.get(event.id)
    assert(!prior || JSON.stringify(prior) === JSON.stringify(event), 'an imported ID conflicts with an existing attempt; nothing was changed.')
    if (!prior) events.set(event.id, event)
  }
  assert(events.size <= MAX_EVENTS, 'merged history is too large.')
  const mergedEvents = [...events.values()].sort(compareEventOrder)
  const anchors = { ...existing.legacyScheduleAnchors }
  for (const [id, anchor] of Object.entries(incoming.legacyScheduleAnchors)) {
    // An old backup cannot unexpectedly bring an existing v1 appointment forward.
    if (!anchors[id] || anchor.dueAt > anchors[id].dueAt) anchors[id] = anchor
  }
  return { ...incoming, events: mergedEvents, legacyScheduleAnchors: anchors, progress: progressFromEvents(mergedEvents, anchors) }
}

/** Snapshot saves merge immutable evidence atomically, so a stale UI cannot erase a submitted attempt. */
export async function saveData(data: AppData): Promise<AppData> {
  const validated = validateData(data)
  return updateData(existing => mergeData(existing, validated))
}

/** One readwrite transaction records the immutable event AND its new due date together. */
export async function recordAttempt(input: AttemptInput): Promise<AppData> {
  const event = createAttempt(input)
  return updateData(existing => {
    if (existing.events.some(previous => previous.id === event.id)) return existing
    assert(existing.events.length < MAX_EVENTS, 'history is full; export a backup before continuing.')
    const events = [...existing.events, event].sort(compareEventOrder)
    // Normal app submissions are chronological, so only the affected card needs a model update.
    const previous = existing.progress[event.wordId]
    const progress = !previous || compareEventOrder(event, { at: previous.lastReviewedAt, id: previous.lastEventId }) > 0
      ? { ...existing.progress, [event.wordId]: scheduleAttempt(previous, event) }
      : progressFromEvents(events, existing.legacyScheduleAnchors)
    return { ...existing, events, progress }
  })
}

export async function exportData(): Promise<string> {
  return serializeBackup(await loadData())
}

/** Validate everything before opening the write transaction; errors never partially import. */
export async function importData(json: string): Promise<AppData> {
  assert(typeof json === 'string' && fitsBackupLimit(json), 'file exceeds the 100 MB limit.')
  let parsed: unknown
  try { parsed = JSON.parse(json) } catch { throw new Error('Invalid backup: this file is not valid JSON.') }
  const incoming = validateData(parsed)
  return updateData(existing => mergeData(existing, incoming), object(parsed) && parsed.schemaVersion !== 2 ? parsed : undefined)
}

export interface MigrationBackupInfo { available: boolean; createdAt: number | null; sourceSchema: 0 | 1 | null }
interface StoredBackup { createdAt: number; sourceSchema?: 0 | 1; data: unknown }

async function readBackup(key: string): Promise<StoredBackup | null> {
  const db = await database()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly')
    const request = transaction.objectStore(STORE_NAME).get(key)
    request.onsuccess = () => resolve(request.result ?? null)
    request.onerror = () => reject(request.error ?? new Error('Cannot read the migration backup.'))
  })
}

export async function getMigrationBackupInfo(): Promise<MigrationBackupInfo> {
  const backup = await readBackup(MIGRATION_BACKUP_KEY)
  return backup ? { available: true, createdAt: backup.createdAt, sourceSchema: backup.sourceSchema ?? 0 }
    : { available: false, createdAt: null, sourceSchema: null }
}

/** Exact pre-migration envelope, including its original schema and all original event fields. */
export async function exportMigrationBackup(): Promise<string | null> {
  const backup = await readBackup(MIGRATION_BACKUP_KEY)
  return backup ? JSON.stringify(backup.data) : null
}

/** Explicit destructive-to-current-progress operation. Never invoked automatically by migration. */
export async function restoreMigrationBackup(): Promise<AppData> {
  const db = await database()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    let restored: AppData
    let restoreError: unknown
    const current = store.get(STATE_KEY)
    current.onsuccess = () => {
      const backup = store.get(MIGRATION_BACKUP_KEY)
      backup.onsuccess = () => {
        try {
          assert(backup.result && object(backup.result.data), 'no pre-upgrade backup is available.')
          restored = validateData(backup.result.data)
          serializeBackup(restored)
          store.put({ createdAt: Date.now(), data: current.result ?? defaultData() }, RESTORE_SAFETY_KEY)
          store.put(restored, STATE_KEY)
        } catch (error) { restoreError = error; transaction.abort() }
      }
    }
    transaction.oncomplete = () => resolve(restored)
    transaction.onerror = () => reject(restoreError ?? transaction.error ?? new Error('Restoring the upgrade backup failed.'))
    transaction.onabort = () => reject(restoreError ?? transaction.error ?? new Error('Restoring the upgrade backup was interrupted.'))
  })
}

export async function exportRestoreSafetyBackup(): Promise<string | null> {
  const backup = await readBackup(RESTORE_SAFETY_KEY)
  return backup ? JSON.stringify(backup.data) : null
}

export async function resetData(): Promise<AppData> {
  return updateData(() => defaultData())
}

/** Release the handle for tests, database upgrades, and graceful app shutdown. */
export async function closeStorage(): Promise<void> {
  if (databasePromise) (await databasePromise).close()
  databasePromise = undefined
}

// Re-exporting the progress type keeps storage consumers independent of implementation details.
export type { WordProgress }
