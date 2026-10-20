import 'fake-indexeddb/auto';
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type CyberStudy from './CyberStudy';
import App from './App';
import { DAY_MS, defaultData, type AppData, type StudySession } from './engine';
import * as storage from './storage';

type StudyProps = Parameters<typeof CyberStudy>[0];
const child = vi.hoisted(() => ({ current: null as StudyProps | null }));

vi.mock('./content', () => {
  const words = [
    { id: 'shared', term: 'adapt', kind: 'curated', routes: ['academic', 'science'], order: 0 },
    { id: 'daily-only', term: 'parcel', kind: 'curated', routes: ['daily'], order: 1 },
    { id: 'academic-only', term: 'derive', kind: 'curated', routes: ['academic'], order: 2 },
    { id: 'science-only', term: 'atom', kind: 'curated', routes: ['science'], order: 3 },
  ];
  return {
    learningWords: words,
    findLearningWord: (id: string) => words.find(word => word.id === id),
    compareByGeneralFrequency: (a: { order: number }, b: { order: number }) => a.order - b.order,
    learningContentStats: { total: 4, curated: 4, core: 0 },
    routes: ['daily', 'academic', 'science'].map(id => ({ id, label: id })),
  };
});

// A stateful child makes a missing React key reset observable independently of
// persisted session fields, without involving canvas/speech in queue tests.
vi.mock('./CyberStudy', () => ({
  normalizeAnswer: (value: string) => value.trim().toLowerCase(),
  WordPresentation: () => null,
  default: function Study(props: StudyProps) {
    child.current = props;
    const [draft, setDraft] = useState(String(props.session.response || ''));
    return <section data-testid="practice-card" data-session={props.session.id}>
      <span data-testid="practice-word">{props.word.id}</span>
      <input aria-label="local draft" value={draft} onChange={event => setDraft(event.target.value)} />
    </section>;
  },
}));

vi.mock('./pwa', () => ({
  registerOffline: async () => ({ applyUpdate() {}, async checkForUpdate() {}, dispose() {} }),
}));

beforeEach(async () => {
  child.current = null;
  await storage.closeStorage();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('wrieng-learning');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
  await storage.resetData();
});

afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  await storage.closeStorage();
});

function dirtySession(word = 'daily-only'): StudySession {
  const now = Date.now();
  return {
    id: 'previous-session', queue: [word], index: 0, stage: 'feedback', mode: 'typed',
    startedAt: now - 1000, presentedAt: now - 900, submittedAt: now - 100,
    response: 'old submitted answer', hasInk: true, hinted: true, revealed: true,
    retry: true, forgot: true, correct: true, answer: 'stale answer', draft: 'stale draft',
    nextWordIds: ['science-only'], skippedWordIds: ['academic-only'],
  };
}

