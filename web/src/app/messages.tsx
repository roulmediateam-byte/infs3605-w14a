// Short confirmations ("Sent. 3 left.", "Marked paid." with Undo) and screen-reader announcements. A message stays 6
// seconds and holds while it is focused, or hovered unless it lies over a control the pointer may be heading for;
// Undo is also kept on the record, so this is never the only chance (WCAG 2.2.1; UI brief, Components).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface Message {
  text: string;
  action?: { label: string; run: () => void | Promise<void> };
}

interface MessagesValue {
  show: (message: Message) => void;
  announce: (text: string) => void;
  /** Takes away the message on screen, such as "Approved…" once the Send sheet that follows it opens. */
  dismiss: () => void;
}

const MessagesContext = createContext<MessagesValue | null>(null);

export const useMessages = (): MessagesValue => {
  const value = useContext(MessagesContext);
  if (!value) throw new Error('useMessages needs MessagesProvider');
  return value;
};

const VISIBLE_MS = 6000;

const CONTROLS = 'a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"])';

/** Whether a floating message lies over a control outside it, which holding it open on hover would block. */
const coversControl = (toast: HTMLElement): boolean => {
  if (toast.closest('.sheet-status')) return false; // In a sheet it is a line in the flow, over nothing.
  const box = toast.getBoundingClientRect();
  return Array.from(document.querySelectorAll<HTMLElement>(CONTROLS)).some((control) => {
    if (toast.contains(control)) return false;
    const r = control.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.left < box.right && r.right > box.left && r.top < box.bottom && r.bottom > box.top;
  });
};

/** Where messages go: the status line under the header of the top open sheet, or the page while none is open. */
const messageHost = (): HTMLElement | null => {
  const open = document.querySelectorAll<HTMLDialogElement>('dialog[open]');
  const top = open.length > 0 ? (open[open.length - 1] ?? null) : null;
  if (!top) return null;
  return top.querySelector<HTMLElement>(':scope > .sheet-status') ?? top;
};

export const MessagesProvider = ({ children }: { children: ReactNode }) => {
  const [current, setCurrent] = useState<(Message & { id: number }) | null>(null);
  const [spoken, setSpoken] = useState('');
  const [held, setHeld] = useState(false);
  const counter = useRef(0);

  const show = useCallback((message: Message) => {
    counter.current += 1;
    setHeld(false);
    setCurrent({ ...message, id: counter.current });
  }, []);

  const announce = useCallback((text: string) => {
    // Clearing first makes screen readers repeat a message that happens to match the last one.
    setSpoken('');
    window.setTimeout(() => setSpoken(text), 50);
  }, []);

  const dismiss = useCallback(() => {
    setCurrent(null);
    setHeld(false);
  }, []);

  useEffect(() => {
    if (!current || held) return;
    const timer = window.setTimeout(() => setCurrent(null), VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [current, held]);

  const value = useMemo(() => ({ show, announce, dismiss }), [show, announce, dismiss]);

  // An open modal sheet makes the rest of the page inert, so messages move into the top sheet while one is open:
  // otherwise "Marked paid. Undo" would sit behind it, out of reach and unannounced. There they are a status line
  // under the sheet's header, in the flow, so they never cover its title or its Close button.
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const pick = () => setHost(messageHost());
    pick();
    const observer = new MutationObserver(pick);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['open'] });
    return () => observer.disconnect();
  }, []);

  const regions = (
    <>
      <div className="visually-hidden" aria-live="polite" aria-atomic="true">
        {spoken}
      </div>
      <div className="toast-region" role="status" aria-live="polite" aria-atomic="true">
        {current ? (
          <div
            className="toast"
            key={current.id}
            onMouseEnter={(event) => {
              if (!coversControl(event.currentTarget)) setHeld(true);
            }}
            onMouseLeave={() => setHeld(false)}
            onFocus={() => setHeld(true)}
            onBlur={() => setHeld(false)}
          >
            <span className="toast-text">{current.text}</span>
            {current.action ? (
              <button
                type="button"
                className="toast-action"
                onClick={() => {
                  const action = current.action;
                  setCurrent(null);
                  setHeld(false);
                  void action?.run();
                }}
              >
                {current.action.label}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </>
  );

  return (
    <MessagesContext.Provider value={value}>
      {children}
      {createPortal(regions, host ?? document.body)}
    </MessagesContext.Provider>
  );
};
