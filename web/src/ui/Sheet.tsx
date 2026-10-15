// Sheets and dialogs (Reject, Send, Mark paid, mass close, delete). A native modal dialog: the page behind is
// inert, focus starts inside on the first field or the safe choice, Escape closes it and focus returns to the
// button that opened it (App Flow, Accessibility in the flows; WCAG 2.4.3).
import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Where focus starts: the first field, or the safe choice in a warning. */
  initialFocus?: RefObject<HTMLElement | null>;
  /** While an action runs, Escape and the backdrop do nothing. */
  busy?: boolean;
  /** Dialogs that ask a yes-or-no question use alertdialog. */
  alert?: boolean;
  /** Hide the close button when the dialog must be answered (for example "Did it send?"). */
  dismissible?: boolean;
  className?: string;
}

export const Sheet = ({ open, onClose, title, children, footer, initialFocus, busy = false, alert = false, dismissible = true, className }: SheetProps) => {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const opener = useRef<Element | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      opener.current = document.activeElement;
      dialog.showModal();
      const target =
        initialFocus?.current ??
        dialog.querySelector<HTMLElement>('.sheet-body input, .sheet-body textarea, .sheet-body select') ??
        dialog.querySelector<HTMLElement>('.sheet-foot .btn, .sheet-body .btn');
      target?.focus();
    }
    if (!open && dialog.open) dialog.close();
  }, [open, initialFocus]);

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
            <h2 id={titleId} className="t-heading">
              {title}
            </h2>
            {dismissible ? (
              <button type="button" className="icon-button" aria-label="Close" onClick={() => !busy && onClose()}>
                <X size={20} strokeWidth={1.5} aria-hidden="true" />
              </button>
            ) : null}
          </div>
          <div className="sheet-body">{children}</div>
          {footer ? <div className="sheet-foot">{footer}</div> : null}
        </>
      ) : null}
    </dialog>
  );
};