async function mount(data: AppData) {
  await storage.saveData(data);
  render(<App />);
  await screen.findByTestId('practice-card');
  await waitFor(() => expect((document.querySelector('.cyber-tools-button') as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(document.querySelector('.cyber-tools-button')!);
  await screen.findByRole('dialog');
}

async function settled() {
  await waitFor(() => expect((document.querySelector('.cyber-tools-button') as HTMLButtonElement).disabled).toBe(false));
  return storage.loadData();
}

function expectClean(session: StudySession | null) {
  expect(session).toMatchObject({
    index: 0, response: '', hasInk: false, hinted: false, revealed: false,
    retry: false, forgot: false, correct: false, nextWordIds: [], skippedWordIds: [],
  });
  for (const field of ['submittedAt', 'answer', 'draft', 'pendingResult']) expect(session).not.toHaveProperty(field);
}

describe('changing practice libraries and queue settings', () => {
  it('repairs and persists an old out-of-library active question on load without discarding history', async () => {
    const history = await storage.recordAttempt({
      id: 'original-review', wordId: 'daily-only', mode: 'typed', rating: 'good', result: 'correct',
      answer: 'parcel', at: Date.now() - 14 * DAY_MS, timezone: 'UTC',
    });
    await mount({ ...history, settings: { ...history.settings, selectedDecks: ['academic'] }, session: dirtySession() });
    const saved = await storage.loadData();

    expect(saved.settings.selectedDecks).toEqual(['academic']);
    expect(saved.session?.queue).toEqual(['shared', 'academic-only']);
    expect(child.current?.word.id).toBe('shared');
    expect(saved.session?.id).not.toBe('previous-session');
    expectClean(saved.session);
    expect(saved.events).toEqual(history.events);
    expect(saved.progress).toEqual(history.progress);
  });

  it('immediately replaces an overdue old-library card while preserving its complete learning history', async () => {
    const history = await storage.recordAttempt({
      id: 'original-review', wordId: 'daily-only', mode: 'typed', rating: 'good', result: 'correct',
      answer: 'parcel', at: Date.now() - 14 * DAY_MS, timezone: 'UTC',
    });
    expect(history.progress['daily-only'].dueAt).toBeLessThan(Date.now());
    await mount({ ...history, settings: { ...history.settings, selectedDecks: [] }, session: dirtySession() });

    fireEvent.click(screen.getByRole('checkbox', { name: 'academic' }));
    const saved = await settled();

    expect(saved.settings.selectedDecks).toEqual(['academic']);
    expect(saved.session?.queue).toEqual(['shared', 'academic-only']);
    expect(child.current?.word.id).toBe('shared');
    expect(saved.session?.id).not.toBe('previous-session');
    expect(saved.session?.stage).toBe('study');
    expectClean(saved.session);
    expect(saved.events).toEqual(history.events);
    expect(saved.progress).toEqual(history.progress);
  });

  it('resets persisted and component-local answers even when two libraries share the same first word', async () => {
    const data = defaultData();
    await mount({ ...data, settings: { ...data.settings, selectedDecks: ['academic'] }, session: dirtySession('shared') });
    fireEvent.change(screen.getByRole('textbox', { name: 'local draft' }), { target: { value: 'unsaved local answer' } });

    fireEvent.click(screen.getByRole('checkbox', { name: 'science' }));
    const saved = await settled();

    expect(saved.settings.selectedDecks).toEqual(['academic', 'science']);
    expect(saved.session?.queue[0]).toBe('shared');
    expect(saved.session?.id).not.toBe('previous-session');
    expectClean(saved.session);
    expect((screen.getByRole('textbox', { name: 'local draft' }) as HTMLInputElement).value).toBe('');
  });

  it('removes an unlearned current card immediately when the new-word limit is disabled', async () => {
    const data = defaultData();
    await mount({ ...data, session: dirtySession() });

    fireEvent.change(document.querySelector('.cyber-settings select')!, { target: { value: '0' } });
    const saved = await settled();

    expect(saved.settings.dailyNewLimit).toBe(0);
    expect(saved.session).toBeNull();
    expect(screen.queryByTestId('practice-card')).toBeNull();
    expect(screen.getByTestId('queue-done')).toBeTruthy();
    expect(saved.events).toEqual([]);
  });

  it('rejects late answer, grade and skip callbacks from the question replaced by a library switch', async () => {
    const data = defaultData();
    await mount({ ...data, settings: { ...data.settings, selectedDecks: [] }, session: dirtySession() });
    const previous = child.current!;
    fireEvent.click(screen.getByRole('checkbox', { name: 'academic' }));
    await settled();
    const current = child.current!;
    await act(async () => current.onSession({
      ...current.session, stage: 'feedback', response: current.word.term,
      submittedAt: Date.now(), correct: true,
    }));
    const before = await storage.loadData();

    await act(async () => {
      await previous.onSession({ ...previous.session, response: 'late old answer' });
      await previous.onGrade('good');
      await previous.onSkip();
    });

    expect(await storage.loadData()).toEqual(before);
    expect(before.session?.stage).toBe('feedback');
    expect(before.events).toEqual([]);
  });

  it('serializes rapid library changes against the last confirmed settings instead of losing a toggle', async () => {
    const data = defaultData();
    await mount({ ...data, settings: { ...data.settings, selectedDecks: [] }, session: dirtySession() });
    const save = storage.saveData;
    let releaseFirst: () => Promise<void> = async () => { throw new Error('first save was not started'); };
    vi.spyOn(storage, 'saveData').mockImplementationOnce(next => new Promise(resolve => {
      releaseFirst = async () => { resolve(await save(next)); };
    }));
    const academic = screen.getByRole('checkbox', { name: 'academic' }) as HTMLInputElement;
    const science = screen.getByRole('checkbox', { name: 'science' }) as HTMLInputElement;

    act(() => { academic.click(); science.click(); });
    await act(async () => releaseFirst());
    const saved = await settled();

    expect(saved.settings.selectedDecks).toEqual(['academic', 'science']);
    expect(saved.session?.queue).toEqual(['shared', 'academic-only', 'science-only']);
    expectClean(saved.session);
  });

  it('keeps the current answer and settings intact when the settings write fails', async () => {
    const data = defaultData();
    await mount({ ...data, settings: { ...data.settings, selectedDecks: [] }, session: dirtySession() });
    const before = await storage.loadData();
    vi.spyOn(storage, 'saveData').mockRejectedValueOnce(new Error('disk unavailable'));

    fireEvent.click(screen.getByRole('checkbox', { name: 'academic' }));
    await waitFor(() => expect(screen.getAllByRole('alert').some(element => element.textContent?.includes('disk unavailable'))).toBe(true));
    await settled();

    expect(await storage.loadData()).toEqual(before);
    expect((screen.getByRole('textbox', { name: 'local draft' }) as HTMLInputElement).value).toBe('old submitted answer');
  });

  it('preserves an unfinished answer when changing a display-only preference', async () => {
    const data = defaultData();
    await mount({ ...data, session: dirtySession() });
    const before = await storage.loadData();

    fireEvent.click(document.querySelector('.cyber-setting-row input[type="checkbox"]')!);
    const saved = await settled();

    expect(saved.settings.reducedMotion).toBe(true);
    expect(saved.session).toEqual(before.session);
    expect(saved.events).toEqual(before.events);
  });
});
