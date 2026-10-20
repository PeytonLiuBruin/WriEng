import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LearningWord } from './content';
import PreviousWord from './PreviousWord';
import { useStudyShortcuts, type StudyShortcutOptions } from './study-shortcuts';

vi.mock('./CyberStudy', () => ({
  WordPresentation: ({ word, library }: { word: LearningWord; library: boolean }) =>
    <div data-testid="presented-word" data-library={library}>{word.term}</div>,
}));

let desktop: { matches: boolean };
beforeEach(() => {
  desktop = { matches: true };
  vi.stubGlobal('matchMedia', vi.fn(() => desktop));
});
afterEach(() => {
  cleanup();
  document.querySelectorAll('[data-shortcut-fixture]').forEach(element => element.remove());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function Harness(props: StudyShortcutOptions) {
  useStudyShortcuts(props);
  return <div data-testid="study-page" tabIndex={-1}>Practice</div>;
}

function start(enabled = true) {
  const callbacks = { onSkip: vi.fn(), onBack: vi.fn() };
  return { ...callbacks, ...render(<Harness enabled={enabled} {...callbacks} />) };
}

function key(key: string, init: KeyboardEventInit = {}, target: EventTarget = document.body) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

function fixture(html: string): HTMLElement {
  const parent = document.createElement('div');
  parent.dataset.shortcutFixture = '';
  parent.innerHTML = html;
  document.body.append(parent);
  return parent.firstElementChild as HTMLElement;
}

describe('desktop page-level study shortcuts', () => {
  it('handles unmodified D and B, including Caps Lock letter casing, and ignores other keys', () => {
    const { onSkip, onBack } = start();
    expect(key('d').defaultPrevented).toBe(true);
    expect(key('D').defaultPrevented).toBe(true);
    expect(key('b').defaultPrevented).toBe(true);
    expect(key('B').defaultPrevented).toBe(true);
    for (const other of ['a', 'Delete', 'Backspace', 'Enter', 'Escape', 'Tab']) {
      expect(key(other).defaultPrevented).toBe(false);
    }
    expect(onSkip).toHaveBeenCalledTimes(2);
    expect(onBack).toHaveBeenCalledTimes(2);
  });

  it('does not reserve letters when disabled, on a touch device, or when media queries are unavailable', () => {
    const { onSkip, onBack, rerender } = start(false);
    expect(key('d').defaultPrevented).toBe(false);
    rerender(<Harness enabled onSkip={onSkip} onBack={onBack} />);
    desktop.matches = false;
    expect(key('d').defaultPrevented).toBe(false);
    expect(key('b').defaultPrevented).toBe(false);
    desktop.matches = true;
    expect(key('b').defaultPrevented).toBe(true);
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onSkip).not.toHaveBeenCalled();
    rerender(<Harness enabled={false} onSkip={onSkip} onBack={onBack} />);
    vi.stubGlobal('matchMedia', undefined);
    rerender(<Harness enabled onSkip={onSkip} onBack={onBack} />);
    expect(key('d').defaultPrevented).toBe(false);
    expect(onSkip).not.toHaveBeenCalled();
  });

  it.each(['altKey', 'ctrlKey', 'metaKey', 'shiftKey'] as const)('preserves browser and user %s combinations', modifier => {
    const { onSkip, onBack } = start();
    expect(key('d', { [modifier]: true }).defaultPrevented).toBe(false);
    expect(key('b', { [modifier]: true }).defaultPrevented).toBe(false);
    expect(onSkip).not.toHaveBeenCalled();
    expect(onBack).not.toHaveBeenCalled();
  });

  it('ignores held-key repeats and events already handled by the page', () => {
    const { onSkip, onBack } = start();
    expect(key('d', { repeat: true }).defaultPrevented).toBe(false);
    expect(key('b', { repeat: true }).defaultPrevented).toBe(false);
    document.addEventListener('keydown', event => event.preventDefault(), { once: true });
    const prevented = key('d');
    expect(prevented.defaultPrevented).toBe(true);
    expect(onSkip).not.toHaveBeenCalled();
    expect(onBack).not.toHaveBeenCalled();
  });

  it.each([
    '<input aria-label="typing" />',
    '<textarea aria-label="typing"></textarea>',
    '<select aria-label="typing"><option>D</option></select>',
    '<div contenteditable="true"><span>D</span></div>',
    '<div contenteditable="plaintext-only"><span>D</span></div>',
    '<div role="textbox" tabindex="0"><span>D</span></div>',
    '<div role="searchbox" tabindex="0">D</div>',
  ])('leaves both letters available to editable targets: %s', html => {
    const { onSkip, onBack } = start();
    const control = fixture(html);
    const target = control.querySelector('span') ?? control;
    expect(key('d', {}, target).defaultPrevented).toBe(false);
    expect(key('b', {}, target).defaultPrevented).toBe(false);
    expect(onSkip).not.toHaveBeenCalled();
    expect(onBack).not.toHaveBeenCalled();
  });

  it('respects the focused editable even when a key is dispatched on the document', () => {
    const { onSkip, onBack } = start();
    const input = fixture('<input />');
    input.focus();
    expect(document.activeElement).toBe(input);
    expect(key('d', {}, document).defaultPrevented).toBe(false);
    expect(key('b', {}, document).defaultPrevented).toBe(false);
    expect(onSkip).not.toHaveBeenCalled();
    expect(onBack).not.toHaveBeenCalled();
  });

  it('protects typing inside an open shadow root', () => {
    const { onSkip, onBack } = start();
    const host = fixture('<div></div>');
    const shadow = host.attachShadow({ mode: 'open' });
    const input = document.createElement('input');
    shadow.append(input);
    input.focus();
    expect(key('d', { composed: true }, input).defaultPrevented).toBe(false);
    expect(key('b', {}, document).defaultPrevented).toBe(false);
    expect(onSkip).not.toHaveBeenCalled();
    expect(onBack).not.toHaveBeenCalled();
  });

  it.each([
    '<div role="menu" tabindex="0"><button>D item</button></div>',
    '<div role="listbox" tabindex="0"><span>D option</span></div>',
    '<div role="combobox" tabindex="0">D</div>',
    '<button aria-haspopup="menu">D menu</button>',
    '<div popover="manual" tabindex="0"><span>D popup</span></div>',
  ])('leaves popup keyboard navigation alone: %s', html => {
    const { onSkip, onBack } = start();
    const popup = fixture(html);
    const target = popup.querySelector('button, span') ?? popup;
    expect(key('d', {}, target).defaultPrevented).toBe(false);
    expect(key('b', {}, target).defaultPrevented).toBe(false);
    expect(onSkip).not.toHaveBeenCalled();
    expect(onBack).not.toHaveBeenCalled();
  });

  it.each([
    '<dialog open>Dialog</dialog>',
    '<div role="dialog">Settings</div>',
    '<div role="alertdialog">Confirmation</div>',
    '<div aria-modal="true">Full-screen handwriting</div>',
  ])('blocks page shortcuts while a modal is open: %s', html => {
    const { onSkip, onBack } = start();
    fixture(html);
    expect(key('d').defaultPrevented).toBe(false);
    expect(key('b').defaultPrevented).toBe(false);
    expect(onSkip).not.toHaveBeenCalled();
    expect(onBack).not.toHaveBeenCalled();
  });

  it.each([
    '<dialog>Closed dialog</dialog>',
    '<div hidden><div role="dialog">Hidden dialog</div></div>',
    '<div style="display:none"><div role="dialog">Hidden dialog</div></div>',
    '<div aria-hidden="true"><div role="dialog">Hidden dialog</div></div>',
  ])('does not leave shortcuts disabled by an inactive dialog: %s', html => {
    const { onSkip } = start();
    fixture(html);
    expect(key('d').defaultPrevented).toBe(true);
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it('does not navigate while a native full-screen element is still active', () => {
    const { onSkip, onBack } = start();
    const original = Object.getOwnPropertyDescriptor(document, 'fullscreenElement');
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: fixture('<div>Fullscreen</div>') });
    try {
      expect(key('d').defaultPrevented).toBe(false);
      expect(key('b').defaultPrevented).toBe(false);
      expect(onSkip).not.toHaveBeenCalled();
      expect(onBack).not.toHaveBeenCalled();
    } finally {
      if (original) Object.defineProperty(document, 'fullscreenElement', original);
      else Reflect.deleteProperty(document, 'fullscreenElement');
    }
  });

  it('keeps the IME composition lock through rerenders and handles legacy composing key codes', () => {
    const { onSkip, onBack, rerender } = start();
    expect(key('d', { isComposing: true }).defaultPrevented).toBe(false);
    expect(key('b', { keyCode: 229 }).defaultPrevented).toBe(false);
    fireEvent.compositionStart(document);
    expect(key('d').defaultPrevented).toBe(false);
    const newSkip = vi.fn();
    rerender(<Harness enabled onSkip={newSkip} onBack={onBack} />);
    expect(key('d').defaultPrevented).toBe(false);
    fireEvent.compositionEnd(document);
    expect(key('d').defaultPrevented).toBe(true);
    expect(newSkip).toHaveBeenCalledTimes(1);
    expect(onSkip).not.toHaveBeenCalled();
    expect(onBack).not.toHaveBeenCalled();
  });

  it('recovers a lost composition-end event when the window loses focus', () => {
    const { onBack } = start();
    fireEvent.compositionStart(document);
    fireEvent.blur(window);
    expect(key('b').defaultPrevented).toBe(true);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('uses current callbacks once, and removes listeners and composition state on disable or unmount', () => {
    const { onSkip, onBack, rerender, unmount } = start();
    const next = { onSkip: vi.fn(), onBack: vi.fn() };
    rerender(<Harness enabled {...next} />);
    key('d'); key('b');
    expect(next.onSkip).toHaveBeenCalledTimes(1);
    expect(next.onBack).toHaveBeenCalledTimes(1);
    expect(onSkip).not.toHaveBeenCalled(); expect(onBack).not.toHaveBeenCalled();
    fireEvent.compositionStart(document);
    rerender(<Harness enabled={false} {...next} />);
    expect(key('d').defaultPrevented).toBe(false);
    rerender(<Harness enabled {...next} />);
    expect(key('d').defaultPrevented).toBe(true);
    expect(next.onSkip).toHaveBeenCalledTimes(2);
    unmount();
    expect(key('d').defaultPrevented).toBe(false);
    expect(key('b').defaultPrevented).toBe(false);
    expect(next.onSkip).toHaveBeenCalledTimes(2);
    expect(next.onBack).toHaveBeenCalledTimes(1);
    expect(document.body.style.overflow).toBe('');
  });
});

describe('read-only previous-word view', () => {
  const word = { id: 'previous-word', term: 'parcel' } as LearningWord;

  it('shows content without answer, grade or writing controls and exposes explicit return/older navigation', () => {
    const onClose = vi.fn(), onOlder = vi.fn();
    render(<PreviousWord word={word} onClose={onClose} onOlder={onOlder} hasOlder />);
    const panel = screen.getByTestId('previous-word');
    expect(panel.getAttribute('role')).not.toBe('dialog');
    expect(document.activeElement).toBe(panel);
    expect(screen.getByText('回看上一词 · 不重复计数')).toBeTruthy();
    expect(screen.getByTestId('presented-word').getAttribute('data-library')).toBe('true');
    expect(panel.querySelector('input, textarea, select, canvas, form')).toBeNull();
    expect(onClose).not.toHaveBeenCalled(); expect(onOlder).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('previous-word-older'));
    expect(onOlder).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('previous-word-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('disables older navigation at the start of history and refocuses the view when the displayed word changes', () => {
    const onClose = vi.fn(), onOlder = vi.fn();
    const { rerender } = render(<PreviousWord word={word} onClose={onClose} onOlder={onOlder} hasOlder={false} />);
    const older = screen.getByTestId('previous-word-older') as HTMLButtonElement;
    expect(older.disabled).toBe(true);
    fireEvent.click(older);
    expect(onOlder).not.toHaveBeenCalled();
    screen.getByTestId('previous-word-close').focus();
    rerender(<PreviousWord word={{ ...word, id: 'even-older', term: 'postage' }} onClose={onClose} onOlder={onOlder} hasOlder />);
    expect(screen.getByTestId('presented-word').textContent).toBe('postage');
    expect(document.activeElement).toBe(screen.getByTestId('previous-word'));
  });
});
