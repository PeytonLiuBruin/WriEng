import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowRight, Check, Download, RefreshCw, Search, Settings2, Upload, WifiOff, X } from 'lucide-react';
import { learningWords, findLearningWord, learningContentStats, routes, compareByGeneralFrequency, type LearningWord } from './content';
import { defaultData, localDay, type AppData, type StudySession, type Rating } from './engine';
import { loadData, saveData, recordAttempt, exportData, importData, getMigrationBackupInfo, exportMigrationBackup } from './storage';
import { registerOffline, type OfflineState, type OfflineControls } from './pwa';
import CyberStudy, { normalizeAnswer, WordPresentation } from './CyberStudy';
import PlacementTest from './PlacementTest';
import SoundSettings from './SoundSettings';
import PreviousWord from './PreviousWord';
import { useStudyShortcuts } from './study-shortcuts';
import { playStudySound, setStudySoundPreferences } from './study-audio';
import { recommendStudyQueue, recommendationReason, skippedVocabularyProfile, vocabularySummary } from './vocabulary';
import type { VocabularyProfile } from './engine';
import './learning-tools.css';

type DrawerTab = 'library' | 'settings' | 'records' | 'sources';
type SettingsPatch = Partial<AppData['settings']> | ((current: AppData['settings']) => Partial<AppData['settings']>);
const dateLabel = (at: number) => new Date(at).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const publicAsset = (path: string) => `${import.meta.env.BASE_URL}${path}`;
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
const introductionCache = new Map<string, string[]>();
function introductionIds(decks: string[]): string[] {
  const key = [...new Set(decks)].sort().join('|');
  const cached = introductionCache.get(key);
  if (cached) return cached;
  const selected = decks.length ? learningWords.filter(word => word.routes.some(route => decks.includes(route))) : [...learningWords];
  const ids = selected.sort((a, b) => Number(b.kind === 'curated') - Number(a.kind === 'curated') || compareByGeneralFrequency(a, b)).map(word => word.id);
  if (introductionCache.size >= 32) introductionCache.delete(introductionCache.keys().next().value!);
  introductionCache.set(key, ids);
  return ids;
}

/** Unknown imported IDs never become phantom words; known pending submissions stay intact. */
function recoverSession(data: AppData): AppData {
  const session = data.session;
  if (!session) return data;
  const eligible = new Set(eligibleIds(data));
  const manual = new Set(strings(session.nextWordIds));
  if (typeof session.manualWordId === 'string') manual.add(session.manualWordId);
  if (session.queue.slice(session.index).some(id => findLearningWord(id) && !eligible.has(id) && !manual.has(id))) {
    // Repair sessions saved by earlier versions after their library preference
    // changed. Past attempts remain intact; stale answers never move to a new word.
    const fresh = pendingQueue(data, Date.now(), null).slice(0, 100);
    return { ...data, session: fresh.length ? newSession(fresh, data, session.mode) : null };
  }
  const queue = session.queue.filter(id => findLearningWord(id));
  const index = session.queue.slice(0, session.index).filter(id => findLearningWord(id)).length;
  if (!queue.length) return { ...data, session: null };
  const currentKnown = Boolean(findLearningWord(session.queue[session.index]));
  const recovered: StudySession = { ...session, queue, index, stage: index >= queue.length ? 'done' : currentKnown ? session.stage : data.progress[queue[index]] ? 'recall' : 'study' };
  if (!currentKnown && index < queue.length) {
    // A response for an unknown imported sense must never be attached to its successor.
    Object.assign(recovered, { response: '', hasInk: false, hinted: false, revealed: false, retry: false, forgot: false, correct: false, presentedAt: Math.max(session.startedAt, Date.now()) });
    delete recovered.submittedAt;
  }
  return queue.length === session.queue.length && index === session.index && recovered.stage === session.stage ? data : { ...data, session: recovered };
}

