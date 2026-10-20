import 'fake-indexeddb/auto'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAttempt, defaultData, DAY_MS, LEGACY_SCHEDULER_VERSION, PARAMETER_SET_ID, previewIntervals, progressFromEvents, SCHEDULER_VERSION, type AttemptInput } from './engine'
import { closeStorage, exportData, exportMigrationBackup, exportRestoreSafetyBackup, getMigrationBackupInfo, importData, loadData, MAX_BACKUP_BYTES, recordAttempt, resetData, restoreMigrationBackup, saveData } from './storage'
import v1Fixture from './fixtures/v1-progress.json'

const NOW = Date.UTC(2026, 9, 17, 12)
const input = (extra: Partial<AttemptInput> = {}): AttemptInput => ({
  id: 'attempt-1', wordId: 'sense-1', mode: 'typed', rating: 'good', result: 'correct', at: NOW, timezone: 'UTC', answer: 'feasible', ...extra,
})

beforeEach(async () => {
  await closeStorage()
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('wrieng-learning')
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
  await resetData()
})
afterAll(async () => { await closeStorage() })

async function rawKey(key: string, value?: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('wrieng-learning', 1)
    request.onsuccess = () => {
      const db = request.result
      const transaction = db.transaction('app', value === undefined ? 'readonly' : 'readwrite')
      const result = value === undefined ? transaction.objectStore('app').get(key) : transaction.objectStore('app').put(value, key)
      let found: unknown
      result.onsuccess = () => { found = result.result }
      transaction.oncomplete = () => { db.close(); resolve(found) }
      transaction.onerror = () => { db.close(); reject(transaction.error) }
    }
    request.onerror = () => reject(request.error)
  })
}

