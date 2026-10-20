import { learningWords, type LearningWord } from './content';
import { getStudyQueue, type AppData, type AttemptEvent, type VocabularyProfile } from './engine';

/** These are usage-frequency groups, not validated item difficulty or CEFR levels. */
export const FREQUENCY_BANDS = [
  { id: 0, label: '高频起步', minimumZipf: 5.5 },
  { id: 1, label: '常用巩固', minimumZipf: 4.8 },
  { id: 2, label: '常用拓展', minimumZipf: 4.1 },
  { id: 3, label: '低频拓展', minimumZipf: 3.4 },
  { id: 4, label: '更低频探索', minimumZipf: 0 },
] as const;
export const PLACEMENT_QUESTION_COUNT = 10;
export interface PlacementAnswer { wordId: string; band: number; correct: boolean }
const clampBand = (band: number) => Math.max(0, Math.min(4, Math.round(band)));
const normalize = (value: string) => value.trim().toLocaleLowerCase('en-US').replace(/[‘’]/g, "'").replace(/\s+/g, ' ');

export function wordFrequencyBand(word: LearningWord): number | null {
  const zipf = word.frequency?.zipf;
  if (typeof zipf !== 'number' || !Number.isFinite(zipf) || zipf <= 0) return null;
  return FREQUENCY_BANDS.find(band => zipf >= band.minimumZipf)?.id ?? null;
}

function stableOrder(id: string): number {
  let hash = 2166136261;
  for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0;
}

/** Three spread-out groups first, then a simple bounded staircase. */
export function nextPlacementWord(words: readonly LearningWord[], answers: readonly PlacementAnswer[]): LearningWord | undefined {
  if (answers.length >= PLACEMENT_QUESTION_COUNT) return undefined;
  const byId = new Map(words.map(word => [word.id, word]));
  const usedIds = new Set(answers.map(answer => answer.wordId));
  const usedTerms = new Set(answers.map(answer => normalize(byId.get(answer.wordId)?.term ?? '')));
  const candidates = words.filter(word => !usedIds.has(word.id) && !usedTerms.has(normalize(word.term))
    && wordFrequencyBand(word) !== null && word.meaningZh?.trim() && word.definitionEn?.trim());
  if (!candidates.length) return undefined;
  const available = [...new Set(words.map(wordFrequencyBand).filter((band): band is number => band !== null))].sort((a, b) => a - b);
  const coverage: number[] = [];
  for (const desired of [0, 2, 4]) {
    const band = available.filter(item => !coverage.includes(item)).sort((a, b) => Math.abs(a - desired) - Math.abs(b - desired) || a - b)[0];
    if (band !== undefined) coverage.push(band);
  }
  let target: number;
  if (answers.length < coverage.length) target = coverage[answers.length];
  else {
    const passed = answers.slice(0, coverage.length).filter(answer => answer.correct).map(answer => answer.band);
    target = passed.length ? clampBand(Math.max(...passed) + 1) : 0;
    for (const answer of answers.slice(coverage.length)) target = clampBand(target + (answer.correct ? 1 : -1));
  }
  return candidates.sort((a, b) => Math.abs(wordFrequencyBand(a)! - target) - Math.abs(wordFrequencyBand(b)! - target)
    || stableOrder(a.id) - stableOrder(b.id) || a.id.localeCompare(b.id))[0];
}

/** A conservative starting-point heuristic over the whole sample, never one answer. */
export function assessVocabulary(answers: readonly PlacementAnswer[], now = Date.now()): VocabularyProfile {
  const bandsTested = [...new Set(answers.map(answer => answer.band))].sort((a, b) => a - b);
  if (answers.length < 8 || answers.length > PLACEMENT_QUESTION_COUNT || bandsTested.length < 3
    || new Set(answers.map(answer => answer.wordId)).size !== answers.length
    || answers.some(answer => !answer.wordId || !Number.isInteger(answer.band) || answer.band < 0 || answer.band > 4 || typeof answer.correct !== 'boolean')) {
    throw new Error('测评至少需要 8 道不同的题目，并覆盖 3 个词频组。');
  }
  const correct = answers.filter(answer => answer.correct).length;
  const supported = FREQUENCY_BANDS.filter(({ id }) => {
    const sample = answers.filter(answer => answer.band === id);
    return sample.length >= 2 && sample.filter(answer => answer.correct).length / sample.length >= 0.6;
  });
  const targetBand = supported.length ? supported[supported.length - 1].id
    : correct >= 3 ? clampBand(answers.filter(answer => answer.correct).reduce((sum, answer) => sum + answer.band, 0) / correct - 1) : 0;
  const spread = answers.length < 10 || correct < 3 ? 2 : 1;
  return {
    version: 1, status: 'completed', targetBand,
    rangeLow: Math.max(0, targetBand - spread), rangeHigh: Math.min(4, targetBand + spread),
    sampleSize: answers.length, correct, bandsTested, assessedAt: now,
  };
}

export function skippedVocabularyProfile(now = Date.now()): VocabularyProfile {
  return { version: 1, status: 'skipped', targetBand: 1, rangeLow: 0, rangeHigh: 4, sampleSize: 0, correct: 0, bandsTested: [], assessedAt: now };
}

