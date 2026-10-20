import { describe, expect, it } from 'vitest'
import { createEmptyCard, fsrs, Rating as FsrsRating } from 'ts-fsrs'
import {
  AGAIN_MS, DAY_MS, createAttempt, defaultData, getStudyQueue, getTodayStats,
  FSRS_PARAMETERS, LEGACY_SCHEDULER_VERSION, SCHEDULER_VERSION, PARAMETER_SET_ID, previewIntervals,
  localDay, progressFromEvents, scheduleAttempt, type AttemptInput, type AttemptEvent,
} from './engine'

const NOW = Date.UTC(2026, 9, 17, 12)
const input = (extra: Partial<AttemptInput> = {}): AttemptInput => ({
  id: 'attempt-1', wordId: 'sense-1', mode: 'typed', result: 'correct', rating: 'good', at: NOW, timezone: 'UTC', ...extra,
})

const legacyAttempt = (extra: Partial<AttemptInput> = {}): AttemptEvent => {
  const { parameterSetId: _parameterSetId, ...event } = createAttempt(input(extra))
  return { ...event, schedulerVersion: LEGACY_SCHEDULER_VERSION }
}

describe('versioned FSRS scheduler and frozen legacy replay', () => {
  it('replays the frozen v1 1, 3, 7 day policy without relabeling historical events', () => {
    const first = scheduleAttempt(undefined, legacyAttempt())
    expect(first.dueAt).toBe(NOW + DAY_MS)
    expect(first.repetitions).toBe(1)
    const second = scheduleAttempt(first, legacyAttempt({ id: 'attempt-2', at: first.dueAt }))
    expect(second.intervalDays).toBe(3)
    const third = scheduleAttempt(second, legacyAttempt({ id: 'attempt-3', at: second.dueAt }))
    expect(third.intervalDays).toBe(7)
    const lapse = scheduleAttempt(third, createAttempt(input({ id: 'attempt-4', at: third.dueAt, rating: 'again', result: 'incorrect' })))
    expect(lapse.dueAt - lapse.lastReviewedAt).toBe(AGAIN_MS)
    expect(lapse.repetitions).toBe(0)
    expect(lapse.lapses).toBe(1)
  })

  it('uses the pinned mature FSRS implementation and full parameter snapshot', () => {
    const event = createAttempt(input())
    const first = scheduleAttempt(undefined, event)
    const reference = fsrs(FSRS_PARAMETERS).next(createEmptyCard(NOW), NOW, FsrsRating.Good).card
    expect(first.dueAt).toBe(reference.due.getTime())
    expect(first.dueAt).toBe(NOW + 2 * DAY_MS)
    expect(first.fsrsCard?.stability).toBe(reference.stability)
    expect(first.fsrsCard?.difficulty).toBe(reference.difficulty)
    expect(first.schedulerVersion).toBe(SCHEDULER_VERSION)
    expect(event.parameterSetId).toBe(PARAMETER_SET_ID)
    expect(defaultData().scheduler.parameters).toEqual(FSRS_PARAMETERS)
    expect(defaultData().scheduler.parameters.enable_fuzz).toBe(false)
  })

  it('returns actual next appointments for the three supported assessment choices', () => {
    expect(previewIntervals(undefined, NOW)).toEqual({ again: NOW + AGAIN_MS, hard: NOW + 15 * 60_000, good: NOW + 2 * DAY_MS })
  })

  it('preserves an anchored old due date until a genuinely new FSRS review', () => {
    const old = legacyAttempt()
    const dueAt = NOW + 5 * DAY_MS
    const migrated = progressFromEvents([old], { [old.id]: { wordId: old.wordId, eventId: old.id, dueAt } })
    expect(migrated[old.wordId].dueAt).toBe(dueAt)
    expect(migrated[old.wordId].fsrsCard?.due).toBe(dueAt)
    const next = createAttempt(input({ id: 'fsrs-next', at: dueAt }))
    const progress = progressFromEvents([old, next], { [old.id]: { wordId: old.wordId, eventId: old.id, dueAt } })
    expect(progress[old.wordId].schedulerVersion).toBe(SCHEDULER_VERSION)
    expect(progress[old.wordId].dueAt).toBe(previewIntervals(migrated[old.wordId], dueAt).good)
    expect(old.schedulerVersion).toBe(LEGACY_SCHEDULER_VERSION)
  })

  it('has deterministic ordinal tie ordering and replay regardless of input order', () => {
    const a = createAttempt(input({ id: 'z' }))
    const b = createAttempt(input({ id: 'ä', rating: 'again', result: 'incorrect' }))
    expect(progressFromEvents([a, b])).toEqual(progressFromEvents([b, a]))
    expect(progressFromEvents([a, b])['sense-1'].lastEventId).toBe('ä')
  })

  it.each([{ hinted: true }, { revealed: true }, { retry: true }])('relearns aided or corrected recall after ten minutes: %j', evidence => {
    const event = createAttempt(input(evidence))
    expect(event.requestedRating).toBe('good')
    expect(event.effectiveRating).toBe('again')
    expect(scheduleAttempt(undefined, event).dueAt).toBe(NOW + AGAIN_MS)
  })

  it('relearns a hinted established word soon even when the requested rating is hard', () => {
    const previous = scheduleAttempt(undefined, createAttempt(input()))
    previous.intervalDays = 60
    previous.repetitions = 6
    const event = createAttempt(input({ id: 'hinted-established', at: NOW + 60 * DAY_MS, rating: 'hard', hinted: true }))
    const next = scheduleAttempt(previous, event)
    expect(next.dueAt).toBe(event.at + AGAIN_MS)
    expect(next.repetitions).toBe(0)
  })

  it('records incorrect typed submission as again even if the caller requests good', () => {
    const event = createAttempt(input({ answer: 'accomodate', result: 'incorrect', rating: 'good' }))
    expect(event.answer).toBe('accomodate')
    expect(event.effectiveRating).toBe('again')
  })

  it('preserves the original attempt when a later correction is submitted', () => {
    const first = createAttempt(input({ id: 'original', roundId: 'round', answer: 'wrong', result: 'incorrect', rating: 'again' }))
    const corrected = createAttempt(input({ id: 'retry', at: NOW + 1_000, roundId: 'round', firstAttemptId: first.id, answer: 'corrected', retry: true }))
    expect(first.firstAttempt).toBe(true)
    expect(first.answer).toBe('wrong')
    expect(first.result).toBe('incorrect')
    expect(corrected.firstAttempt).toBe(false)
    expect(corrected.firstAttemptId).toBe(first.id)
    expect(corrected.effectiveRating).toBe('again')
    expect(progressFromEvents([corrected, first])['sense-1'].lastEventId).toBe('retry')
  })

  it('separates handwriting self-assessment from automatic correctness', () => {
    const event = createAttempt(input({ mode: 'handwriting', result: 'self-rated', hasInk: true }))
    expect(event.result).toBe('self-rated')
    expect(event.hasInk).toBe(true)
    expect(event.answer).toBeNull()
    expect(() => createAttempt(input({ mode: 'handwriting', result: 'correct' }))).toThrow('self-assessed')
  })

  it('does not let an older attempt replace a newer schedule', () => {
    const newerEvent = createAttempt(input({ id: 'newer', at: NOW + DAY_MS }))
    const newer = scheduleAttempt(undefined, newerEvent)
    expect(scheduleAttempt(newer, createAttempt(input({ id: 'older' })))).toBe(newer)
  })

  it('does not advance intervals when an identical event ID is projected twice', () => {
    const event = createAttempt(input())
    expect(progressFromEvents([event, event])).toEqual(progressFromEvents([event]))
  })

  it('retains original submission time separately from later assessment time', () => {
    const event = createAttempt(input({ startedAt: NOW - 60_000, submittedAt: NOW - 30_000 }))
    expect(event.startedAt).toBe(NOW - 60_000)
    expect(event.submittedAt).toBe(NOW - 30_000)
    expect(event.at).toBe(NOW)
    expect(createAttempt(input()).submittedAt).toBe(NOW)
  })

  it.each([NOW - 60_001, NOW + 1, NaN])('rejects submission time outside the recall-to-assessment interval: %s', submittedAt => {
    expect(() => createAttempt(input({ startedAt: NOW - 60_000, submittedAt }))).toThrow('submission time')
  })

  it('stores UTC elapsed time while retaining timezone and local-day evidence across DST', () => {
    const at = Date.UTC(2026, 2, 8, 8, 30) // US spring daylight-saving transition.
    const event = createAttempt(input({ at, timezone: 'America/Los_Angeles' }))
    expect(event.localDay).toBe('2026-03-08')
    expect(scheduleAttempt(undefined, event).dueAt - at).toBe(2 * DAY_MS)
    expect(localDay(Date.UTC(2026, 9, 18, 2), 'America/Los_Angeles')).toBe('2026-10-17')
    expect(localDay(Date.UTC(2026, 9, 18, 2), 'Asia/Shanghai')).toBe('2026-10-18')
  })

  it('returns due reviews first, excludes future reviews, and caps new introductions across decks', () => {
    const data = defaultData()
    data.settings.timezone = 'UTC'
    data.settings.dailyNewLimit = 2
    data.events = [
      createAttempt(input({ wordId: 'due', at: NOW - DAY_MS * 2 })),
      createAttempt(input({ id: 'today', wordId: 'future', at: NOW - 1_000 })),
    ]
    data.progress = progressFromEvents(data.events)
    expect(getStudyQueue(['new-a', 'future', 'due', 'new-b', 'new-a'], data, NOW)).toEqual(['due', 'new-a'])
    expect(getTodayStats(data, NOW)).toMatchObject({ newWords: 1, due: 1, attempts: 1, correctFirstAttempts: 1 })
    expect(getStudyQueue(['new-a', 'new-b'], data, NOW + DAY_MS)).toEqual(['new-a', 'new-b'])
  })

  it('counts typed correctness and handwritten self-assessment separately', () => {
    const data = defaultData()
    data.settings.timezone = 'UTC'
    data.events = [
      createAttempt(input()),
      createAttempt(input({ id: 'ink', wordId: 'sense-2', mode: 'handwriting', result: 'self-rated', hasInk: true })),
      createAttempt(input({ id: 'hint', wordId: 'sense-3', hinted: true })),
    ]
    data.progress = progressFromEvents(data.events)
    expect(getTodayStats(data, NOW)).toMatchObject({ firstAttempts: 3, correctFirstAttempts: 1, selfRatedFirstAttempts: 1 })
  })
})