describe('IndexedDB learning persistence', () => {
  it('starts fresh users with daily vocabulary and preserves an existing all-library preference', async () => {
    const fresh = await loadData()
    expect(fresh.settings.selectedDecks).toEqual(['daily'])
    await saveData({ ...fresh, settings: { ...fresh.settings, selectedDecks: [] } })
    await closeStorage()
    expect((await loadData()).settings.selectedDecks).toEqual([])
  })

  it('persists an event and schedule together and survives closing and reopening', async () => {
    const recorded = await recordAttempt(input())
    expect(recorded.events).toHaveLength(1)
    expect(recorded.progress['sense-1'].dueAt).toBe(NOW + 2 * DAY_MS)
    await closeStorage()
    const reopened = await loadData()
    expect(reopened).toEqual(recorded)
    expect(reopened.events[0].answer).toBe('feasible')
  })

  it('is idempotent for a repeated event ID', async () => {
    const first = await recordAttempt(input())
    const duplicate = await recordAttempt(input({ at: NOW + DAY_MS, rating: 'again', result: 'incorrect', answer: 'changed' }))
    expect(duplicate).toEqual(first)
    expect((await loadData()).events).toHaveLength(1)
  })

  it('serializes concurrent submissions without losing either event', async () => {
    await Promise.all([
      recordAttempt(input({ id: 'event-a', wordId: 'sense-a' })),
      recordAttempt(input({ id: 'event-b', wordId: 'sense-b' })),
    ])
    const data = await loadData()
    expect(data.events).toHaveLength(2)
    expect(Object.keys(data.progress)).toHaveLength(2)
  })

  it('does not lose a recorded attempt when settings are saved from an older snapshot', async () => {
    const stale = await loadData()
    await recordAttempt(input())
    stale.settings.dailyNewLimit = 5
    const saved = await saveData(stale)
    expect(saved.events).toHaveLength(1)
    expect(saved.settings.dailyNewLimit).toBe(5)
  })

  it('surfaces a quota failure and preserves the previous committed state', async () => {
    await recordAttempt(input())
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => {
      throw new DOMException('Local storage is full.', 'QuotaExceededError')
    })
    await expect(recordAttempt(input({ id: 'not-saved', wordId: 'sense-2' }))).rejects.toThrow('full')
    put.mockRestore()
    const data = await loadData()
    expect(data.events).toHaveLength(1)
    expect(data.progress['sense-2']).toBeUndefined()
  })

  it('restores a feedback session with the original answer pending self-assessment', async () => {
    const data = defaultData()
    data.settings.onboardingComplete = true
    data.session = {
      id: 'session-1', queue: ['sense-1'], index: 0, stage: 'feedback', mode: 'typed', startedAt: NOW,
      answer: 'original answer', revealed: false, pendingResult: 'incorrect',
    }
    await saveData(data)
    await closeStorage()
    expect((await loadData()).session).toEqual(data.session)
    expect((await loadData()).events).toHaveLength(0)
  })

  it.each([
    ['response', { text: 'not a string' }], ['answer', 'x'.repeat(501)], ['draft', 123],
    ['hinted', 'true'], ['revealed', 1], ['retry', null], ['forgot', {}], ['correct', 'yes'], ['hasInk', []],
    ['presentedAt', NOW - 1], ['submittedAt', -1], ['completedAt', 'tomorrow'],
    ['presentedAt', Date.now() + 10 * 60_000], ['firstAttemptId', {}], ['pendingResult', 'perfect'],
  ])('rejects invalid known session field %s without replacing existing evidence', async (field, value) => {
    await recordAttempt(input())
    const backup = defaultData()
    backup.session = {
      id: 'session-1', queue: ['sense-1'], index: 0, stage: 'feedback', mode: 'typed', startedAt: NOW,
      [field]: value,
    }
    await expect(importData(JSON.stringify(backup))).rejects.toThrow('session')
    const stored = await loadData()
    expect(stored.events).toHaveLength(1)
    expect(stored.session).toBeNull()
  })

  it('accepts bounded draft evidence and valid session times without trusting correctness as mastery', async () => {
    const backup = defaultData()
    backup.session = {
      id: 'session-1', queue: ['sense-1'], index: 0, stage: 'feedback', mode: 'typed', startedAt: NOW,
      response: 'x'.repeat(500), hinted: true, revealed: false, retry: false, forgot: false, correct: true, hasInk: false,
      presentedAt: NOW, submittedAt: NOW + 100, completedAt: NOW + 200, firstAttemptId: 'first', pendingResult: 'correct',
    }
    const imported = await importData(JSON.stringify(backup))
    expect(imported.session).toEqual(backup.session)
    expect(imported.events).toHaveLength(0)
    expect(imported.progress).toEqual({})
  })

  it('round-trips a backup and deduplicates repeated imports', async () => {
    await recordAttempt(input())
    const json = await exportData()
    expect(json).not.toContain('\n')
    await resetData()
    await importData(json)
    const twice = await importData(json)
    expect(twice.events).toHaveLength(1)
    expect(twice.progress['sense-1'].lastReviewedAt).toBe(NOW)
  })

  it('round-trips the separate original submission and assessment timestamps', async () => {
    await recordAttempt(input({ startedAt: NOW - 60_000, submittedAt: NOW - 30_000 }))
    const json = await exportData()
    await resetData()
    const imported = await importData(json)
    expect(imported.events[0]).toMatchObject({ startedAt: NOW - 60_000, submittedAt: NOW - 30_000, at: NOW })
  })

  it('migrates old schema-v1 missing submission timestamps to the recorded assessment time', async () => {
    const legacy = JSON.parse(JSON.stringify(v1Fixture))
    for (const event of legacy.events) delete event.submittedAt
    const migrated = await importData(JSON.stringify(legacy))
    expect(migrated.events).toHaveLength(2)
    for (const event of migrated.events) expect(event.submittedAt).toBe(event.at)
    expect(JSON.parse((await exportMigrationBackup())!)).toEqual(legacy)
    expect((await importData(JSON.stringify(legacy))).events).toHaveLength(2)
  })

  it('rejects an impossible imported submission timestamp without changing stored evidence', async () => {
    await recordAttempt(input())
    const invalid = JSON.parse(await exportData())
    invalid.events[0].submittedAt = NOW + 1
    await expect(importData(JSON.stringify(invalid))).rejects.toThrow('submission time')
    expect((await loadData()).events[0].submittedAt).toBe(NOW)
  })

  it('accepts a backup larger than the previous 15 MB limit and keeps compact export importable', async () => {
    const json = `${' '.repeat(15_000_001)}${JSON.stringify(defaultData())}`
    await importData(json)
    const compact = await exportData()
    expect(new TextEncoder().encode(compact).byteLength).toBeLessThan(MAX_BACKUP_BYTES)
    await expect(importData(compact)).resolves.toMatchObject({ schemaVersion: 2 })
  })

  it('rejects files above the shared 100 MB limit before parsing or changing local data', async () => {
    await recordAttempt(input())
    await expect(importData(' '.repeat(MAX_BACKUP_BYTES + 1))).rejects.toThrow('100 MB')
    expect((await loadData()).events).toHaveLength(1)
  })

  it('measures the 100 MB boundary in UTF-8 bytes rather than JavaScript characters', async () => {
    const oversizedUtf8 = `"${'\u4f60'.repeat(Math.floor(MAX_BACKUP_BYTES / 3) + 1)}"`
    expect(oversizedUtf8.length).toBeLessThan(MAX_BACKUP_BYTES)
    await expect(importData(oversizedUtf8)).rejects.toThrow('100 MB')
    expect((await loadData()).events).toHaveLength(0)
  })

  it('rejects more than 50,000 incoming events before inspecting their bodies', async () => {
    const backup = { ...defaultData(), events: Array(50_001).fill(null) }
    await expect(importData(JSON.stringify(backup))).rejects.toThrow('too many attempts')
    expect((await loadData()).events).toHaveLength(0)
  })

  it('rejects a merge above 50,000 unique events atomically', async () => {
    const backup = defaultData()
    const base = createAttempt(input())
    backup.events = Array.from({ length: 50_000 }, (_, index) => ({
      ...base, id: `bulk-${String(index).padStart(5, '0')}`, firstAttemptId: `bulk-${String(index).padStart(5, '0')}`,
    }))
    await saveData(backup)
    const incoming = { ...defaultData(), events: [createAttempt(input({ id: 'one-too-many' }))] }
    await expect(importData(JSON.stringify(incoming))).rejects.toThrow('merged history is too large')
    expect((await loadData()).events).toHaveLength(50_000)
  }, 30_000)

  it('merges older history while retaining the schedule from the newest event', async () => {
    const older = defaultData()
    older.events = [createAttempt(input())]
    await recordAttempt(input({ id: 'newer', at: NOW + DAY_MS * 3 }))
    const imported = await importData(JSON.stringify(older))
    expect(imported.events).toHaveLength(2)
    expect(imported.progress['sense-1'].lastEventId).toBe('newer')
    expect(imported.progress).toEqual(progressFromEvents(imported.events))
  })

  it('rejects conflicting immutable event IDs without partially importing anything', async () => {
    await recordAttempt(input())
    const conflicting = defaultData()
    conflicting.events = [createAttempt(input({ answer: 'altered' })), createAttempt(input({ id: 'new-event', wordId: 'sense-2' }))]
    await expect(importData(JSON.stringify(conflicting))).rejects.toThrow('conflicts')
    expect((await loadData()).events).toHaveLength(1)
    expect((await loadData()).events[0].answer).toBe('feasible')
  })

  it('rejects forged effective ratings, future schemas, invalid settings, and malformed JSON', async () => {
    const forged = defaultData()
    forged.events = [createAttempt(input({ hinted: true }))]
    forged.events[0].effectiveRating = 'good'
    await expect(importData(JSON.stringify(forged))).rejects.toThrow('altered')
    await expect(importData('{"schemaVersion":99}')).rejects.toThrow('schema')
    await expect(importData('{ nope')).rejects.toThrow('JSON')
    const invalid = defaultData()
    invalid.settings.dailyNewLimit = -1
    await expect(saveData(invalid)).rejects.toThrow('limit')
    expect((await loadData()).events).toHaveLength(0)
  })

  it('rebuilds progress from evidence rather than trusting imported mastery claims', async () => {
    const backup = defaultData()
    backup.events = [createAttempt(input({ result: 'incorrect', rating: 'again' }))]
    backup.progress['sense-1'] = { wordId: 'sense-1', dueAt: NOW + DAY_MS * 365, intervalDays: 365, repetitions: 100, lapses: 0, lastReviewedAt: NOW, lastEventId: 'fake', lastRating: 'good', firstSeenAt: NOW }
    const imported = await importData(JSON.stringify(backup))
    expect(imported.progress['sense-1'].repetitions).toBe(0)
    expect(imported.progress['sense-1'].lastRating).toBe('again')
  })

  it('migrates an unversioned pre-release backup with immutable events to schema v2', async () => {
    const legacy = { events: [createAttempt(input())], settings: { dailyNewLimit: 8 }, session: null }
    const migrated = await importData(JSON.stringify(legacy))
    expect(migrated.schemaVersion).toBe(2)
    expect(migrated.settings.dailyNewLimit).toBe(8)
    expect(migrated.settings.onboardingComplete).toBe(false)
    expect(migrated.events).toHaveLength(1)
  })

  it('atomically migrates a real v1 IndexedDB state and retains its exact pre-upgrade backup', async () => {
    await rawKey('state', v1Fixture)
    const migrated = await loadData()
    expect(migrated.schemaVersion).toBe(2)
    expect(migrated.events).toEqual(v1Fixture.events)
    expect(migrated.settings).toEqual({ ...v1Fixture.settings, soundVolume: 0.12, difficultyAdjustment: 0, vocabularyProfile: null })
    for (const [wordId, progress] of Object.entries(v1Fixture.progress)) {
      expect(migrated.progress[wordId].dueAt).toBe(progress.dueAt)
      expect(migrated.progress[wordId].fsrsCard?.due).toBe(progress.dueAt)
      expect(migrated.progress[wordId].schedulerVersion).toBe(LEGACY_SCHEDULER_VERSION)
    }
    expect(JSON.parse((await exportMigrationBackup())!)).toEqual(v1Fixture)
    expect(await getMigrationBackupInfo()).toMatchObject({ available: true, sourceSchema: 1 })
    expect((await rawKey('state') as { schemaVersion: number }).schemaVersion).toBe(2)
    await closeStorage()
    expect(await loadData()).toEqual(migrated)
    expect(JSON.parse((await exportMigrationBackup())!)).toEqual(v1Fixture)
  })

  it('migrates v1 JSON imports, deduplicates old events, and schedules only new reviews with FSRS', async () => {
    const migrated = await importData(JSON.stringify(v1Fixture))
    const previous = migrated.progress['receipt-noun-1']
    const at = previous.dueAt
    const next = await recordAttempt(input({ id: 'first-fsrs-review', wordId: previous.wordId, at }))
    expect(next.events.slice(0, 2)).toEqual(v1Fixture.events)
    expect(next.events[2]).toMatchObject({ schedulerVersion: SCHEDULER_VERSION, parameterSetId: PARAMETER_SET_ID })
    expect(next.progress[previous.wordId].dueAt).toBe(previewIntervals(previous, at).good)
    const merged = await importData(JSON.stringify(v1Fixture))
    expect(merged.events).toHaveLength(3)
    expect(merged.progress[previous.wordId]).toEqual(next.progress[previous.wordId])
    const exported = await exportData()
    expect((await importData(exported)).progress).toEqual(merged.progress)
    expect(JSON.parse((await exportMigrationBackup())!)).toEqual(v1Fixture)
  })

  it('preserves a genuinely saved old due date instead of silently replacing it with FSRS', async () => {
    const legacy = structuredClone(v1Fixture)
    legacy.progress['analyze-verb-1'].dueAt += 2 * DAY_MS
    const migrated = await importData(JSON.stringify(legacy))
    expect(migrated.progress['analyze-verb-1'].dueAt).toBe(legacy.progress['analyze-verb-1'].dueAt)
    expect(migrated.events).toEqual(legacy.events)
    const earlierBackup = await importData(JSON.stringify(v1Fixture))
    expect(earlierBackup.progress['analyze-verb-1'].dueAt).toBe(legacy.progress['analyze-verb-1'].dueAt)
  })

  it('keeps early v1 hinted-Hard evidence intact while new hinted reviews are Again', async () => {
    const legacy = structuredClone(v1Fixture)
    Object.assign(legacy.events[0], { result: 'correct', requestedRating: 'good', effectiveRating: 'hard', hinted: true, answer: 'receipt' })
    legacy.progress['receipt-noun-1'].dueAt = legacy.events[0].at + DAY_MS
    const migrated = await importData(JSON.stringify(legacy))
    expect(migrated.events[0]).toEqual(legacy.events[0])
    const next = await recordAttempt(input({ id: 'new-hinted', wordId: 'receipt-noun-1', at: legacy.events[0].at + DAY_MS, hinted: true }))
    expect(next.events.at(-1)?.effectiveRating).toBe('again')
    expect(next.events[0].effectiveRating).toBe('hard')
  })

  it('rejects unlinked, future, or invalid legacy anchor overrides without a partial import', async () => {
    const migrated = await importData(JSON.stringify(v1Fixture))
    const invalid = structuredClone(migrated)
    invalid.legacyScheduleAnchors['v1-analyze-good'].wordId = 'other-word'
    await expect(importData(JSON.stringify(invalid))).rejects.toThrow('matching v1 event')
    invalid.legacyScheduleAnchors = structuredClone(migrated.legacyScheduleAnchors)
    invalid.legacyScheduleAnchors['v1-analyze-good'].dueAt = migrated.events[1].at - 1
    await expect(importData(JSON.stringify(invalid))).rejects.toThrow('due time')
    invalid.legacyScheduleAnchors['v1-analyze-good'].dueAt = migrated.events[1].at + 366 * DAY_MS
    await expect(importData(JSON.stringify(invalid))).rejects.toThrow('due time')
    expect((await loadData()).progress).toEqual(migrated.progress)
  })

  it('rejects changed FSRS parameters and unknown event versions instead of replaying under guesses', async () => {
    await recordAttempt(input())
    const original = await loadData()
    const invalid = structuredClone(original)
    ;(invalid.scheduler.parameters.w as number[])[0] += 0.1
    await expect(importData(JSON.stringify(invalid))).rejects.toThrow('FSRS parameter w')
    const badVersion = JSON.parse(await exportData())
    badVersion.events[0].schedulerVersion = 'fsrs-future'
    await expect(importData(JSON.stringify(badVersion))).rejects.toThrow('scheduler version')
    expect(await loadData()).toEqual(original)
  })

  it('rolls back both migration and automatic backup if the migration state write fails', async () => {
    await rawKey('state', v1Fixture)
    const originalPut = IDBObjectStore.prototype.put
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      if (key === 'state') throw new DOMException('Migration storage is full.', 'QuotaExceededError')
      return originalPut.call(this, value, key!)
    })
    await expect(loadData()).rejects.toThrow('full')
    put.mockRestore()
    expect(await rawKey('state')).toEqual(v1Fixture)
    expect(await rawKey('pre-fsrs-v1-backup')).toBeUndefined()
  })

  it('restores only on explicit API call, keeping newer v2 data in a separate safety backup', async () => {
    expect(await getMigrationBackupInfo()).toEqual({ available: false, createdAt: null, sourceSchema: null })
    await importData(JSON.stringify(v1Fixture))
    await recordAttempt(input({ id: 'after-upgrade', wordId: 'new-sense', at: NOW + DAY_MS }))
    const beforeRestore = await loadData()
    expect(beforeRestore.events).toHaveLength(3)
    const restored = await restoreMigrationBackup()
    expect(restored.schemaVersion).toBe(2)
    expect(restored.events).toEqual(v1Fixture.events)
    expect(JSON.parse((await exportRestoreSafetyBackup())!)).toEqual(beforeRestore)
    expect(JSON.parse((await exportMigrationBackup())!)).toEqual(v1Fixture)
  })

  it('retains the first pre-upgrade snapshot when another legacy backup is imported later', async () => {
    await importData(JSON.stringify(v1Fixture))
    const firstInfo = await getMigrationBackupInfo()
    const other = structuredClone(v1Fixture)
    other.settings.dailyNewLimit = 20
    await importData(JSON.stringify(other))
    expect(await getMigrationBackupInfo()).toEqual(firstInfo)
    expect(JSON.parse((await exportMigrationBackup())!)).toEqual(v1Fixture)
    expect((await loadData()).settings.dailyNewLimit).toBe(20)
  })

  it('leaves current v2 state untouched if the explicit restore safety backup fails', async () => {
    await importData(JSON.stringify(v1Fixture))
    const current = await recordAttempt(input({ id: 'new-to-preserve' }))
    const originalPut = IDBObjectStore.prototype.put
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      if (key === 'before-migration-backup-restore') throw new DOMException('Cannot preserve the current state.', 'QuotaExceededError')
      return originalPut.call(this, value, key!)
    })
    await expect(restoreMigrationBackup()).rejects.toThrow('preserve')
    put.mockRestore()
    expect(await loadData()).toEqual(current)
    expect(await exportRestoreSafetyBackup()).toBeNull()
  })

  it('migrates a 50,000-event legacy state with original due dates and backup intact', async () => {
    const base = v1Fixture.events[0]
    const events = Array.from({ length: 50_000 }, (_, index) => ({
      ...base, id: `legacy-${String(index).padStart(5, '0')}`, firstAttemptId: `legacy-${String(index).padStart(5, '0')}`,
    }))
    const legacy = {
      ...v1Fixture, events,
      progress: { [base.wordId]: { ...v1Fixture.progress['receipt-noun-1'], lastEventId: 'legacy-49999' } },
    }
    await rawKey('state', legacy)
    const migrated = await loadData()
    expect(migrated.events).toHaveLength(50_000)
    expect(migrated.events.every(event => event.schedulerVersion === LEGACY_SCHEDULER_VERSION)).toBe(true)
    expect(migrated.progress[base.wordId].dueAt).toBe(legacy.progress[base.wordId].dueAt)
    expect(migrated.progress[base.wordId].fsrsCard?.reps).toBe(50_000)
    expect(JSON.parse((await exportMigrationBackup())!).events).toHaveLength(50_000)
  }, 30_000)
})