function eligibleIds(data: AppData): string[] {
  // Keep all history, but practice only senses in the currently selected libraries.
  return introductionIds(data.settings.selectedDecks);
}
function skippedIds(session: StudySession | null, data: AppData, now: number): string[] {
  return session?.skipDay === localDay(now, data.settings.timezone) ? strings(session.skippedWordIds) : [];
}
function pendingQueue(data: AppData, now: number, session = data.session): string[] {
  return recommendStudyQueue(learningWords, data, now, skippedIds(session, data, now));
}
function newSession(queue: string[], data: AppData, mode: StudySession['mode'] = 'handwriting', manual = false): StudySession {
  const now = Date.now();
  return { id: crypto.randomUUID(), queue, index: 0, stage: manual ? 'study' : data.progress[queue[0]] ? 'recall' : 'study', mode, startedAt: now, presentedAt: now,
    response: '', hasInk: false, hinted: false, revealed: manual && Boolean(data.progress[queue[0]]), retry: false, forgot: false, correct: false, manualWordId: manual ? queue[0] : null, nextWordIds: [], skippedWordIds: [], skipDay: localDay(now, data.settings.timezone) };
}
function sameQuestion(expected: StudySession, current: StudySession | null): boolean {
  return Boolean(current && expected.id === current.id && expected.index === current.index && expected.queue[expected.index] === current.queue[current.index]);
}
/** Rebuild after a completed card, so newly due reviews join before fresh introductions. */
function advanceSession(data: AppData, session: StudySession, skip = false): StudySession {
  const now = Date.now();
  const skipped = [...new Set([...skippedIds(session, data, now), ...(skip ? [session.queue[session.index]] : [])])];
  const carried = { ...session, skippedWordIds: skipped, skipDay: localDay(now, data.settings.timezone) };
  const manual = strings(session.nextWordIds).filter(id => findLearningWord(id) && id !== session.queue[session.index]);
  const pending = [...new Set([...manual, ...pendingQueue(data, now, carried)])].slice(0, 100);
  const index = session.index + 1;
  const queue = [...session.queue.slice(0, index), ...pending];
  const manualFirst = manual[0] === pending[0] && pending.length > 0;
  const next: StudySession = { ...carried, queue, index, stage: pending.length ? manualFirst ? 'study' : data.progress[pending[0]] ? 'recall' : 'study' : 'done',
    response: '', hasInk: false, hinted: false, revealed: manualFirst && Boolean(data.progress[pending[0]]), retry: false, forgot: false, correct: false, presentedAt: now, manualWordId: manualFirst ? pending[0] : null, nextWordIds: manual.filter(id => id !== pending[0]) };
  delete next.submittedAt;
  if (queue.length > 1000 && pending.length) return { ...newSession(pending, data, session.mode, manualFirst), skippedWordIds: skipped, skipDay: carried.skipDay, nextWordIds: next.nextWordIds };
  return next;
}

