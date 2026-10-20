import { useEffect, useId, useRef } from 'react';
import type { LearningWord } from './content';
import { WordPresentation } from './CyberStudy';
import './study-shortcuts.css';

export interface PreviousWordProps {
  word: LearningWord;
  onClose: () => void;
  onOlder: () => void;
  hasOlder: boolean;
}

/** Looking back presents supplied content without creating a response, rating or learning event. */
export default function PreviousWord({ word, onClose, onOlder, hasOlder }: PreviousWordProps) {
  const panel = useRef<HTMLElement>(null);
  const title = useId();
  useEffect(() => { panel.current?.focus(); }, [word.id]);

  return <section ref={panel} tabIndex={-1} className="cyber-study cyber-previous-word"
    aria-labelledby={title} data-testid="previous-word">
    <div className="cyber-phase"><span className="cyber-kicker" id={title}>回看上一词 · 不重复计数</span></div>
    <p className="cyber-note previous-word-note">这里只回看词义，不提交作答，也不重复记录学习次数。</p>
    <div data-testid="previous-word-term"><WordPresentation word={word} library /></div>
    <div className="cyber-actions previous-word-actions">
      <button type="button" className="cyber-primary" data-testid="previous-word-close" onClick={onClose}>返回当前词</button>
      <button type="button" className="cyber-secondary" data-testid="previous-word-older" disabled={!hasOlder} onClick={onOlder}>再往前</button>
    </div>
    <p className="study-shortcut-hint"><kbd>B</kbd> 再往前 <span aria-hidden="true">·</span> <kbd>D</kbd> 返回当前词</p>
  </section>;
}
