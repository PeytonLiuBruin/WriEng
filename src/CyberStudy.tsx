import { useEffect, useRef, useState } from 'react';
import { ArrowRight, EyeOff, Lightbulb } from 'lucide-react';
import type { LearningWord } from './content';
import { previewIntervals, type AppData, type Rating, type StudySession } from './engine';
import InkPad from './InkPad';
import Pronunciation from './Pronunciation';

export const normalizeAnswer = (value: string) => value.trim().toLocaleLowerCase('en-US').replace(/[’‘]/g, "'").replace(/\s+/g, ' ');
const delayLabel = (at: number) => {
  const minutes = Math.max(1, Math.round((at - Date.now()) / 60000));
  return minutes < 60 ? `约 ${minutes} 分钟后` : minutes < 1440 ? `约 ${Math.round(minutes / 60)} 小时后` : `约 ${Math.round(minutes / 1440)} 天后`;
};
const maskTerm = (text: string, term: string) => text.replace(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '____');

/** Both tiers use real supplied fields. Empty dictionary teaching fields stay empty. */
export function WordPresentation({ word, library = false, brief = false }: { word: LearningWord; library?: boolean; brief?: boolean }) {
  const pronunciation = word.pronunciation;
  const stress = pronunciation.syllables.length && pronunciation.stressedSyllable !== null
    ? pronunciation.syllables.map((part, index) => index === pronunciation.stressedSyllable ? part.toUpperCase() : part).join(' · ')
    : undefined;
  const sourceExample = word.kind === 'core' ? word.sourceExamples[0] : undefined;
  const context = <>
    <p className="cyber-definition" lang="en">{word.definitionEn}</p>
    {!pronunciation.ipaUs && <p className="cyber-note">此词暂未提供词典美式 IPA；可听本机英语声音。{pronunciation.arpabet && <span> CMU 音素：<span lang="en">{pronunciation.arpabet}</span></span>}</p>}
    {word.example && <div className="cyber-context"><span className="cyber-kicker">放进情境</span><p lang="en">{word.example.en}</p><p className="cyber-translation">{word.example.zh}</p></div>}
    {word.kind === 'core' && word.sourceExamples.length > 0 && <div className="cyber-context"><span className="cyber-kicker">WordNet 原例句</span>{word.sourceExamples.slice(0, 2).map(example => <p key={example} lang="en">{example}</p>)}</div>}
    {(word.collocations.length > 0 || word.mnemonicZh || (word.kind === 'core' && word.synonyms.length > 0)) && <details className="cyber-teaching-details"><summary>再看一点</summary>
      {word.collocations.length > 0 && <p><span className="cyber-kicker">常用搭配</span><span lang="en">{word.collocations.join(' · ')}</span></p>}
      {word.mnemonicZh && <p><span className="cyber-kicker">记忆联想</span>{word.mnemonicZh}</p>}
      {word.kind === 'core' && word.synonyms.length > 0 && <p><span className="cyber-kicker">同义词集中的其他词</span><span lang="en">{word.synonyms.join(' · ')}</span></p>}
    </details>}
  </>;
  return <>
    <div className="cyber-word-meta"><span>{word.kind === 'curated' ? '精选教学' : '词典义项'}</span><span lang="en">{word.partOfSpeech}</span></div>
    <h1 className={`cyber-word ${word.term.length > 12 ? 'is-long' : ''} ${word.term.length > 20 ? 'is-very-long' : ''}`} data-length={word.term.length} data-testid={library ? 'library-word-detail-term' : 'study-word'} lang="en-US">{word.term}</h1>
    <Pronunciation compact word={word.term} ipa={pronunciation.ipaUs || ''} stress={stress} tip={pronunciation.tipZh || undefined} example={word.example?.en || sourceExample} />
    <div className="cyber-meaning">{word.kind === 'core' && <small>中文译词</small>}<p>{word.meaningZh}</p></div>
    {brief ? <details className="cyber-feedback-details"><summary>再看词义与情境</summary>{context}</details> : context}
  </>;
}

interface Props {
  data: AppData;
  session: StudySession;
  word: LearningWord;
  busy: boolean;
  onSession: (session: StudySession) => Promise<void>;
  onGrade: (rating: Rating) => Promise<void>;
  onSkip: () => Promise<void>;
}

