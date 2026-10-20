import { useEffect, useLayoutEffect, useRef } from 'react';

export interface StudyShortcutOptions {
  enabled: boolean;
  onSkip: () => void;
  onBack: () => void;
}

export const DESKTOP_SHORTCUT_QUERY = '(hover: hover) and (pointer: fine)';

const editableSelector = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role~="textbox"], [role~="searchbox"], [role~="combobox"]';
const popupSelector = 'dialog, menu, [popover], [role~="menu"], [role~="menubar"], [role~="listbox"], [role~="combobox"], [role~="tree"], [role~="grid"], [aria-haspopup]:not([aria-haspopup="false"])';

function ownsKeyboard(element: EventTarget | null): boolean {
  return element instanceof Element && Boolean(element.closest(`${editableSelector}, ${popupSelector}`));
}

function modalIsOpen(): boolean {
  const dialogs = document.querySelectorAll('dialog[open], [role~="dialog"], [role~="alertdialog"], [aria-modal="true"]');
  return Array.from(dialogs).some(dialog => {
    for (let element: Element | null = dialog; element; element = element.parentElement) {
      if (element.hasAttribute('hidden') || element.hasAttribute('inert') || element.getAttribute('aria-hidden') === 'true') return false;
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
    }
    return true;
  });
}

/** Page-level navigation only: typing, IME, dialogs and popup keyboard controls keep their normal keys. */
export function useStudyShortcuts({ enabled, onSkip, onBack }: StudyShortcutOptions): void {
  const handlers = useRef({ onSkip, onBack });
  const composing = useRef(false);

  useLayoutEffect(() => { handlers.current = { onSkip, onBack }; }, [onSkip, onBack]);

  useEffect(() => {
    if (!enabled) return;
    const desktop = typeof window.matchMedia === 'function' ? window.matchMedia(DESKTOP_SHORTCUT_QUERY) : null;
    const compositionStart = () => { composing.current = true; };
    const compositionEnd = () => { composing.current = false; };
    const keydown = (event: KeyboardEvent) => {
      if (!desktop?.matches || event.defaultPrevented || event.repeat || event.isComposing || composing.current
        || event.keyCode === 229 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const key = event.key.toLowerCase();
      if (key !== 'd' && key !== 'b') return;
      if (event.composedPath().some(ownsKeyboard) || ownsKeyboard(event.target)) return;
      for (let focused = document.activeElement; focused; focused = focused.shadowRoot?.activeElement ?? null) {
        if (ownsKeyboard(focused)) return;
      }
      if (document.fullscreenElement || modalIsOpen()) return;
      event.preventDefault();
      if (key === 'd') handlers.current.onSkip();
      else handlers.current.onBack();
    };
    // Bubble at the window, after editable controls and application handlers have had their turn.
    window.addEventListener('keydown', keydown);
    document.addEventListener('compositionstart', compositionStart, true);
    document.addEventListener('compositionend', compositionEnd, true);
    window.addEventListener('blur', compositionEnd);
    return () => {
      composing.current = false;
      window.removeEventListener('keydown', keydown);
      document.removeEventListener('compositionstart', compositionStart, true);
      document.removeEventListener('compositionend', compositionEnd, true);
      window.removeEventListener('blur', compositionEnd);
    };
  }, [enabled]);
}