export default function App() {
  const [data, setData] = useState<AppData>(defaultData);
  const dataRef = useRef(data);
  const [loaded, setLoaded] = useState(false);
  const [storageReady, setStorageReady] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const savingSettings = useRef(false);
  const settingsQueue = useRef<SettingsPatch[]>([]);
  const [settingsDraft, setSettingsDraft] = useState<AppData['settings'] | null>(null);
  const settingsDraftRef = useRef<AppData['settings'] | null>(null);
  const autoFailed = useRef(false);
  const [clock, setClock] = useState(Date.now());
  const [drawer, setDrawer] = useState(false);
  const [placementOpen, setPlacementOpen] = useState(false);
  const [backIndex, setBackIndex] = useState<number | null>(null);
  const [tab, setTab] = useState<DrawerTab>('settings');
  const [migrationBackup, setMigrationBackup] = useState(false);
  const [offline, setOffline] = useState<OfflineState>({ supported: true, online: navigator.onLine, status: 'checking', offlineReady: false, updateAvailable: false });
  const controls = useRef<OfflineControls | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [installEvent, setInstallEvent] = useState<(Event & { prompt: () => Promise<void> }) | null>(null);
  function accept(next: AppData) { const recovered = recoverSession(next); dataRef.current = recovered; setData(recovered); return recovered; }
  async function persist(next: AppData) { return accept(await saveData(next)); }

  useEffect(() => {
    let alive = true;
    loadData().then(async next => {
      if (!alive) return;
      const recovered = recoverSession(next);
      if (recovered.session !== next.session) next = await saveData(recovered);
      if (!alive) return;
      if (!next.settings.onboardingComplete && !next.settings.vocabularyProfile && !next.events.length && !Object.keys(next.progress).length && !next.session) setPlacementOpen(true);
      accept(next); setStorageReady(true); setLoaded(true);
      return getMigrationBackupInfo().then(info => { if (alive) setMigrationBackup(info.available); });
    })
      .catch(reason => { if (alive) { setError(`本地存储不可用：${reason.message}。请恢复浏览器存储权限后刷新，学习记录尚未确认保存。`); setLoaded(true); } });
    return () => { alive = false; };
  }, []);
  useEffect(() => { let alive = true; registerOffline(state => { if (alive) setOffline(state); }).then(control => { if (alive) controls.current = control; else control.dispose(); }); return () => { alive = false; controls.current?.dispose(); }; }, []);
  useEffect(() => { const refresh = () => setClock(Date.now()); const timer = window.setInterval(refresh, 15000); window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh); return () => { clearInterval(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); }; }, []);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 5500); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => { const handler = (event: Event) => { event.preventDefault(); setInstallEvent(event as Event & { prompt: () => Promise<void> }); }; window.addEventListener('beforeinstallprompt', handler); return () => window.removeEventListener('beforeinstallprompt', handler); }, []);
  useEffect(() => { document.documentElement.dataset.motion = data.settings.reducedMotion ? 'reduced' : 'normal'; }, [data.settings.reducedMotion]);
  useEffect(() => { setStudySoundPreferences(data.settings); }, [data.settings.soundEnabled, data.settings.soundVolume]);
  useEffect(() => { setBackIndex(null); }, [data.session?.id, data.session?.index]);

  // New learners can take a short placement or explicitly continue; restored work stays intact.
  useEffect(() => {
    if (!loaded || !storageReady || busy || drawer || placementOpen || backIndex !== null || lock.current || autoFailed.current) return;
    const current = dataRef.current;
    if (current.session && current.session.stage !== 'done') return;
    const queue = pendingQueue(current, clock).slice(0, 100);
    if (!queue.length) return;
    lock.current = true; setBusy(true);
    const session = { ...newSession(queue, current, current.session?.mode), skippedWordIds: skippedIds(current.session, current, clock) };
    persist({ ...current, session }).catch(reason => { autoFailed.current = true; setError(`无法准备并保存学习队列：${reason.message}。请重试。`); }).finally(() => { lock.current = false; setBusy(false); });
  }, [loaded, storageReady, busy, drawer, placementOpen, backIndex, clock, data]);

  async function saveSession(session: StudySession) {
    if (!storageReady) throw new Error('本地存储尚未就绪');
    // A late callback from a replaced card must never restore its answer or queue.
    if (!sameQuestion(session, dataRef.current.session)) return;
    if (lock.current) throw new Error('上一次保存尚未完成，请稍后重试');
    lock.current = true; setBusy(true);
    if (session.stage === 'feedback' && dataRef.current.session?.stage !== 'feedback') playStudySound('submit', dataRef.current.settings);
    try { await persist({ ...dataRef.current, session }); }
    catch (reason) { setError(`会话保存失败：${(reason as Error).message}`); throw reason; }
    finally { lock.current = false; setBusy(false); }
  }
  async function grade(rating: Rating, expected: StudySession) {
    if (lock.current || !storageReady) return;
    const current = dataRef.current, session = current.session;
    if (!session || !sameQuestion(expected, session) || session.stage !== 'feedback') return;
    const word = findLearningWord(session.queue[session.index]);
    if (!word) return;
    lock.current = true; setBusy(true);
    try {
      const at = Date.now();
      const correct = session.mode === 'typed' && !session.forgot && normalizeAnswer(String(session.response || '')) === normalizeAnswer(word.term);
      const validHand = session.mode === 'handwriting' && Boolean(session.hasInk) && !session.forgot;
      playStudySound('grade', current.settings);
      const safeRating = session.hinted || session.revealed || session.retry || session.forgot || (!correct && !validHand) ? 'again' : rating;
      const next = await recordAttempt({ id: `${session.id}:${session.index}`, wordId: word.id, sessionId: session.id, roundId: `${session.id}:${session.index}`, mode: session.mode, rating: safeRating,
        result: session.mode === 'handwriting' ? 'self-rated' : correct ? 'correct' : 'incorrect', hinted: Boolean(session.hinted), revealed: Boolean(session.revealed || session.forgot), retry: Boolean(session.retry),
        startedAt: Math.min(Number(session.presentedAt || session.startedAt), at), submittedAt: Math.min(Number(session.submittedAt || at), at), at, timezone: current.settings.timezone,
        answer: session.mode === 'typed' ? String(session.response || '') : undefined, hasInk: Boolean(session.hasInk) });
      // If the session save fails, retrying this stable event key remains idempotent.
      await persist({ ...next, session: advanceSession(next, session) });
      setClock(Date.now());
    } catch (reason) { setError(`这次记录尚未确认保存：${(reason as Error).message}。请重试，同一事件不会重复计分。`); throw reason; }
    finally { lock.current = false; setBusy(false); }
  }
  async function skip(expected: StudySession) {
    if (lock.current || !sameQuestion(expected, dataRef.current.session)) return;
    lock.current = true; setBusy(true);
    playStudySound('skip', dataRef.current.settings);
    try { const current = dataRef.current; await persist({ ...current, session: advanceSession(current, current.session!, true) }); setToast('已略过，没有增加学习或掌握记录。'); }
    catch (reason) { setError(`尚未保存略过操作：${(reason as Error).message}`); }
    finally { lock.current = false; setBusy(false); }
  }
  function closePrevious() {
    playStudySound('back', dataRef.current.settings);
    setBackIndex(null);
  }
  async function showPrevious() {
    if (lock.current || !storageReady || drawer || placementOpen) return;
    const current = dataRef.current.session;
    if (!current) return;
    let candidate = (backIndex ?? current.index) - 1;
    while (candidate >= 0 && !findLearningWord(current.queue[candidate])) candidate -= 1;
    if (candidate < 0) { setToast('本轮还没有上一词。'); return; }
    playStudySound('back', dataRef.current.settings);
    // Looking up the same current sense is assistance, never independent recall.
    if (current.stage === 'recall' && current.queue[candidate] === current.queue[current.index] && !current.revealed) {
      try { await saveSession({ ...current, revealed: true }); } catch { return; }
    }
    setBackIndex(candidate);
  }
  useStudyShortcuts({
    enabled: loaded && storageReady && !busy && !drawer && !placementOpen,
    onSkip: () => {
      if (backIndex !== null) closePrevious();
      else {
        const current = dataRef.current.session;
        if (current && current.stage !== 'done') void skip(current);
      }
    },
    onBack: () => { void showPrevious(); },
  });
  async function savePlacement(profile: VocabularyProfile) {
    if (!storageReady || lock.current) throw new Error('请等当前保存完成后再试。');
    lock.current = true; setBusy(true);
    try {
      const current = dataRef.current;
      const next: AppData = { ...current, settings: { ...current.settings, vocabularyProfile: profile, onboardingComplete: true } };
      if (profile.status === 'completed') {
        const queue = pendingQueue(next, Date.now(), null).slice(0, 100);
        next.session = queue.length ? newSession(queue, next, current.session?.mode) : null;
      }
      playStudySound('grade', next.settings);
      await persist(next);
      setBackIndex(null); setPlacementOpen(false); setClock(Date.now());
      autoFailed.current = false;
    } finally { lock.current = false; setBusy(false); }
  }
  async function deferPlacement() {
    if (dataRef.current.settings.vocabularyProfile) { setPlacementOpen(false); return; }
    await savePlacement(skippedVocabularyProfile(Date.now()));
  }
  async function settings(patch: SettingsPatch) {
    if (!storageReady || (lock.current && !savingSettings.current)) return;
    const desired = settingsDraftRef.current ?? dataRef.current.settings;
    settingsDraftRef.current = { ...desired, ...(typeof patch === 'function' ? patch(desired) : patch) };
    setSettingsDraft(settingsDraftRef.current);
    settingsQueue.current.push(patch);
    if (savingSettings.current) return;
    savingSettings.current = true;
    lock.current = true; setBusy(true);
    try {
      // Serialize writes and apply queued toggles to the last confirmed settings.
      // Rapid changes cannot overwrite each other with an earlier render's values.
      while (settingsQueue.current.length) {
        const current = dataRef.current;
        let nextSettings = current.settings;
        for (const update of settingsQueue.current.splice(0)) {
          nextSettings = { ...nextSettings, ...(typeof update === 'function' ? update(nextSettings) : update) };
        }
        const deckKey = (decks: string[]) => [...new Set(decks)].sort().join('|');
        const refreshQueue = deckKey(nextSettings.selectedDecks) !== deckKey(current.settings.selectedDecks)
          || nextSettings.dailyNewLimit !== current.settings.dailyNewLimit || nextSettings.timezone !== current.settings.timezone
          || (nextSettings.difficultyAdjustment ?? 0) !== (current.settings.difficultyAdjustment ?? 0);
        const next = { ...current, settings: nextSettings };
        if (refreshQueue) {
          const queue = pendingQueue(next, Date.now(), null).slice(0, 100);
          // A fresh identity also clears component-local answer/ink when the
          // selected libraries happen to introduce the same first word.
          next.session = queue.length ? newSession(queue, next, current.session?.mode) : null;
        }
        await persist(next);
        autoFailed.current = false;
      }
    }
    catch (reason) { setError(`设置尚未保存：${(reason as Error).message}`); }
    finally { savingSettings.current = false; settingsQueue.current = []; settingsDraftRef.current = null; setSettingsDraft(null); lock.current = false; setBusy(false); }
  }
  async function changeTab(next: DrawerTab) {
    if (next === 'library' && dataRef.current.session?.stage === 'recall' && !dataRef.current.session.revealed) {
      try { await saveSession({ ...dataRef.current.session, revealed: true }); }
      catch { return; }
    }
    setTab(next);
  }
  async function addNext(word: LearningWord) {
    if (lock.current || !storageReady) return;
    lock.current = true; setBusy(true);
    try {
      const current = dataRef.current, session = current.session;
      if (session && session.stage !== 'done') {
        if (session.queue[session.index] === word.id) return;
        await persist({ ...current, session: { ...session, nextWordIds: [word.id, ...strings(session.nextWordIds).filter(id => id !== word.id)].slice(0, 20) } });
        setToast('已加入下一词。先完成当前回忆，再学习所选词。');
      } else { await persist({ ...current, session: newSession([word.id], current, session?.mode, true) }); setToast('已准备所选词。'); }
      setDrawer(false);
    } catch (reason) { setError(`所选词尚未保存：${(reason as Error).message}`); }
    finally { lock.current = false; setBusy(false); }
  }
  function downloadJson(json: string, filename: string) { const url = URL.createObjectURL(new Blob([json], { type: 'application/json' })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  async function download() { try { downloadJson(await exportData(), `WriEng-backup-${localDay(Date.now(), dataRef.current.settings.timezone)}.json`); setToast('已导出学习记录、计划与设置。'); } catch (reason) { setError(`导出失败：${(reason as Error).message}`); } }
  async function upload(file: File | undefined) {
    if (!file || lock.current) return;
    lock.current = true; setBusy(true);
    try { if (file.size > 100000000) throw new Error('文件超过 100MB'); const next = recoverSession(await importData(await file.text())); await persist(next); setMigrationBackup((await getMigrationBackupInfo()).available); autoFailed.current = false; setToast('备份已校验并合并；重复事件不会重复计分。'); }
    catch (reason) { setError(`导入未完成：${(reason as Error).message}`); }
    finally { if (fileInput.current) fileInput.current.value = ''; lock.current = false; setBusy(false); }
  }
  async function downloadMigration() { try { const json = await exportMigrationBackup(); if (json) downloadJson(json, `WriEng-before-FSRS-${localDay(Date.now(), dataRef.current.settings.timezone)}.json`); else setToast('没有升级前快照。'); } catch (reason) { setError(`旧快照导出失败：${(reason as Error).message}`); } }

  const session = data.session;
  const previousWord = session && backIndex !== null ? findLearningWord(session.queue[backIndex]) : undefined;
  const word = session && session.stage !== 'done' ? findLearningWord(session.queue[session.index]) : undefined;
  const today = localDay(clock, data.settings.timezone);
  const todayCount = data.events.filter(event => event.localDay === today).length;
  const eligible = new Set(eligibleIds(data));
  const due = Object.values(data.progress).filter(progress => eligible.has(progress.wordId) && progress.dueAt <= clock).length;
  const nextDue = Object.values(data.progress).filter(progress => eligible.has(progress.wordId) && progress.dueAt > clock).sort((a, b) => a.dueAt - b.dueAt)[0]?.dueAt;
  const preferences = settingsDraft ?? data.settings;
  const profileSummary = preferences.vocabularyProfile ? vocabularySummary(preferences.vocabularyProfile) : null;
  const settingsDisabled = busy && !savingSettings.current;
  const offlineLabel = offline.offlineReady ? offline.online ? '离线已就绪' : '离线学习中' : offline.status === 'development' ? '本机预览' : offline.status === 'error' ? '离线缓存未就绪' : offline.online ? '准备离线中' : '离线缓存未就绪';
  return <div className="cyber-shell">
    <a href="#study-main" className="skip-link">跳到学习内容</a>
    <div className="cyber-workspace" inert={drawer || placementOpen}>
      <header className="cyber-header"><a className="cyber-brand" href={import.meta.env.BASE_URL} aria-label="WriEng 学词">WRI<span>ENG</span><i /></a><div className="cyber-header-status"><span className={`cyber-online ${offline.offlineReady ? 'is-ready' : ''}`}>{!offline.online && <WifiOff size={13} />}{offlineLabel}</span><span>今日 {todayCount} 次回忆</span></div><button type="button" className="cyber-tools-button" onClick={() => { setTab('settings'); setDrawer(true); }} disabled={!loaded || busy}><Settings2 size={18} /><span>词库与设置</span></button></header>
      {!offline.online && <div className="cyber-status-banner">{offline.offlineReady ? '应用与词库已缓存，可继续学习。设备语音取决于本机声音。' : '当前离线，首次缓存尚未确认完成。'}</div>}
      {offline.updateAvailable && <div className="cyber-status-banner">有新版本。当前学习阶段会保留。<button type="button" onClick={() => controls.current?.applyUpdate()}>更新应用 <RefreshCw size={14} /></button></div>}
      <main className="cyber-main" id="study-main" data-testid="study-main">
        {error && <div className="cyber-error" role="alert"><span>{error}</span><button type="button" aria-label="关闭错误提示" onClick={() => setError('')}><X size={17} /></button>{autoFailed.current && <button type="button" onClick={() => { autoFailed.current = false; setClock(Date.now()); }}>重试保存</button>}</div>}
        {previousWord && <PreviousWord word={previousWord} onClose={closePrevious} onOlder={() => { void showPrevious(); }} hasOlder={Boolean(backIndex && backIndex > 0)} />}
        <div hidden={Boolean(previousWord)} data-current-practice>
        {!loaded ? <div className="cyber-loading" role="status">正在打开你的学习进度…</div> : !storageReady ? <section className="cyber-empty"><h1>先恢复本地存储</h1><p>浏览器尚未允许保存进度。恢复权限后刷新即可继续。</p></section> : session && word ? <CyberStudy key={`${session.id}:${session.index}`} data={data} session={session} word={word} busy={busy} onSession={saveSession} onGrade={rating => grade(rating, session)} onSkip={() => skip(session)} recommendation={session.manualWordId === word.id ? '手动选词 · 按你的选择练习' : recommendationReason(word, data, clock)} />
          : busy ? <div className="cyber-loading" role="status">正在准备下一词…</div> : <section className="cyber-empty" data-testid="queue-done"><span className="cyber-kicker">ALL CLEAR</span><Check size={36} /><h1>今天的队列已完成</h1><p>{nextDue ? `下次复习：${dateLabel(nextDue)}。到期后会自动出现在这里。` : '可以休息一下，也可以在词库里挑一个词。'}</p><button type="button" className="cyber-secondary" onClick={() => { setTab('library'); setDrawer(true); }}>打开词库 <ArrowRight size={17} /></button></section>}
        </div>
        {!previousWord && session && <nav className="study-navigation" aria-label="练习导航"><button type="button" className="cyber-text-button" data-testid="study-back" disabled={busy || session.index < 1} onClick={() => { void showPrevious(); }}>上一词</button><span className="study-shortcut-hint"><kbd>D</kbd> 略过 · <kbd>B</kbd> 上一词<span className="shortcut-meaning">略过不计掌握；回看不重复计数</span></span></nav>}
        <footer className="cyber-study-footer"><span>看 → 隐藏 → 回忆 → 下一词</span><span>{due ? `${due} 个到期词优先` : '自动安排复习'}<i />本机保存</span></footer>
      </main>
    </div>
    {drawer && <Drawer onClose={() => setDrawer(false)}><div className="cyber-drawer-header"><div><span className="cyber-kicker">YOUR LEARNING SPACE</span><h2>词库与设置</h2></div><button type="button" className="cyber-close" aria-label="关闭词库与设置" onClick={() => setDrawer(false)}><X size={22} /></button></div><div className="cyber-drawer-tabs" role="group" aria-label="学习工具">{([{ id: 'library', label: '词库' }, { id: 'settings', label: '设置' }, { id: 'records', label: '记录' }, { id: 'sources', label: '来源' }] as const).map(item => <button type="button" key={item.id} aria-pressed={tab === item.id} onClick={() => changeTab(item.id)} disabled={busy}>{item.label}</button>)}</div>
      {error && <p className="cyber-error" role="alert">{error}</p>}
      {tab === 'library' && <Library data={data} busy={busy} onAddNext={addNext} />}
      {tab === 'settings' && <section className="cyber-settings"><h3>把节奏调成适合自己</h3><label className="cyber-setting-row">每日新词上限<select aria-label="每日新词上限" value={preferences.dailyNewLimit} disabled={settingsDisabled} onChange={event => settings({ dailyNewLimit: Number(event.target.value) })}>{[0, 5, 10, 20, 30, 50, 100].map(limit => <option key={limit} value={limit}>{limit} 个</option>)}</select></label><p className="cyber-note">仅练习所选词库的新词与到期复习；切换后立即更新当前词。学习记录会保留，词库里手选词仍可额外学习。</p><fieldset disabled={settingsDisabled}><legend>练习范围</legend><label><input type="checkbox" checked={!preferences.selectedDecks.length} onChange={() => settings({ selectedDecks: [] })} />全部词库</label>{routes.map(route => <label key={route.id}><input type="checkbox" checked={preferences.selectedDecks.includes(route.id)} onChange={event => { const checked = event.target.checked; void settings(current => ({ selectedDecks: checked ? [...new Set([...current.selectedDecks, route.id])] : current.selectedDecks.filter(id => id !== route.id) })); }} />{route.label}</label>)}</fieldset><p className="cyber-note">精选路线是项目教学选编；底库考试标签来自社区词表映射。全部词库包含未标路线的词。均非官方必考或考试频率榜；通用语料频率不等于美国口语频率。</p><label className="cyber-setting-row">减少动态<input type="checkbox" checked={preferences.reducedMotion} disabled={settingsDisabled} onChange={event => settings({ reducedMotion: event.target.checked })} /></label><p className="cyber-note">当前日期按 {preferences.timezone} 计算；复习时间以 UTC 毫秒保存。</p><SoundSettings settings={preferences} disabled={settingsDisabled} onChange={settings} /><section className="recommendation-settings"><h3>选词建议</h3><p className="cyber-note" data-testid="vocabulary-profile-summary">{profileSummary ? `${profileSummary.targetLabel} · 建议范围：${profileSummary.rangeLabel}。${profileSummary.confidence}` : '还没有水平测试结果。可先练习，也可做一轮简短测试；历史记录不会清空。'}</p><label className="cyber-setting-row">推荐难度<select aria-label="推荐难度" data-testid="difficulty-adjustment" value={preferences.difficultyAdjustment ?? 0} disabled={settingsDisabled} onChange={event => { void settings({ difficultyAdjustment: Number(event.target.value) as -1 | 0 | 1 }); }}><option value={-1}>容易一些</option><option value={0}>自动匹配</option><option value={1}>挑战一点</option></select></label><p className="cyber-note">词频只用来帮助选词，不代表考试等级。到期复习优先，近期独立拼写表现会逐步调整新词建议；手选词库范围仍有效。</p><button type="button" className="cyber-secondary" data-testid="placement-retest" disabled={busy} onClick={() => { setDrawer(false); setPlacementOpen(true); }}>测试或重新测试水平</button></section><div className="cyber-backup"><h3>学习备份</h3><p>进度只保存在当前浏览器。换设备前先导出；导入会校验并合并原始事件。</p><div className="cyber-actions"><button type="button" className="cyber-secondary" disabled={busy || !storageReady} onClick={download}><Download size={17} />导出 JSON</button><button type="button" className="cyber-secondary" disabled={busy || !storageReady} onClick={() => fileInput.current?.click()}><Upload size={17} />导入合并</button></div><input ref={fileInput} type="file" accept="application/json,.json" aria-label="选择学习备份" hidden onChange={event => upload(event.target.files?.[0])} />{migrationBackup && <><p className="cyber-note">已保留升级前原始快照，旧到期时间与原始事件保持兼容。</p><button type="button" className="cyber-text-button" onClick={downloadMigration}>导出升级前快照</button></>}</div><div className="cyber-offline-settings"><h3>离线与安装</h3><p>{offlineLabel}。文字与已缓存词库可离线使用；设备语音与麦克风支持由浏览器决定。</p>{installEvent && <button type="button" className="cyber-secondary" onClick={async () => { await installEvent.prompt(); setInstallEvent(null); }}>安装 WriEng</button>}<button type="button" className="cyber-text-button" onClick={() => controls.current?.checkForUpdate()}>检查应用更新</button></div></section>}
      {tab === 'records' && <Records data={data} />}
      {tab === 'sources' && <Sources />}
    </Drawer>}
    {placementOpen && <PlacementTest onComplete={savePlacement} onLater={deferPlacement} busy={busy} existingProfile={data.settings.vocabularyProfile ?? null} />}
    {toast && <div className="cyber-toast" role="status">{toast}</div>}
  </div>;
}

function Drawer({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null, overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current?.querySelector<HTMLElement>('button')?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close.current(); }
      if (event.key !== 'Tab') return;
      const elements = [...(ref.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]):not([hidden]),select:not([disabled]),a[href],summary,[tabindex="0"]') || [])].filter(element => element.getClientRects().length);
      const first = elements[0], last = elements[elements.length - 1];
      if (event.shiftKey && (document.activeElement === first || !ref.current?.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !ref.current?.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', keydown); previous?.focus(); };
  }, []);
  return <div className="cyber-backdrop cyber-drawer-backdrop" onClick={event => { if (event.target === event.currentTarget) onClose(); }}><div ref={ref} className="cyber-drawer" role="dialog" aria-modal="true" aria-label="词库与设置">{children}</div></div>;
}

function Library({ data, busy, onAddNext }: { data: AppData; busy: boolean; onAddNext: (word: LearningWord) => Promise<void> }) {
  const [query, setQuery] = useState('');
  const [tier, setTier] = useState('all');
  const [route, setRoute] = useState('all');
  const [sort, setSort] = useState('frequency');
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<LearningWord | null>(null);
  const hits = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('en');
    const filtered = learningWords.filter(word => (tier === 'all' || word.kind === tier) && (route === 'all' || word.routes.some(id => id === route)) && (!needle || `${word.term}\n${word.meaningZh}\n${word.definitionEn}`.toLocaleLowerCase('en').includes(needle)));
    return filtered.sort(sort === 'alpha' ? (a, b) => a.term.localeCompare(b.term, 'en') : compareByGeneralFrequency);
  }, [query, tier, route, sort]);
  const pageCount = Math.max(1, Math.ceil(hits.length / 40));
  const visiblePage = Math.min(page, pageCount - 1);
  const currentId = data.session?.stage !== 'done' ? data.session?.queue[data.session.index] : undefined;
  return <section className="cyber-library"><div className="cyber-library-heading"><h3>词库</h3><span data-testid="library-word-count">{hits.length.toLocaleString('en-US')} 个词义 · 总计 {learningContentStats.total.toLocaleString('en-US')}</span></div><p className="cyber-note">{learningContentStats.curated} 个精选教学词义 · {learningContentStats.core.toLocaleString('en-US')} 个词典底库义项。底库中文是译词；无教学例句的词不会补造。</p><div className="cyber-library-controls"><label className="cyber-search"><Search size={17} /><span className="sr-only">搜索词库</span><input type="search" aria-label="搜索词库" value={query} onChange={event => { setQuery(event.target.value); setPage(0); setSelected(null); }} placeholder="搜英文、中文译词或释义" /></label><select aria-label="内容类型" value={tier} onChange={event => { setTier(event.target.value); setPage(0); setSelected(null); }}><option value="all">全部内容</option><option value="curated">精选教学</option><option value="core">词典底库</option></select><select aria-label="词库路线" value={route} onChange={event => { setRoute(event.target.value); setPage(0); setSelected(null); }}><option value="all">全部路线</option>{routes.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select><select aria-label="词库排序" value={sort} onChange={event => { setSort(event.target.value); setPage(0); }}><option value="frequency">通用语料频率</option><option value="alpha">字母顺序</option></select></div>
    {selected && <article className="cyber-library-detail"><button type="button" className="cyber-text-button" onClick={() => setSelected(null)}>关闭词条详情</button><WordPresentation word={selected} library /><div className="cyber-actions"><button type="button" className="cyber-primary" disabled={busy || currentId === selected.id} onClick={() => onAddNext(selected)}>加入下一词 <ArrowRight size={17} /></button>{currentId === selected.id && <span className="cyber-note">正在学习这个词</span>}</div><details className="cyber-provenance"><summary>此词字段来源与许可</summary><pre>{JSON.stringify(selected.provenance, null, 2)}</pre></details></article>}
    <div className="cyber-word-list">{hits.slice(visiblePage * 40, visiblePage * 40 + 40).map(word => <button type="button" className={`cyber-library-card ${selected?.id === word.id ? 'is-selected' : ''}`} key={word.id} onClick={() => setSelected(word)}><span><strong lang="en">{word.term}</strong><small>{word.partOfSpeech} · {word.kind === 'curated' ? '精选教学' : '词典义项'}</small></span><span>{word.meaningZh}</span><small>{data.progress[word.id] ? `复习 ${dateLabel(data.progress[word.id].dueAt)}` : '未学习'}</small></button>)}</div>{!hits.length && <p className="cyber-note">没有找到匹配词义。试试更短的英文或中文。</p>}<div className="cyber-pagination"><button type="button" disabled={visiblePage === 0} onClick={() => setPage(visiblePage - 1)}>上一页</button><span>{visiblePage + 1} / {pageCount}</span><button type="button" disabled={visiblePage >= pageCount - 1} onClick={() => setPage(visiblePage + 1)}>下一页</button></div>
  </section>;
}