export default function CyberStudy({ data, session, word, busy, onSession, onGrade, onSkip }: Props) {
  const [answer, setAnswer] = useState(String(session.response || ''));
  const [hasInk, setHasInk] = useState(Boolean(session.hasInk));
  const [inkSnapshot, setInkSnapshot] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const submitLock = useRef(false);
  const inkFrame = useRef<HTMLDivElement>(null);
  const focusTarget = useRef<HTMLDivElement>(null);
  const disabled = busy || saving;
  useEffect(() => {
    focusTarget.current?.focus();
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  }, [session.stage]);

  async function transition(next: StudySession) {
    if (submitLock.current || busy) return;
    submitLock.current = true;
    setSaving(true); setError('');
    try { await onSession(next); }
    catch (reason) { setError(`尚未保存，请重试：${(reason as Error).message}`); }
    finally { submitLock.current = false; setSaving(false); }
  }
  async function submit(forgot = false) {
    if (disabled || submitLock.current || (!forgot && (session.mode === 'typed' ? !answer.trim() : !hasInk))) return;
    if (session.mode === 'handwriting' && hasInk) {
      try { setInkSnapshot(inkFrame.current?.querySelector('canvas')?.toDataURL('image/png') || ''); }
      catch { setInkSnapshot(''); }
    }
    await transition({ ...session, stage: 'feedback', response: session.mode === 'typed' ? answer : '', hasInk: session.mode === 'handwriting' && hasInk,
      correct: !forgot && session.mode === 'typed' && normalizeAnswer(answer) === normalizeAnswer(word.term), forgot, submittedAt: Date.now() });
  }
  async function grade(rating: Rating) {
    if (submitLock.current || disabled) return;
    submitLock.current = true; setSaving(true); setError('');
    try { await onGrade(rating); }
    catch (reason) { setError(`这次记录尚未确认保存，请重试：${(reason as Error).message}`); }
    finally { submitLock.current = false; setSaving(false); }
  }
  const assisted = Boolean(session.hinted || session.revealed || session.retry || session.forgot);
  const typedCorrect = session.mode === 'typed' && normalizeAnswer(String(session.response || '')) === normalizeAnswer(word.term) && !session.forgot;
  const mayRateRecall = !assisted && (session.mode === 'typed' ? typedCorrect : Boolean(session.hasInk));
  const intervals = session.stage === 'feedback' ? previewIntervals(data.progress[word.id], Date.now()) : null;

  return <div ref={focusTarget} tabIndex={-1} className={`cyber-study cyber-stage-${session.stage}`} data-stage={session.stage}>
    <div className="cyber-phase"><span className="cyber-kicker">{session.stage === 'study' ? '01 / 看一眼，听一遍' : session.stage === 'recall' ? '02 / 让记忆自己回来' : '03 / 看反馈，继续前进'}</span><span>{data.progress[word.id] ? '复习' : '新词'} · {session.index + 1} / {session.queue.length}</span></div>
    {session.stage === 'study' && <>
      <WordPresentation word={word} />
      {session.revealed === true && <p className="cyber-note">你刚刚预览过这个已学词，本次按辅助重学记录。</p>}
      <div className="cyber-actions"><button type="button" className="cyber-primary" disabled={disabled} onClick={() => transition({ ...session, stage: 'recall', presentedAt: Date.now(), response: '', hasInk: false, forgot: false, correct: false })}>隐藏单词，开始回忆 <EyeOff size={19} /></button><button type="button" className="cyber-text-button" disabled={disabled} onClick={onSkip}>略过此词</button></div>
    </>}
    {session.stage === 'recall' && <>
      <span className="cyber-recall-label">{word.kind === 'core' ? '看中文译词，找回英文' : '看意思，找回英文'}</span>
      <h1 className="cyber-recall-prompt" data-testid="recall-prompt">{maskTerm(word.meaningZh || word.definitionEn, word.term)}</h1>
      {word.kind === 'curated' && <p className="cyber-recall-context">{maskTerm(word.transferExample.zh, word.term)}</p>}
      {session.revealed === true && <p className="cyber-note">答案已经提前看过。这次作为重学，稍后再独立回忆。</p>}
      <div className="cyber-mode-tabs" role="group" aria-label="回忆方式">
        {(['handwriting', 'typed'] as const).map(mode => <button key={mode} type="button" aria-pressed={session.mode === mode} disabled={disabled} onClick={() => { if (mode !== session.mode) { setHasInk(false); void transition({ ...session, mode, hasInk: false }); } }}>{mode === 'handwriting' ? '手写' : '键入'}</button>)}
      </div>
      {session.mode === 'typed' ? <form onSubmit={event => { event.preventDefault(); void submit(); }} className="cyber-recall-form"><label htmlFor="recall-answer">输入记住的单词</label><input id="recall-answer" className="cyber-recall-input" value={answer} onChange={event => setAnswer(event.target.value)} maxLength={500} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} disabled={disabled} lang="en" /><button type="submit" className="cyber-primary" disabled={disabled || !answer.trim()}>提交并揭晓 <ArrowRight size={19} /></button></form>
        : <div ref={inkFrame} className="cyber-ink-frame"><InkPad onChange={setHasInk} disabled={disabled} onSubmit={() => void submit()} submitDisabled={disabled || !hasInk} prompt={maskTerm(word.meaningZh || word.definitionEn, word.term)} /><p className="cyber-note">写完先提交，再自己对照。当前没有手写识别器，不会自动判字。</p><button type="button" className="cyber-primary" disabled={disabled || !hasInk} onClick={() => submit()}>提交并揭晓 <ArrowRight size={19} /></button></div>}
      <div className="cyber-recall-tools">{session.hinted ? <p className="cyber-hint">首字母：<strong lang="en">{word.term.charAt(0)}</strong> · 本次将稍后再练</p> : <button type="button" className="cyber-text-button" disabled={disabled} onClick={() => transition({ ...session, hinted: true })}><Lightbulb size={15} /> 首字母提示</button>}<button type="button" className="cyber-text-button" disabled={disabled} onClick={() => submit(true)}>想不起来，揭晓</button><button type="button" className="cyber-text-button" disabled={disabled} onClick={onSkip}>略过此词</button></div>
    </>}
    {session.stage === 'feedback' && <>
      <div className={`cyber-feedback ${mayRateRecall ? 'is-ready' : 'is-again'}`} role="status">{session.forgot ? '没关系，再学一遍。' : session.mode === 'handwriting' ? '对照原笔迹，诚实地自己判断。' : typedCorrect ? '拼写正确。你刚才记住了吗？' : '这次没拼对，原始提交已保留。'}{assisted && !session.forgot && <span> 本次用过提示或提前看过答案，稍后再独立回忆。</span>}</div>
      {session.mode === 'typed' && !session.forgot && <p className="cyber-original-answer">你的原始提交：<strong lang="en">{String(session.response || '（空白）')}</strong></p>}
      {session.mode === 'handwriting' && session.hasInk === true && <div className="cyber-original-ink">{inkSnapshot ? <img src={inkSnapshot} alt="本次提交的手写笔迹" /> : <p className="cyber-note">笔迹未保留到刷新后。已保留提交时间与有笔迹状态；请根据实际回忆自评，不能确定就选需要再练。</p>}</div>}
      <WordPresentation word={word} brief />
      <div className="cyber-grade-buttons">{mayRateRecall && <><button type="button" className="cyber-primary" aria-label={session.mode === 'handwriting' ? '我写对了，下一词' : '记住了，下一词'} disabled={disabled} onClick={() => grade('good')}>{session.mode === 'handwriting' ? '我写对了，下一词' : '记住了，下一词'}<small>{delayLabel(intervals!.good)}</small><ArrowRight size={19} /></button><button type="button" className="cyber-secondary" aria-label="有点费劲，下一词" disabled={disabled} onClick={() => grade('hard')}>有点费劲，下一词<small>{delayLabel(intervals!.hard)}</small></button></>}<button type="button" className={mayRateRecall ? 'cyber-secondary' : 'cyber-primary'} aria-label="需要再练，下一词" disabled={disabled} onClick={() => grade('again')}>需要再练，下一词<small>{delayLabel(intervals!.again)}</small></button></div>
      <p className="cyber-note">{session.mode === 'handwriting' ? '手写结果来自你的自评，不是识别或发音评分。' : '只比较这次原始拼写；提示后的改正不算独立掌握。'} 会按这次回忆安排下次复习。</p>
    </>}
    {error && <p className="cyber-error" role="alert">{error}</p>}
    {saving && <span className="cyber-saving" role="status">正在保存…</span>}
  </div>;
}
