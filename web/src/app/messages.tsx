// Short confirmations ("Approved. Now send it from your email.", "Marked paid." with Undo) and screen-reader
// announcements ("Sent. 3 left."). A message stays 6 seconds and holds while it is hovered or focused; Undo is also
// kept on the record, so this is never the only chance (WCAG 2.2.1; UI brief, Components).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface Message {
  text: string;
  action?: { label: string; run: () => void | Promise<void> };
}

interface MessagesValue {
  show: (message: Message) => void;
  announce: (text: string) => void;
}

const MessagesContext = createContext<MessagesValue | null>(null);

export const useMessages = (): MessagesValue => {
  const value = useContext(MessagesContext);
  if (!value) throw new Error('useMessages needs MessagesProvider');
  return value;
};

const VISIBLE_MS = 6000;

export const MessagesProvider = ({ children }: { children: ReactNode }) => {
  const [current, setCurrent] = useState<(Message & { id: number }) | null>(null);
  const [spoken, setSpoken] = useState('');
  const [held, setHeld] = useState(false);
  const counter = useRef(0);

  const show = useCallback((message: Message) => {
    counter.current += 1;
    setCurrent({ ...message, id: counter.current });
  }, []);

  const announce = useCallback((text: string) => {
    // Clearing first makes screen readers repeat a message that happens to match the last one.
    setSpoken('');
    window.setTimeout(() => setSpoken(text), 50);
  }, []);

  useEffect(() => {
    if (!current || held) return;
    const timer = window.setTimeout(() => setCurrent(null), VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [current, held]);

  const value = useMemo(() => ({ show, announce }), [show, announce]);

  // An open modal sheet makes the rest of the page inert, so messages move into the top sheet while one is open:
  // otherwise "Marked paid. Undo" would sit behind it, out of reach and unannounced.
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const pick = () => {
      const open = document.querySelectorAll<HTMLDialogElement>('dialog[open]');
      setHost(open.length > 0 ? (open[open.length - 1] ?? null) : null);
    };
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
            onMouseEnter={() => setHeld(true)}
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