function Records({ data }: { data: AppData }) {
  return <section className="cyber-records"><h3>每次回忆，都有原始记录</h3><p>{data.events.length} 次提交 · {Object.keys(data.progress).length} 个已学词义。手写保留有笔迹状态与自评，不保存笔迹图片；键入保留第一次提交。</p><div className="cyber-record-list">{[...data.events].reverse().slice(0, 100).map(event => <article key={event.id}><div><strong lang="en">{findLearningWord(event.wordId)?.term || event.wordId}</strong><time>{dateLabel(event.at)}</time></div><p>{event.mode === 'handwriting' ? '手写 · 自评' : event.result === 'correct' ? '键入 · 拼写正确' : '键入 · 拼写不正确'} · {event.effectiveRating === 'good' ? '记住了' : event.effectiveRating === 'hard' ? '有点费劲' : '需要再练'}{event.hinted ? ' · 用过提示' : ''}{event.revealed ? ' · 提前揭晓' : ''}{event.retry ? ' · 重试' : ''}</p>{event.answer !== null && <p>原始提交：<span lang="en">{event.answer || '（空白）'}</span></p>}<small>{event.schedulerVersion} · 提交 {dateLabel(event.submittedAt)} / 评估 {dateLabel(event.at)}</small></article>)}</div>{!data.events.length && <p className="cyber-note">完成第一词后，原始回忆记录会出现在这里。</p>}{data.events.length > 100 && <p className="cyber-note">这里显示最近 100 次，完整记录可在设置中导出。</p>}</section>;
}

