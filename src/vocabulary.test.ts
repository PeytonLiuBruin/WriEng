import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { learningWords, type LearningWord, type RouteId } from './content';
import PlacementTest from './PlacementTest';
import { createAttempt, defaultData, DAY_MS, scheduleAttempt, type AppData, type AttemptEvent } from './engine';
import { assessVocabulary, nextPlacementWord, recommendStudyQueue, recommendationReason, skippedVocabularyProfile, vocabularySummary, wordFrequencyBand, type PlacementAnswer } from './vocabulary';

const NOW = Date.UTC(2026, 9, 20, 12);
afterEach(cleanup);
const zipfs = [5.9, 5.1, 4.5, 3.8, 2.9];
function word(id: string, band: number | null, routes: RouteId[] = ['daily']): LearningWord {
  return {
    id, term: id, kind: 'curated', routes, meaningZh: `meaning ${id}`, definitionEn: `definition for ${id}`,
    frequency: { zipf: band === null ? null : zipfs[band] },
  } as LearningWord;
}
const pool = Array.from({ length: 5 }, (_, band) => Array.from({ length: 20 }, (_, index) => word(`band${band}-word${index}`, band))).flat();

function simulate(maxKnownBand: number) {
  const answers: PlacementAnswer[] = [];
  while (answers.length < 10) {
    const current = nextPlacementWord(pool, answers)!;
    const band = wordFrequencyBand(current)!;
    answers.push({ wordId: current.id, band, correct: band <= maxKnownBand });
  }
  return answers;
}

function profileData(band = 1): AppData {
  const data = defaultData();
  data.settings.dailyNewLimit = 3;
  data.settings.selectedDecks = ['daily'];
  data.settings.vocabularyProfile = { ...skippedVocabularyProfile(NOW), status: 'completed', targetBand: band,
    rangeLow: Math.max(0, band - 1), rangeHigh: Math.min(4, band + 1), sampleSize: 10, correct: 6, bandsTested: [0, 2, 4] };
  return data;
}

function addHistory(data: AppData, words: LearningWord[], extra: Partial<AttemptEvent> = {}, count = 6) {
  for (let index = 0; index < count; index++) {
    const current = words[index % words.length];
    const event = { ...createAttempt({ id: `history-${index}`, wordId: current.id, mode: 'typed', rating: 'good',
      result: 'correct', answer: current.term, roundId: `round-${index}`, at: NOW - 2 * DAY_MS + index * 1000, timezone: 'UTC' }), ...extra };
    data.events.push(event);
    data.progress[current.id] = { ...scheduleAttempt(data.progress[current.id], event), dueAt: NOW + DAY_MS };
  }
}

describe('a short frequency-based placement sample', () => {
  it('uses actual frequency estimates and keeps missing/zero/invalid estimates unknown', () => {
    expect(zipfs.map((_, band) => wordFrequencyBand(word(`w${band}`, band)))).toEqual([0, 1, 2, 3, 4]);
    for (const zipf of [null, 0, NaN, -1]) {
      expect(wordFrequencyBand({ ...word('unknown', null), frequency: { zipf } } as LearningWord)).toBeNull();
    }
    expect(nextPlacementWord([word('unknown', null)], [])).toBeUndefined();
  });

  it('covers three separated groups before adapting and never repeats a headword or sense', () => {
    const answers = simulate(2);
    expect(answers.slice(0, 3).map(answer => answer.band)).toEqual([0, 2, 4]);
    expect(answers.slice(3).map(answer => answer.band)).toEqual([3, 2, 3, 2, 3, 2, 3]);
    expect(new Set(answers.map(answer => answer.wordId)).size).toBe(10);
    expect(nextPlacementWord(pool, answers)).toBeUndefined();
    const repeated = { ...word('other-sense', 4), term: pool[0].term };
    const next = nextPlacementWord([pool[0], repeated, word('different', 4)], [{ wordId: pool[0].id, band: 0, correct: true }]);
    expect(next?.id).toBe('different');
  });

  it('gives conservative, bounded starting groups across all-wrong, intermediate and strong samples', () => {
    expect(assessVocabulary(simulate(-1), NOW)).toMatchObject({ targetBand: 0, sampleSize: 10, correct: 0 });
    expect(assessVocabulary(simulate(2), NOW).targetBand).toBe(2);
    const strong = assessVocabulary(simulate(4), NOW);
    expect(strong).toMatchObject({ targetBand: 4, rangeLow: 3, rangeHigh: 4, correct: 10, assessedAt: NOW });
    expect(vocabularySummary(strong).confidence).toContain('有限样本');
    expect(strong).not.toHaveProperty('vocabularySize');
  });

  it('refuses a one-question level claim, narrow coverage and duplicate questions', () => {
    expect(() => assessVocabulary([{ wordId: 'one', band: 4, correct: true }], NOW)).toThrow();
    expect(() => assessVocabulary(simulate(2).map(answer => ({ ...answer, band: 2 })), NOW)).toThrow();
    expect(() => assessVocabulary(simulate(2).map(answer => ({ ...answer, wordId: 'same' })), NOW)).toThrow();
    expect(skippedVocabularyProfile(NOW)).toMatchObject({ status: 'skipped', sampleSize: 0, correct: 0, targetBand: 1, rangeLow: 0, rangeHigh: 4 });
  });
});