export function vocabularySummary(profile?: VocabularyProfile | null) {
  const completed = profile?.status === 'completed';
  const target = completed ? clampBand(profile.targetBand) : 1;
  const low = completed ? clampBand(profile.rangeLow) : 0;
  const high = completed ? clampBand(profile.rangeHigh) : 4;
  return {
    targetLabel: FREQUENCY_BANDS[target].label,
    rangeLabel: `${FREQUENCY_BANDS[low].label} — ${FREQUENCY_BANDS[high].label}`,
    confidence: completed ? `有限样本：${profile.sampleSize} 题，覆盖 ${profile.bandsTested.length} 个词频组` : '尚未测评，先从常用词起步',
  };
}

function eligibleWords(words: readonly LearningWord[], data: AppData) {
  const decks = data.settings.selectedDecks;
  return words.filter(word => !decks.length || word.routes.some(route => decks.includes(route)));
}

function independentTypedEvents(words: readonly LearningWord[], data: AppData, now: number): AttemptEvent[] {
  const byId = new Map(words.map(word => [word.id, word]));
  const seen = new Set<string>();
  return [...data.events].sort((a, b) => b.at - a.at || b.id.localeCompare(a.id)).filter(event => {
    const word = byId.get(event.wordId);
    if (!word || event.at > now || event.at < now - 30 * 86400000 || event.mode !== 'typed' || !event.firstAttempt
      || event.hinted || event.revealed || event.retry || event.result === 'self-rated' || event.answer === null) return false;
    if (event.result === 'correct' && normalize(event.answer) !== normalize(word.term)) return false;
    const round = `${event.wordId}:${event.roundId}`;
    if (seen.has(round)) return false;
    seen.add(round);
    return true;
  }).slice(0, 20);
}

function targetFor(words: readonly LearningWord[], data: AppData, now: number) {
  const profile = data.settings.vocabularyProfile;
  let target = profile?.status === 'completed' ? clampBand(profile.targetBand) : 1;
  const events = independentTypedEvents(words, data, now);
  const byId = new Map(words.map(word => [word.id, word]));
  const sufficient = events.length >= 6 && new Set(events.map(event => normalize(byId.get(event.wordId)!.term))).size >= 3;
  let performanceAdjustment = 0;
  if (sufficient) {
    const accuracy = events.filter(event => event.result === 'correct').length / events.length;
    performanceAdjustment = accuracy >= 0.8 ? 1 : accuracy <= 0.4 ? -1 : 0;
  }
  target = clampBand(target + performanceAdjustment + (data.settings.difficultyAdjustment ?? 0));
  return { target, sufficient, performanceAdjustment, events };
}

function weakIds(events: readonly AttemptEvent[], data: AppData) {
  const weak = new Set(Object.values(data.progress).filter(progress => progress.lastRating === 'again').map(progress => progress.wordId));
  const seen = new Set<string>();
  for (const event of events) {
    if (seen.has(event.wordId)) continue;
    seen.add(event.wordId);
    if (event.result === 'incorrect') weak.add(event.wordId);
  }
  return weak;
}

/** Existing engine owns the daily quota; recommendation only orders eligible inputs. */
export function recommendStudyQueue(words: readonly LearningWord[], data: AppData, now = Date.now(), skippedIds: readonly string[] = []): string[] {
  const skipped = new Set(skippedIds);
  const eligible = eligibleWords(words, data).filter(word => !skipped.has(word.id));
  const { target, events } = targetFor(eligible, data, now);
  const weak = weakIds(events, data);
  const distance = (word: LearningWord) => {
    const band = wordFrequencyBand(word);
    return band === null ? 20 : Math.abs(band - target) + (band > target ? 0.25 : 0);
  };
  const ordered = [...eligible].sort((a, b) => distance(a) - distance(b)
    || (b.frequency?.zipf ?? -1) - (a.frequency?.zipf ?? -1));
  const queue = getStudyQueue(ordered.map(word => word.id), data, now);
  const due = queue.filter(id => Boolean(data.progress[id]));
  const fresh = queue.filter(id => !data.progress[id]);
  due.sort((a, b) => Number(weak.has(b)) - Number(weak.has(a)) || data.progress[a].dueAt - data.progress[b].dueAt || a.localeCompare(b));
  return [...due, ...fresh];
}

export function recommendationReason(word: LearningWord, data: AppData, now = Date.now()): string {
  const progress = data.progress[word.id];
  const pool = learningWords.some(candidate => candidate.id === word.id) ? eligibleWords(learningWords, data) : [word];
  const { target, sufficient, performanceAdjustment, events } = targetFor(pool, data, now);
  if (progress && progress.dueAt <= now) return weakIds(events, data).has(word.id) ? '到期复习 · 优先巩固' : '到期复习 · 按记忆计划安排';
  if (progress) return '已学词汇 · 保留原有复习计划';
  const band = wordFrequencyBand(word);
  if (band === null) return '新词 · 该词暂缺可用的通用词频数据';
  if (data.settings.difficultyAdjustment) return `新词 · 按你的练习难度偏好，${FREQUENCY_BANDS[band].label}`;
  if (sufficient && performanceAdjustment) return `新词 · 参考近期独立拼写表现，${FREQUENCY_BANDS[band].label}`;
  return `新词 · ${data.settings.vocabularyProfile?.status === 'completed' ? '参考测评起点' : '从常用词起步'}，${FREQUENCY_BANDS[band].label}${band === target ? '' : '（当前词库中相近分组）'}`;
}