function Sources() {
  return <section className="cyber-sources">
    <h3>内容从哪里来</h3>
    <p>当前可学 {learningContentStats.total.toLocaleString('en-US')} 个词义：{learningContentStats.curated} 个精选教学词义、{learningContentStats.core.toLocaleString('en-US')} 个词典底库义项。</p>
    <p>精选词义、双语情境、搭配和记忆联想为 WriEng 原创 AI 辅助草稿，CC0-1.0；尚未经专业语言编辑逐条审定。底库使用 WordNet 3.0 英文释义、Chinese Open WordNet 的同义词集中文译词与 CMUdict 北美发音音素。具体来源、版本、许可与转换说明保留在每词字段记录中。</p>
    <p>wordfreq 的通用混合语料频率用于排序，不代表考试频率或美国口语频率。考试路线是项目教学选编或社区词表标签映射，并非官方必考清单。尚未导入经过验证的考试频率。</p>
    <h3>怎样安排复习</h3>
    <p>使用固定 ts-fsrs 5.4.2 的 FSRS-6，目标保持率 90%，关闭随机抖动。目标不是对个人记忆效果的保证。提示、提前揭晓、错误与重试都按 Again 重学；手写结果来自你的自评，笔迹检测不等于识字或掌握证明。旧版记录和到期时间保留，升级前快照可导出。</p>
    <h3>发音与隐私</h3>
    <p>发音播放使用浏览器设备声音，优先 en-US，并提供整词、例句慢速播放和本机录音回听。精选教学提供实际音标、重音提示与发音说明；底库没有美式 IPA 时仅展示真实 CMU 音素。没有专业发音评分、口型动画、最小对立词训练或手写识别服务。录音与笔迹图片不上传，也不写入学习备份。</p>
    <div className="cyber-source-links">
      <a href={publicAsset('data/core-lexicon-manifest.json')} target="_blank" rel="noreferrer">词典导入来源与筛选清单</a>
      <a href={publicAsset('data/core-lexicon.json')} target="_blank" rel="noreferrer">完整底库数据（联网下载）</a>
      <a href={publicAsset('licenses/WordNet-3.0-LICENSE.txt')} target="_blank" rel="noreferrer">WordNet 许可</a>
      <a href={publicAsset('licenses/COW-LICENSE.txt')} target="_blank" rel="noreferrer">中文词网许可</a>
      <a href={publicAsset('licenses/CMUdict-LICENSE.txt')} target="_blank" rel="noreferrer">CMUdict 许可</a>
      <a href={publicAsset('licenses/CC-BY-SA-4.0.txt')} target="_blank" rel="noreferrer">频率数据 CC-BY-SA 许可</a>
      <a href="https://github.com/open-spaced-repetition/ts-fsrs/tree/v5.4.2" target="_blank" rel="noreferrer">ts-fsrs 官方项目</a>
    </div>
  </section>;
}