describe('recommendations within the existing study scheduler', () => {
  it('keeps weak due reviews first, applies daily quota and skips, and excludes learned words from disabled libraries', () => {
    const data = profileData(2);
    const weak = word('weak', 0), overdue = word('overdue', 4), excluded = word('outside', 2, ['gre']);
    const fresh = [word('fresh-match', 2), word('fresh-other', 1), word('fresh-skipped', 2)];
    for (const [current, rating, dueAt] of [[weak, 'again', NOW - 1000], [overdue, 'good', NOW - 8 * DAY_MS], [excluded, 'again', NOW - 9 * DAY_MS]] as const) {
      const event = createAttempt({ wordId: current.id, mode: 'typed', rating, answer: current.term, at: NOW - 10 * DAY_MS });
      data.progress[current.id] = { ...scheduleAttempt(undefined, event), dueAt };
    }
    const introducedToday = word('already-seen-today', 2);
    const event = createAttempt({ wordId: introducedToday.id, mode: 'typed', rating: 'good', at: NOW, answer: introducedToday.term });
    data.progress[introducedToday.id] = { ...scheduleAttempt(undefined, event), dueAt: NOW + DAY_MS };
    data.settings.dailyNewLimit = 2;

    const queue = recommendStudyQueue([excluded, overdue, weak, introducedToday, ...fresh], data, NOW, ['fresh-skipped']);
    expect(queue).toEqual(['weak', 'overdue', 'fresh-match']);
    expect(recommendationReason(weak, data, NOW)).toContain('优先巩固');
    expect(recommendStudyQueue([weak, overdue, ...fresh], data, NOW, ['weak', 'overdue', ...fresh.map(item => item.id)])).toEqual([]);
  });

  it('starts near the assessed group and honors a bounded manual difficulty adjustment', () => {
    const data = profileData(2);
    const words = [word('easy', 1), word('match', 2), word('challenge', 3), word('unknown', null)];
    data.settings.dailyNewLimit = 1;
    expect(recommendStudyQueue(words, data, NOW)).toEqual(['match']);
    data.settings.difficultyAdjustment = 1;
    expect(recommendStudyQueue(words, data, NOW)).toEqual(['challenge']);
    data.settings.difficultyAdjustment = -1;
    expect(recommendStudyQueue(words, data, NOW)).toEqual(['easy']);
  });

  it('adjusts only after enough recent independent typed attempts across several words', () => {
    const data = profileData(1);
    const practiced = [word('old-a', 1), word('old-b', 1), word('old-c', 1)];
    const fresh = [word('base', 1), word('next', 2)];
    data.settings.dailyNewLimit = 1;
    addHistory(data, practiced, {}, 5);
    expect(recommendStudyQueue([...practiced, ...fresh], data, NOW)).toEqual(['base']);
    const sixth = createAttempt({ id: 'sixth', roundId: 'sixth', wordId: practiced[2].id, mode: 'typed', rating: 'good', result: 'correct', answer: practiced[2].term, at: NOW - DAY_MS });
    data.events.push(sixth);
    expect(recommendStudyQueue([...practiced, ...fresh], data, NOW)).toEqual(['next']);
    const narrow = profileData(1);
    narrow.settings.dailyNewLimit = 1;
    addHistory(narrow, [practiced[0]]);
    expect(recommendStudyQueue([practiced[0], ...fresh], narrow, NOW)).toEqual(['base']);
  });

  it.each([
    { hinted: true }, { revealed: true }, { retry: true, firstAttempt: false },
    { mode: 'handwriting' as const, result: 'self-rated' as const, answer: null },
    { answer: 'not-the-word' }, { at: NOW - 40 * DAY_MS },
  ])('does not call aided, self-rated, invalid or old evidence spelling mastery: %j', extra => {
    const data = profileData(1);
    const practiced = [word('old-a', 1), word('old-b', 1), word('old-c', 1)];
    data.settings.dailyNewLimit = 1;
    addHistory(data, practiced, extra);
    expect(recommendStudyQueue([...practiced, word('base', 1), word('next', 2)], data, NOW)).toEqual(['base']);
  });

  it('moves fresh practice toward a more common group after sufficient independent errors', () => {
    const data = profileData(2);
    const practiced = [word('old-a', 2), word('old-b', 2), word('old-c', 2)];
    data.settings.dailyNewLimit = 1;
    addHistory(data, practiced, { result: 'incorrect', answer: 'wrong' });
    expect(recommendStudyQueue([...practiced, word('easier', 1), word('base', 2)], data, NOW)).toEqual(['easier']);
  });

  it('does not treat several senses of one headword as evidence from several different words', () => {
    const data = profileData(1);
    const senses = [word('sense-a', 1), word('sense-b', 1), word('sense-c', 1)].map(current => ({ ...current, term: 'same-headword' }));
    data.settings.dailyNewLimit = 1;
    addHistory(data, senses);
    expect(recommendStudyQueue([...senses, word('base', 1), word('next', 2)], data, NOW)).toEqual(['base']);
  });

  it('explains an adjustment from sufficient real independent word evidence', () => {
    const data = profileData(1);
    const practiced = learningWords.filter(current => current.routes.includes('daily') && wordFrequencyBand(current) === 1).filter((current, index, all) => all.findIndex(other => other.term === current.term) === index).slice(0, 3);
    const fresh = learningWords.find(current => current.routes.includes('daily') && wordFrequencyBand(current) === 2)!;
    expect(practiced).toHaveLength(3);
    addHistory(data, practiced);
    expect(recommendationReason(fresh, data, NOW)).toContain('近期独立拼写表现');
  });
});

