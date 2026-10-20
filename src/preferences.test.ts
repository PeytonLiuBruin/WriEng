import 'fake-indexeddb/auto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { defaultData, DEFAULT_SOUND_VOLUME, type AppData, type VocabularyProfile } from './engine'
import { closeStorage, exportData, importData, loadData, recordAttempt, resetData, saveData, validateData } from './storage'

const NOW = Date.UTC(2026, 9, 20, 7)
const profile = (): VocabularyProfile => ({
  version: 1, status: 'completed', targetBand: 2, rangeLow: 1, rangeHigh: 3,
  sampleSize: 10, correct: 6, bandsTested: [0, 2, 4], assessedAt: NOW,
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

async function withHistory(): Promise<AppData> {
  return recordAttempt({ id: 'preference-history', wordId: 'existing-sense', mode: 'typed', rating: 'good', result: 'correct', answer: 'existing', at: NOW, timezone: 'UTC' })
}

async function writeOldState(state: AppData) {
  const request = indexedDB.open('wrieng-learning', 1)
  await new Promise<void>((resolve, reject) => {
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const db = request.result
      const transaction = db.transaction('app', 'readwrite')
      transaction.objectStore('app').put(state, 'state')
      transaction.oncomplete = () => { db.close(); resolve() }
      transaction.onerror = () => { db.close(); reject(transaction.error) }
    }
  })
}

function withoutNewPreferences(data: AppData): AppData {
  const old = structuredClone(data)
  delete old.settings.soundVolume
  delete old.settings.difficultyAdjustment
  delete old.settings.vocabularyProfile
  return old
}

describe('local sound and placement preferences', () => {
  it('starts quietly without claiming an assessment or a measured vocabulary size', async () => {
    const data = await loadData()
    expect(data.settings.soundVolume).toBe(DEFAULT_SOUND_VOLUME)
    expect(DEFAULT_SOUND_VOLUME).toBe(0.12)
    expect(data.settings.soundEnabled).toBe(true)
    expect(data.settings.difficultyAdjustment).toBe(0)
    expect(data.settings.vocabularyProfile).toBeNull()
    expect(data.events).toEqual([])
    expect(data.progress).toEqual({})
  })

  it('hydrates an old v2 IndexedDB state without changing its answers, session, or schedules', async () => {
    const original = await withHistory()
    original.session = { id: 'before-preferences', queue: ['existing-sense'], index: 0, stage: 'feedback', mode: 'typed', startedAt: NOW, response: 'existing', submittedAt: NOW }
    const old = withoutNewPreferences(original)
    await writeOldState(old)
    await closeStorage()
    const loaded = await loadData()
    expect(loaded.events).toEqual(original.events)
    expect(loaded.progress).toEqual(original.progress)
    expect(loaded.session).toEqual(original.session)
    expect(loaded.settings).toEqual({ ...old.settings, soundVolume: 0.12, difficultyAdjustment: 0, vocabularyProfile: null })
    await closeStorage()
    expect(await loadData()).toEqual(loaded)
  })

  it('round-trips muted volume, placement and difficulty through reopen and backup restore', async () => {
    const data = await withHistory()
    data.settings = { ...data.settings, soundEnabled: false, soundVolume: 0.27, difficultyAdjustment: -1, vocabularyProfile: profile() }
    const saved = await saveData(data)
    await closeStorage()
    expect(await loadData()).toEqual(saved)
    const backup = await exportData()
    await resetData()
    const restored = await importData(backup)
    expect(restored.settings).toEqual(saved.settings)
    expect(restored.events).toEqual(saved.events)
    expect(restored.progress).toEqual(saved.progress)
  })

  it('records postponement as zero evidence and adds no learning attempts', async () => {
    const data = await withHistory()
    data.settings.vocabularyProfile = {
      version: 1, status: 'skipped', targetBand: 1, rangeLow: 0, rangeHigh: 4,
      sampleSize: 0, correct: 0, bandsTested: [], assessedAt: NOW,
    }
    const saved = await saveData(data)
    expect(saved.settings.vocabularyProfile?.status).toBe('skipped')
    expect(saved.events).toEqual(data.events)
    expect(saved.progress).toEqual(data.progress)
  })

  it('imports an old backup without resetting newer placement, volume or difficulty preferences', async () => {
    const data = await withHistory()
    data.settings = { ...data.settings, soundVolume: 0, difficultyAdjustment: 1, vocabularyProfile: profile() }
    const saved = await saveData(data)
    const oldBackup = withoutNewPreferences(defaultData())
    oldBackup.settings.selectedDecks = ['gre']
    const imported = await importData(JSON.stringify(oldBackup))
    expect(imported.settings).toMatchObject({ soundVolume: 0, difficultyAdjustment: 1, vocabularyProfile: profile(), selectedDecks: ['gre'] })
    expect(imported.events).toEqual(saved.events)
    expect(imported.progress).toEqual(saved.progress)
  })

  it('keeps new preferences when an older UI snapshot saves unrelated settings', async () => {
    const stale = withoutNewPreferences(await loadData())
    const current = await withHistory()
    current.settings = { ...current.settings, soundVolume: 0.05, difficultyAdjustment: -1, vocabularyProfile: profile() }
    await saveData(current)
    stale.settings.reducedMotion = true
    const saved = await saveData(stale)
    expect(saved.settings).toMatchObject({ reducedMotion: true, soundVolume: 0.05, difficultyAdjustment: -1, vocabularyProfile: profile() })
    expect(saved.events).toEqual(current.events)
  })

  it('honors explicit zero volume and explicit profile reset in a new-format backup', async () => {
    const data = await loadData()
    data.settings.vocabularyProfile = profile()
    await saveData(data)
    const backup = defaultData()
    backup.settings.soundVolume = 0
    backup.settings.vocabularyProfile = null
    const imported = await importData(JSON.stringify(backup))
    expect(imported.settings.soundVolume).toBe(0)
    expect(imported.settings.vocabularyProfile).toBeNull()
  })

  it.each([-0.01, 1.01, Number.NaN, Number.POSITIVE_INFINITY, null, '0.2'])('rejects unsafe volume %s', value => {
    const raw = defaultData()
    Object.assign(raw.settings, { soundVolume: value })
    expect(() => validateData(raw)).toThrow('sound volume')
  })

  it.each([-2, 2, 0.5, Number.NaN, null, '0'])('rejects invalid difficulty adjustment %s', value => {
    const raw = defaultData()
    Object.assign(raw.settings, { difficultyAdjustment: value })
    expect(() => validateData(raw)).toThrow('difficulty adjustment')
  })

  it.each([
    { version: 2 }, { status: 'expert' }, { targetBand: -1 }, { targetBand: 5 },
    { rangeLow: 3 }, { rangeHigh: 1 }, { sampleSize: 1 }, { sampleSize: 13 },
    { sampleSize: 8.5 }, { correct: 11 }, { correct: -1 }, { correct: Number.NaN },
    { bandsTested: [0, 0, 4] }, { bandsTested: [0, 4] }, { bandsTested: [0, 2, 5] },
    { bandsTested: '0,2,4' }, { assessedAt: -1 }, { assessedAt: Date.now() + 60 * 60_000 },
    { status: 'skipped' },
  ])('rejects malformed or unsupported placement evidence %j', patch => {
    const raw = defaultData()
    raw.settings.vocabularyProfile = { ...profile(), ...patch } as VocabularyProfile
    expect(() => validateData(raw)).toThrow('vocabulary')
  })

  it('rejects a bad profile atomically without erasing the previous preference or history', async () => {
    const data = await withHistory()
    data.settings.vocabularyProfile = profile()
    await saveData(data)
    const before = await exportData()
    const bad = defaultData()
    bad.settings.vocabularyProfile = { ...profile(), sampleSize: 1 }
    await expect(importData(JSON.stringify(bad))).rejects.toThrow('vocabulary')
    expect(await exportData()).toBe(before)
  })
})
