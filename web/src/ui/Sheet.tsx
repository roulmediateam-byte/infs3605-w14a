// Sheets and dialogs (Reject, Send, Mark paid, mass close, delete). A native modal dialog: the page behind is
// inert, focus starts inside on the first field or the safe choice, Escape closes it and focus returns to the
// button that opened it (App Flow, Accessibility in the flows; WCAG 2.4.3). Sheets that are mostly for reading
// start on their title instead, so a phone doesn't raise its keyboard or date picker uninvited. While a sheet is
// open, messages appear as a status line under its header (src/app/messages.tsx), never over its title or Close.
import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Where focus starts: the first field, the safe choice in a warning, or 'title' for a sheet that is mostly for reading. */
  initialFocus?: RefObject<HTMLElement | null> | 'title';
  /** While an action runs, Escape and the backdrop do nothing. */
  busy?: boolean;
  /** Dialogs that ask a yes-or-no question use alertdialog. */
  alert?: boolean;
  /** Hide the close button when the dialog must be answered (for example "Did it send?"). */
  dismissible?: boolean;
  /** A sheet with steps (Send): when the step changes, the body goes back to its top and focus moves to the title. */
  step?: string;
  className?: string;
}

export const Sheet = ({ open, onClose, title, children, footer, initialFocus, busy = false, alert = false, dismissible = true, step, className }: SheetProps) => {
  const ref = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const opener = useRef<Element | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const shownStep = useRef(step);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      opener.current = document.activeElement;
      dialog.showModal();
      shownStep.current = step;
      const target =
        initialFocus === 'title'
          ? titleRef.current
          : (initialFocus?.current ??
            dialog.querySelector<HTMLElement>('.sheet-body input, .sheet-body textarea, .sheet-body select') ??
            dialog.querySelector<HTMLElement>('.sheet-foot .btn, .sheet-body .btn'));
      target?.focus();
    }
    if (!open && dialog.open) dialog.close();
    // step only matters once the sheet is open (below).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialFocus]);

  // A new step starts at its top, with focus on its title, so its explanation is never left above the visible area.
  useEffect(() => {
    if (!open || step === shownStep.current) return;
    shownStep.current = step;
    bodyRef.current?.scrollTo({ top: 0 });
    titleRef.current?.focus({ preventScroll: true });
  }, [open, step]);

  useEffect(
    () => () => {
      // Return focus to whatever opened the sheet, if it is still on the page.
      const element = opener.current as HTMLElement | null;
      if (element && document.contains(element) && typeof element.focus === 'function') element.focus();
    },
    [],
  );

  useEffect(() => {
    if (open) return;
    const element = opener.current as HTMLElement | null;
    if (element && document.contains(element) && typeof element.focus === 'function') element.focus();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={`sheet${className ? ` ${className}` : ''}`}
      aria-labelledby={titleId}
      role={alert ? 'alertdialog' : undefined}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy && dismissible) closeRef.current();
      }}
      onClick={(event) => {
        if (event.target === ref.current && !busy && dismissible) closeRef.current();
      }}
    >
      {open ? (
        <>
          <div className="sheet-head">
            <h2 id={titleId} ref={titleRef} tabIndex={-1} className="t-heading">
              {title}
            </h2>
            {dismissible ? (
              <button type="button" className="icon-button" aria-label="Close" onClick={() => !busy && onClose()}>
                <X size={20} strokeWidth={1.5} aria-hidden="true" />
              </button>
            ) : null}
          </div>
          {/* Messages shown while this sheet is open go here, under its header (src/app/messages.tsx). */}
          <div className="sheet-status" />
          <div className="sheet-body" ref={bodyRef}>
            {children}
          </div>
          {footer ? <div className="sheet-foot">{footer}</div> : null}
        </>
      ) : null}
    </dialog>
  );
};
