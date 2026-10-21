// Base components (UI brief, Components). Each is built once and reused, never restyled per screen, and none
// ships without its focus and busy states.
import { CircleAlert, Info } from 'lucide-react';
import {
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { takeMoveFlag } from '../app/router.tsx';
import type { ChipTone } from '../lib/words.ts';

// ---------------------------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------------------------
export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'disabled'> {
  variant?: 'primary' | 'secondary' | 'quiet' | 'danger' | 'danger-outline';
  size?: 'md' | 'lg';
  block?: boolean;
  /** Shows progress and words such as "Approving…", and ignores taps (flow rule 3). */
  busy?: boolean;
  busyLabel?: string;
  /** Unavailable but still focusable, so it can explain itself. */
  unavailable?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

export const Button = ({
  variant = 'secondary',
  size = 'md',
  block = false,
  busy = false,
  busyLabel,
  unavailable = false,
  className,
  children,
  onClick,
  type = 'button',
  ref,
  ...rest
}: ButtonProps) => {
  const classes = ['btn', `btn-${variant}`, size === 'lg' ? 'btn-lg' : '', block ? 'btn-block' : '', className ?? ''].filter(Boolean).join(' ');
  return (
    <button
      ref={ref}
      type={type}
      className={classes}
      aria-busy={busy || undefined}
      aria-disabled={busy || unavailable || undefined}
      onClick={(event) => {
        if (busy || unavailable) {
          event.preventDefault();
          return;
        }
        onClick?.(event);
      }}
      {...rest}
    >
      {busy ? (
        <>
          <span className="spinner" aria-hidden="true" />
          <span>{busyLabel ?? children}</span>
        </>
      ) : (
        children
      )}
    </button>
  );
};

// ---------------------------------------------------------------------------------------------
// Chip: a word first, colour second
// ---------------------------------------------------------------------------------------------
export const Chip = ({ tone = 'neutral', children, className }: { tone?: ChipTone; children: ReactNode; className?: string }) => (
  <span className={`chip${tone === 'neutral' ? '' : ` chip-${tone}`}${className ? ` ${className}` : ''}`}>{children}</span>
);

// ---------------------------------------------------------------------------------------------
// The screen's one title. It takes focus after the person moves between screens (WCAG 2.4.3).
// ---------------------------------------------------------------------------------------------
export const PageTitle = ({
  children,
  documentTitle,
  className,
  focusOnMount = false,
}: {
  children: ReactNode;
  documentTitle: string;
  className?: string;
  /** Take focus on arrival even without a change of address, as Edit does when it opens over Review (WCAG 2.4.3). */
  focusOnMount?: boolean;
}) => {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    document.title = `${documentTitle} · Get-Paid Apprentice`;
    const moved = takeMoveFlag();
    if (moved || focusOnMount) ref.current?.focus({ preventScroll: true });
    // focusOnMount only matters on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentTitle]);
  return (
    <h1 ref={ref} tabIndex={-1} className={className ?? 't-title'}>
      {children}
    </h1>
  );
};

// ---------------------------------------------------------------------------------------------
// Fields: a visible label, an optional hint and an error that names the fix
// ---------------------------------------------------------------------------------------------
interface FieldShellProps {
  id?: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
  className?: string;
}

export const FieldShell = ({ id: givenId, label, hint, error, children, className }: FieldShellProps) => {
  const generatedId = useId();
  const id = givenId ?? generatedId;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={`field${className ? ` ${className}` : ''}`}>
      <label htmlFor={id}>{label}</label>
      {children({ id, describedBy, invalid: Boolean(error) })}
      {error ? (
        <p className="field-error" id={errorId}>
          <CircleAlert size={16} strokeWidth={2} aria-hidden="true" />
          <span>{error}</span>
        </p>
      ) : null}
      {hint ? (
        <p className="field-hint" id={hintId}>
          {hint}
        </p>
      ) : null}
    </div>
  );
};

type InputFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  ref?: Ref<HTMLInputElement>;
  inputClassName?: string;
};

export const TextField = ({ id, label, hint, error, className, inputClassName, ref, ...rest }: InputFieldProps) => (
  <FieldShell id={id} label={label} hint={hint} error={error} className={className}>
    {({ id, describedBy, invalid }) => (
      <input
        ref={ref}
        id={id}
        className={`input${inputClassName ? ` ${inputClassName}` : ''}`}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        {...rest}
      />
    )}
  </FieldShell>
);

type TextAreaFieldProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  ref?: Ref<HTMLTextAreaElement>;
  textareaClassName?: string;
};

export const TextAreaField = ({ id, label, hint, error, className, textareaClassName, ref, onFocus, ...rest }: TextAreaFieldProps) => (
  <FieldShell id={id} label={label} hint={hint} error={error} className={className}>
    {({ id, describedBy, invalid }) => (
      <textarea
        ref={ref}
        id={id}
        className={`textarea${textareaClassName ? ` ${textareaClassName}` : ''}`}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        onFocus={(event) => {
          onFocus?.(event);
          // Browsers only bring the caret into view, which can leave a tall box half under a sticky bar: show it whole.
          event.currentTarget.scrollIntoView({ block: 'nearest' });
        }}
        {...rest}
      />
    )}
  </FieldShell>
);

type SelectFieldProps = SelectHTMLAttributes<HTMLSelectElement> & {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  ref?: Ref<HTMLSelectElement>;
  children: ReactNode;
};

export const SelectField = ({ id, label, hint, error, className, children, ref, ...rest }: SelectFieldProps) => (
  <FieldShell id={id} label={label} hint={hint} error={error} className={className}>
    {({ id, describedBy, invalid }) => (
      <select ref={ref} id={id} className="select" aria-describedby={describedBy} aria-invalid={invalid || undefined} {...rest}>
        {children}
      </select>
    )}
  </FieldShell>
);

/** Radio choices drawn as chips (filters, reject reasons) or as a segmented control (tone). */
export const Choices = <T extends string>({
  legend,
  name,
  value,
  options,
  onChange,
  segmented = false,
  hideLegend = false,
  error,
}: {
  legend: string;
  name: string;
  value: T | null;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  segmented?: boolean;
  hideLegend?: boolean;
  error?: string | null;
}) => {
  const errorId = useId();
  return (
    <fieldset className="choices" aria-describedby={error ? errorId : undefined}>
      <legend className={hideLegend ? 'visually-hidden' : undefined}>{legend}</legend>
      <div className={segmented ? 'segmented' : 'row-wrap'}>
        {options.map((option) => (
          <label className="choice" key={option.value}>
            <input type="radio" name={name} value={option.value} checked={value === option.value} onChange={() => onChange(option.value)} />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
      {error ? (
        <p className="field-error" id={errorId} style={{ flexBasis: '100%' }}>
          <CircleAlert size={16} strokeWidth={2} aria-hidden="true" />
          <span>{error}</span>
        </p>
      ) : null}
    </fieldset>
  );
};

// ---------------------------------------------------------------------------------------------
// Banners, notes, empty states and skeletons
// ---------------------------------------------------------------------------------------------
export const Banner = ({ tone = 'info', children, role }: { tone?: 'info' | 'warning'; children: ReactNode; role?: 'status' | 'alert' }) => (
  <div className={`banner${tone === 'warning' ? ' banner-warning' : ''}`} role={role}>
    {tone === 'warning' ? <CircleAlert size={20} strokeWidth={1.5} aria-hidden="true" /> : <Info size={20} strokeWidth={1.5} aria-hidden="true" />}
    <div>{children}</div>
  </div>
);

export const EmptyState = ({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) => (
  <div className="empty">
    <h2 className="t-heading">{title}</h2>
    {children ? <p className="t-secondary">{children}</p> : null}
    {action ? <div>{action}</div> : null}
  </div>
);

export const Skeleton = ({ width = '100%', height = 16, className }: { width?: number | string; height?: number; className?: string }) => (
  <span className={`skeleton${className ? ` ${className}` : ''}`} style={{ width, height }} aria-hidden="true" />
);

export const LoadingBlock = ({ label = 'Loading' }: { label?: string }) => (
  <div className="stack-sm" role="status" aria-label={label}>
    <Skeleton width="40%" height={20} />
    <Skeleton height={56} />
    <Skeleton height={56} />
    <Skeleton height={56} />
  </div>
);

export const ErrorPanel = ({ message, onRetry }: { message: string; onRetry?: () => void }) => (
  <div className="error-panel stack-sm" role="alert">
    <p>{message}</p>
    {onRetry ? (
      <Button variant="secondary" onClick={onRetry}>
        Try again
      </Button>
    ) : null}
  </div>
);

export const FormError = ({ message }: { message: string | null | undefined }) =>
  message ? (
    <p className="field-error" role="alert">
      <CircleAlert size={16} strokeWidth={2} aria-hidden="true" />
      <span>{message}</span>
    </p>
  ) : null;
