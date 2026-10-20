import { createEmptyCard, fsrs, Rating as FsrsRating, type Card, type FSRSParameters } from 'ts-fsrs'

export const LEGACY_SCHEDULER_VERSION = 'wrieng-interval-v1' as const
export const SCHEDULER_VERSION = 'ts-fsrs-5.4.2-fsrs6-wrieng-v2' as const
export const PARAMETER_SET_ID = 'wrieng-fsrs6-retention90-v1' as const
export type SchedulerVersion = typeof SCHEDULER_VERSION | typeof LEGACY_SCHEDULER_VERSION
/** Pinned package defaults are written out so a future package upgrade cannot silently change replay. */
export const FSRS_PARAMETERS: Readonly<FSRSParameters> = Object.freeze({
  request_retention: 0.9, maximum_interval: 36500, enable_fuzz: false, enable_short_term: true,
  learning_steps: Object.freeze(['10m'] as const), relearning_steps: Object.freeze(['10m'] as const),
  w: Object.freeze([0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796, 1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542]),
})
const fsrsScheduler = fsrs(FSRS_PARAMETERS)
export const DAY_MS = 86_400_000
export const AGAIN_MS = 10 * 60_000

export type Rating = 'again' | 'hard' | 'good'
export type RecallMode = 'typed' | 'handwriting'
export type RecallResult = 'correct' | 'incorrect' | 'self-rated'

export interface AttemptInput {
  id?: string
  wordId: string
  mode: RecallMode
  rating: Rating
  result?: RecallResult
  hinted?: boolean
  /** True only if the answer was seen BEFORE recall, not the normal reveal after submission. */
  revealed?: boolean
  retry?: boolean
  sessionId?: string
  roundId?: string
  firstAttemptId?: string
  startedAt?: number
  /** Time the original answer was submitted, before feedback/self-assessment. */
  submittedAt?: number
  at?: number
  timezone?: string
  /** Original typed submission; never replaced by the corrected retry. */
  answer?: string
  /** Stroke presence only; this is not OCR evidence or proof of recall. */
  hasInk?: boolean
}

export interface AttemptEvent {
  id: string
  wordId: string
  mode: RecallMode
  result: RecallResult
  requestedRating: Rating
  effectiveRating: Rating
  hinted: boolean
  revealed: boolean
  retry: boolean
  firstAttempt: boolean
  firstAttemptId: string
  sessionId: string | null
  roundId: string
  startedAt: number
  submittedAt: number
  at: number
  timezone: string
  localDay: string
  schedulerVersion: SchedulerVersion
  parameterSetId?: typeof PARAMETER_SET_ID
  answer: string | null
  hasInk: boolean
}

export interface WordProgress {
  wordId: string
  dueAt: number
  intervalDays: number
  repetitions: number
  lapses: number
  lastReviewedAt: number
  lastEventId: string
  lastRating: Rating
  firstSeenAt: number
  fsrsOrigin?: 'legacy-ratings-replay' | 'fsrs-review'
  fsrsCard?: StoredFsrsCard
  schedulerVersion?: SchedulerVersion
  parameterSetId?: typeof PARAMETER_SET_ID
}

export interface StoredFsrsCard extends Omit<Card, 'due' | 'last_review'> {
  due: number
  last_review: number | null
}
export interface SchedulerSnapshot {
  version: typeof SCHEDULER_VERSION
  algorithm: 'FSRS-6'
  packageVersion: '5.4.2'
  parameterSetId: typeof PARAMETER_SET_ID
  parameters: FSRSParameters
}
export interface LegacyScheduleAnchor { wordId: string; eventId: string; dueAt: number }
export type LegacyScheduleAnchors = Record<string, LegacyScheduleAnchor>
export function schedulerSnapshot(): SchedulerSnapshot {
  return {
    version: SCHEDULER_VERSION, algorithm: 'FSRS-6', packageVersion: '5.4.2', parameterSetId: PARAMETER_SET_ID,
    parameters: { ...FSRS_PARAMETERS, w: [...FSRS_PARAMETERS.w], learning_steps: [...FSRS_PARAMETERS.learning_steps], relearning_steps: [...FSRS_PARAMETERS.relearning_steps] },
  }
}

