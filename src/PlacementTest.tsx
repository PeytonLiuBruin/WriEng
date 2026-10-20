import { useEffect, useMemo, useRef, useState } from 'react';
import { learningWords } from './content';
import type { VocabularyProfile } from './engine';
import { assessVocabulary, nextPlacementWord, PLACEMENT_QUESTION_COUNT, vocabularySummary, wordFrequencyBand, type PlacementAnswer } from './vocabulary';
import './placement.css';

interface Props {
  onComplete: (profile: VocabularyProfile) => Promise<void>;
  onLater: () => Promise<void>;
  busy?: boolean;
  existingProfile?: VocabularyProfile | null;
}

const normalize = (value: string) => value.trim().toLocaleLowerCase('en-US').replace(/[‘’]/g, "'").replace(/\s+/g, ' ');
const mask = (text: string, term: string) => text.replace(new RegExp(`(^|[^A-Za-z])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^A-Za-z])`, 'gi'), '$1____');

export default function PlacementTest({ onComplete, onLater, busy = false, existingProfile }: Props) {
  const [phase, setPhase] = useState<'intro' | 'quiz' | 'result'>('intro');
  const [answers, setAnswers] = useState<PlacementAnswer[]>([]);
  const [answer, setAnswer] = useState('');
  const [result, setResult] = useState<VocabularyProfile | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDivElement>(null);
  const answerInput = useRef<HTMLInputElement>(null);
  const answerLock = useRef(false);
  const finishLock = useRef(false);
  const disabled = busy || saving;
  const current = useMemo(() => nextPlacementWord(learningWords, answers), [answers]);
  const later = useRef<() => void>(() => {});

  async function finish(profile?: VocabularyProfile) {
    if (disabled || finishLock.current) return;
    finishLock.current = true;
    setSaving(true); setError('');
    try { if (profile) await onComplete(profile); else await onLater(); }
    catch (reason) { setError(`尚未保存，请重试：${(reason as Error).message}`); }
    finally { finishLock.current = false; setSaving(false); }
  }
  later.current = () => { void finish(); };

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); later.current(); }
      if (event.key !== 'Tab') return;
      const elements = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),[tabindex="0"]') ?? [])];
      if (!elements.length) { event.preventDefault(); dialog.current?.focus(); return; }
      const first = elements[0], last = elements[elements.length - 1];
      const inControls = elements.includes(document.activeElement as HTMLElement);
      if (event.shiftKey && (document.activeElement === first || !inControls)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !inControls)) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', keydown); previous?.focus(); };
  }, []);

  useEffect(() => {
    answerLock.current = false;
    if (phase === 'quiz') answerInput.current?.focus();
    else dialog.current?.focus();
  }, [phase, answers.length]);

  function submit(unknown = false) {
    if (disabled || answerLock.current || !current || (!unknown && !answer.trim())) return;
    answerLock.current = true;
    const next = [...answers, { wordId: current.id, band: wordFrequencyBand(current)!, correct: !unknown && normalize(answer) === normalize(current.term) }];
    setAnswers(next); setAnswer('');
    if (next.length === PLACEMENT_QUESTION_COUNT || !nextPlacementWord(learningWords, next)) {
      try { setResult(assessVocabulary(next)); setPhase('result'); }
      catch (reason) { setError((reason as Error).message); answerLock.current = false; }
    }
  }

  const summary = vocabularySummary(result);
  return <div className="placement-backdrop">
    <div ref={dialog} tabIndex={-1} className="placement-dialog" role="dialog" aria-modal="true" aria-labelledby="placement-title" data-testid="placement-dialog">
      <span className="cyber-kicker">FIND YOUR STARTING POINT</span>
      {phase === 'intro' && <section data-testid="placement-intro">
        <h1 id="placement-title">先找一个适合你的起点</h1>
        <p className="placement-lead">用 10 道小题试试英文拼写回忆。先覆盖不同常用程度，再根据回答调整后面的题目。</p>
        <div className="placement-explainer"><strong>不用猜，也不用给自己打分</strong><p>看中文和释义，写出对应的英文；不确定就选“不知道”。测评不会增加复习次数，也不会改动原有学习记录。</p></div>
        <p className="cyber-note">分组依据通用词频，不等于经过测量的词语难度。少量题目只能给练习起点建议，不能准确推算总词汇量或认证语言等级。</p>
        {existingProfile?.status === 'completed' && <p className="placement-previous">上次建议：{vocabularySummary(existingProfile).targetLabel}。重新测评后，你可以决定是否应用。</p>}
        <div className="placement-actions"><button type="button" className="cyber-primary" data-testid="placement-start" disabled={disabled} onClick={() => { setAnswers([]); setAnswer(''); setResult(null); setError(''); setPhase('quiz'); }}>开始测试</button><button type="button" className="cyber-text-button" data-testid="placement-later" disabled={disabled} onClick={() => finish()}>稍后再测</button></div>
      </section>}
      {phase === 'quiz' && current && <section>
        <div className="placement-progress" data-testid="placement-progress" aria-live="polite"><span>第 {answers.length + 1} / {PLACEMENT_QUESTION_COUNT} 题</span><span>凭记忆拼写即可</span><progress max={PLACEMENT_QUESTION_COUNT} value={answers.length} aria-label="测评进度" /></div>
        <h1 id="placement-title">这个意思，用英文怎么说？</h1>
        <div className="placement-question" data-testid="placement-question" data-word-id={current.id} data-band={wordFrequencyBand(current)}><span className="placement-part" lang="en">{current.partOfSpeech}</span><p className="placement-meaning">{mask(current.meaningZh, current.term)}</p><p className="placement-definition" lang="en">{mask(current.definitionEn, current.term)}</p></div>
        <form onSubmit={event => { event.preventDefault(); submit(); }}><label htmlFor="placement-answer">输入英文</label><input ref={answerInput} id="placement-answer" data-testid="placement-answer" className="cyber-recall-input" value={answer} onChange={event => setAnswer(event.target.value)} maxLength={500} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} disabled={disabled} lang="en" /><div className="placement-actions"><button type="submit" className="cyber-primary" data-testid="placement-submit" disabled={disabled || !answer.trim()}>回答，下一题</button><button type="button" className="cyber-secondary" data-testid="placement-unknown" disabled={disabled} onClick={() => submit(true)}>不知道，跳过本题</button></div></form>
        <button type="button" className="cyber-text-button placement-later" data-testid="placement-later" disabled={disabled} onClick={() => finish()}>稍后再测</button>
      </section>}
      {phase === 'result' && result && <section data-testid="placement-result">
        <h1 id="placement-title">从这里开始，边学边调整</h1>
        <div className="placement-recommendation"><span>练习起点建议</span><strong>{summary.targetLabel}</strong><p>{summary.rangeLabel}</p></div>
        <p className="placement-score">本次 {result.sampleSize} 题，独立拼写正确 {result.correct} 题。</p><p className="cyber-note">{summary.confidence}。这是初步建议，不是总词汇量估计；词频也不能代表所有词义的实际难度。</p>
        <p className="placement-lead">应用后，优先复习所选词库里到期、需要巩固的词，再安排相近词频的新词。之后会参考足够数量的独立拼写记录微调，也能在设置中手动调整。</p>
        <div className="placement-actions"><button type="button" className="cyber-primary" data-testid="placement-apply" disabled={disabled} onClick={() => finish(result)}>应用建议，开始学习</button><button type="button" className="cyber-text-button" data-testid="placement-later" disabled={disabled} onClick={() => finish()}>暂不应用</button></div>
      </section>}
      {error && <p role="alert" className="cyber-error">{error}</p>}
      {saving && <p role="status" className="cyber-note">正在保存…</p>}
    </div>
  </div>;
}