describe('placement consent and typed-recall flow', () => {
  it('holds the complete sample locally until the user explicitly applies the result', async () => {
    const onComplete = vi.fn().mockResolvedValue(undefined);
    const onLater = vi.fn().mockResolvedValue(undefined);
    render(createElement(PlacementTest, { onComplete, onLater }));
    expect(screen.getByRole('dialog').getAttribute('aria-modal')).toBe('true');
    fireEvent.click(screen.getByTestId('placement-start'));
    for (let index = 0; index < 10; index++) fireEvent.click(screen.getByTestId('placement-unknown'));
    expect(screen.getByTestId('placement-result')).toBeTruthy();
    expect(onComplete).not.toHaveBeenCalled();
    expect(onLater).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('placement-apply'));
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect(onComplete.mock.calls[0][0]).toMatchObject({ status: 'completed', sampleSize: 10, correct: 0 });
    expect(onComplete.mock.calls[0][0].bandsTested.length).toBeGreaterThanOrEqual(3);
  });

  it('scores normalized typed answers rather than a self-reported familiarity choice', async () => {
    const onComplete = vi.fn().mockResolvedValue(undefined);
    render(createElement(PlacementTest, { onComplete, onLater: vi.fn().mockResolvedValue(undefined) }));
    fireEvent.click(screen.getByTestId('placement-start'));
    const id = screen.getByTestId('placement-question').getAttribute('data-word-id');
    const term = learningWords.find(current => current.id === id)!.term;
    fireEvent.change(screen.getByTestId('placement-answer'), { target: { value: `  ${term.toUpperCase()}  ` } });
    fireEvent.submit(screen.getByTestId('placement-answer').closest('form')!);
    for (let index = 1; index < 10; index++) fireEvent.click(screen.getByTestId('placement-unknown'));
    fireEvent.click(screen.getByTestId('placement-apply'));
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect(onComplete.mock.calls[0][0].correct).toBe(1);
  });

  it('lets a user leave an unfinished retest without applying or replacing the existing profile', async () => {
    const previous = assessVocabulary(simulate(2), NOW);
    const onComplete = vi.fn().mockResolvedValue(undefined);
    const onLater = vi.fn().mockResolvedValue(undefined);
    render(createElement(PlacementTest, { onComplete, onLater, existingProfile: previous }));
    fireEvent.click(screen.getByTestId('placement-start'));
    fireEvent.click(screen.getByTestId('placement-unknown'));
    fireEvent.click(screen.getByTestId('placement-later'));
    await waitFor(() => expect(onLater).toHaveBeenCalledTimes(1));
    expect(onComplete).not.toHaveBeenCalled();
    expect(previous).toMatchObject({ targetBand: 2, sampleSize: 10 });
  });
});