export interface Settings {
  dailyNewLimit: number
  selectedDecks: string[]
  timezone: string
  onboardingComplete: boolean
  speechRate: number
  soundEnabled: boolean
  reducedMotion: boolean
}

export interface StudySession {
  id: string
  queue: string[]
  index: number
  stage: 'study' | 'recall' | 'feedback' | 'done'
  mode: RecallMode
  startedAt: number
  [key: string]: unknown
}

export interface AppData {
  schemaVersion: 2
  progress: Record<string, WordProgress>
  events: AttemptEvent[]
  settings: Settings
  session: StudySession | null
  scheduler: SchedulerSnapshot
  legacyScheduleAnchors: LegacyScheduleAnchors
}

export function currentTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

const dayFormatters = new Map<string, Intl.DateTimeFormat>()

export function localDay(at: number, timezone = currentTimezone()): string {
  let formatter = dayFormatters.get(timezone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    })
    if (dayFormatters.size >= 32) dayFormatters.delete(dayFormatters.keys().next().value!)
    dayFormatters.set(timezone, formatter)
  }
  const parts = formatter.formatToParts(new Date(at))
  const part = (type: string) => parts.find(p => p.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

export function defaultData(): AppData {
  return {
    schemaVersion: 2,
    progress: {}, events: [], session: null,
    scheduler: schedulerSnapshot(), legacyScheduleAnchors: {},
    settings: {
      dailyNewLimit: 10, selectedDecks: ['daily'], timezone: currentTimezone(),
      onboardingComplete: false, speechRate: 0.85, soundEnabled: true, reducedMotion: false,
    },
  }
}

/** The id is generated once per submitted event; supplying it makes retries idempotent. */
export function createAttempt(input: AttemptInput): AttemptEvent {
  const at = input.at ?? Date.now()
  const validId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 200 && !['__proto__', 'constructor', 'prototype'].includes(value)
  if (!Number.isSafeInteger(at) || at < 0 || at > 8_640_000_000_000_000) throw new Error('Invalid attempt time.')
  if (!validId(input.wordId)) throw new Error('A valid sense/word ID is required.')
  if (!['typed', 'handwriting'].includes(input.mode)) throw new Error('Invalid recall mode.')
  if (!['again', 'hard', 'good'].includes(input.rating)) throw new Error('Invalid rating.')
  const result = input.result ?? (input.mode === 'handwriting' ? 'self-rated' : input.rating === 'again' ? 'incorrect' : 'correct')
  if (!['correct', 'incorrect', 'self-rated'].includes(result)) throw new Error('Invalid recall result.')
  if (input.mode === 'handwriting' && result !== 'self-rated') {
    throw new Error('Handwriting is self-assessed; no recognition score is available.')
  }
  const id = input.id ?? crypto.randomUUID()
  if (!validId(id)) throw new Error('Invalid event ID.')
  if (input.sessionId !== undefined && !validId(input.sessionId)) throw new Error('Invalid session ID.')
  if (input.roundId !== undefined && !validId(input.roundId)) throw new Error('Invalid round ID.')
  if (input.firstAttemptId !== undefined && !validId(input.firstAttemptId)) throw new Error('Invalid first-attempt ID.')
  if ([input.hinted, input.revealed, input.retry].some(value => value !== undefined && typeof value !== 'boolean')) throw new Error('Invalid recall evidence.')
  const retry = input.retry ?? false
  const hinted = input.hinted ?? false
  const revealed = input.revealed ?? false
  let effectiveRating = input.rating
  // Aided retrieval and immediate corrections have not demonstrated independent recall.
  // Relearn soon rather than letting an established long interval postpone correction.
  if (result === 'incorrect' || hinted || revealed || retry) effectiveRating = 'again'
  const timezone = input.timezone ?? currentTimezone()
  const startedAt = input.startedAt ?? at
  if (!Number.isSafeInteger(startedAt) || startedAt < 0 || startedAt > at) throw new Error('Invalid start time.')
  const submittedAt = input.submittedAt ?? at
  if (!Number.isSafeInteger(submittedAt) || submittedAt < startedAt || submittedAt > at) throw new Error('Invalid submission time.')
  if (input.answer !== undefined && (typeof input.answer !== 'string' || input.answer.length > 500)) throw new Error('Typed answers must be at most 500 characters.')
  if (input.hasInk !== undefined && typeof input.hasInk !== 'boolean') throw new Error('Invalid handwriting evidence.')
  return {
    id, wordId: input.wordId, mode: input.mode, result,
    requestedRating: input.rating, effectiveRating,
    hinted, revealed, retry, firstAttempt: !retry,
    firstAttemptId: retry ? input.firstAttemptId ?? input.roundId ?? id : id,
    sessionId: input.sessionId ?? null, roundId: input.roundId ?? id,
    startedAt, submittedAt, at, timezone, localDay: localDay(at, timezone), schedulerVersion: SCHEDULER_VERSION, parameterSetId: PARAMETER_SET_ID,
    answer: input.mode === 'typed' ? input.answer ?? null : null, hasInk: input.mode === 'handwriting' && (input.hasInk ?? false),
  }
}

function legacySchedule(previous: WordProgress | undefined, event: AttemptEvent): Pick<WordProgress, 'dueAt' | 'intervalDays'> {
  let intervalDays: number
  const repetitions = previous?.repetitions ?? 0
  if (event.effectiveRating === 'again') {
    intervalDays = AGAIN_MS / DAY_MS
  } else if (event.effectiveRating === 'hard') {
    intervalDays = Math.max(1, Math.min(30, (previous?.intervalDays ?? 0) * 1.2))
  } else {
    const intervals = [1, 3, 7, 14, 30, 60, 120, 240, 365]
    intervalDays = intervals[Math.min(repetitions, intervals.length - 1)]
    // Never shorten a long established interval solely because of a prior hard attempt.
    intervalDays = Math.max(intervalDays, previous?.intervalDays ?? 0)
  }
  return { dueAt: event.at + Math.round(intervalDays * DAY_MS), intervalDays }
}

export const compareEventOrder = (a: Pick<AttemptEvent, 'at' | 'id'>, b: Pick<AttemptEvent, 'at' | 'id'>): number => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
function unpackCard(card: StoredFsrsCard): Card {
  return { ...card, due: new Date(card.due), last_review: card.last_review === null ? undefined : new Date(card.last_review) }
}
function packCard(card: Card): StoredFsrsCard {
  return { ...card, due: card.due.getTime(), last_review: card.last_review?.getTime() ?? null }
}
const fsrsRating = (rating: Rating) => rating === 'again' ? FsrsRating.Again : rating === 'hard' ? FsrsRating.Hard : FsrsRating.Good

/** Ratings from old events seed FSRS memory; their original due dates remain on the frozen v1 policy. */
export function scheduleAttempt(previous: WordProgress | undefined, event: AttemptEvent, anchor?: LegacyScheduleAnchor): WordProgress {
  if (previous && previous.wordId !== event.wordId) throw new Error('Progress belongs to another sense.')
  if (previous && compareEventOrder(event, { at: previous.lastReviewedAt, id: previous.lastEventId }) <= 0) return previous
  if (event.schedulerVersion !== LEGACY_SCHEDULER_VERSION && (event.schedulerVersion !== SCHEDULER_VERSION || event.parameterSetId !== PARAMETER_SET_ID)) throw new Error('Unsupported scheduler or parameter version.')
  const before = previous?.fsrsCard ? unpackCard(previous.fsrsCard) : createEmptyCard(event.at)
  const card = fsrsScheduler.next(before, event.at, fsrsRating(event.effectiveRating)).card
  let dueAt = card.due.getTime()
  if (event.schedulerVersion === LEGACY_SCHEDULER_VERSION) {
    dueAt = anchor?.eventId === event.id && anchor.wordId === event.wordId ? anchor.dueAt : legacySchedule(previous, event).dueAt
    // The model state is a migration estimate, while this due date is the preserved old appointment.
    card.due = new Date(dueAt)
  }
  const repetitions = event.effectiveRating === 'again' ? 0 : (previous?.repetitions ?? 0) + (event.effectiveRating === 'good' ? 1 : 0)
  return {
    wordId: event.wordId,
    dueAt, intervalDays: (dueAt - event.at) / DAY_MS, repetitions,
    lapses: (previous?.lapses ?? 0) + (event.effectiveRating === 'again' ? 1 : 0),
    lastReviewedAt: event.at, lastEventId: event.id, lastRating: event.effectiveRating,
    firstSeenAt: Math.min(previous?.firstSeenAt ?? event.at, event.at),
    fsrsCard: packCard(card), schedulerVersion: event.schedulerVersion, parameterSetId: PARAMETER_SET_ID,
    fsrsOrigin: event.schedulerVersion === LEGACY_SCHEDULER_VERSION ? 'legacy-ratings-replay' : 'fsrs-review',
  }
}

/** A deterministic projection makes import order irrelevant. No attempt is erased by a retry. */
export function progressFromEvents(events: readonly AttemptEvent[], anchors: LegacyScheduleAnchors = {}): Record<string, WordProgress> {
  const progress: Record<string, WordProgress> = {}
  for (const event of [...events].sort(compareEventOrder)) {
    progress[event.wordId] = scheduleAttempt(progress[event.wordId], event, anchors[event.id])
  }
  return progress
}

/** Next appointments from the pinned scheduler; UI labels need not assume fixed Good/Hard intervals. */
export function previewIntervals(progress?: WordProgress, now = Date.now()): Record<Rating, number> {
  const card = progress?.fsrsCard ? unpackCard(progress.fsrsCard) : createEmptyCard(now)
  return Object.fromEntries((['again', 'hard', 'good'] as const).map(rating => [rating, fsrsScheduler.next(card, now, fsrsRating(rating)).card.due.getTime()])) as Record<Rating, number>
}

export interface TodayStats {
  attempts: number
  firstAttempts: number
  correctFirstAttempts: number
  selfRatedFirstAttempts: number
  newWords: number
  due: number
}

export function getTodayStats(data: AppData, now = Date.now()): TodayStats {
  const today = localDay(now, data.settings.timezone)
  const events = data.events.filter(event => localDay(event.at, data.settings.timezone) === today)
  const first = events.filter(event => event.firstAttempt)
  return {
    attempts: events.length,
    firstAttempts: first.length,
    correctFirstAttempts: first.filter(event => event.result === 'correct' && !event.hinted && !event.revealed).length,
    selfRatedFirstAttempts: first.filter(event => event.result === 'self-rated').length,
    newWords: Object.values(data.progress).filter(p => localDay(p.firstSeenAt, data.settings.timezone) === today).length,
    due: Object.values(data.progress).filter(p => p.dueAt <= now).length,
  }
}

/** Reviews always precede new words. The cap applies to first introductions per local day. */
export function getStudyQueue(wordIds: readonly string[], data: AppData, now = Date.now()): string[] {
  const unique = [...new Set(wordIds)]
  const due = unique.filter(id => data.progress[id]?.dueAt <= now)
    .sort((a, b) => data.progress[a].dueAt - data.progress[b].dueAt || a.localeCompare(b))
  const remaining = Math.max(0, data.settings.dailyNewLimit - getTodayStats(data, now).newWords)
  const fresh = unique.filter(id => !data.progress[id]).slice(0, remaining)
  return [...due, ...fresh]
}
