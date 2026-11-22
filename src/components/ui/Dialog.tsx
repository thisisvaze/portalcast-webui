import {
  useEffect,
  useRef,
  type KeyboardEventHandler,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  /** The id of the dialog's heading (aria-labelledby). */
  labelledBy?: string;
  /** Utilities on the panel: its width (default max-w-md), alignment... */
  className?: string;
  /** Close on a click in the dimmed area around the panel (default: yes). */
  dismissOnBackdrop?: boolean;
  /** The arrow-key focus group (useTVFocus), e.g. "cw-remove-confirm". */
  focusGroup?: string;
  /** Default true. False for a big grid of choices: useTVFocus turns off up/down by rows
   *  while a [role="dialog"] is open, which such a grid needs (CategoryPinOverlay). */
  dialogRole?: boolean;
  /** Optional keydown handler on the dialog panel (e.g. Tab focus trap or Enter submit). */
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
  children: ReactNode;
}

/**
 * A modal dialog (ui.css .ui-dialog): drawn on <body> over everything, the page dimmed behind,
 * Escape or a click outside closes it. The backdrop is a sibling of the panel (not an ancestor)
 * so the backdrop's fade animation never creates a Chromium Backdrop Root that blocks the panel's
 * frosted glass blur. Its look is driven by --ui-dialog-* tokens so a theme restyles all dialogs.
 */
export default function Dialog({
  open,
  onClose,
  labelledBy,
  className = 'max-w-md',
  dismissOnBackdrop = true,
  focusGroup,
  dialogRole = true,
  onKeyDown,
  children,
}: DialogProps) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      close.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div className="ui-dialog-layer" data-focus-group={focusGroup}>
      <div
        className="ui-dialog-backdrop"
        onClick={dismissOnBackdrop ? onClose : undefined}
        aria-hidden="true"
      />
      <div
        role={dialogRole ? 'dialog' : undefined}
        aria-modal={dialogRole || undefined}
        aria-labelledby={labelledBy}
        className={`ui-dialog ${className}`}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        {children}
      </div>
    </div>,
    document.body
  );
}

export interface DialogHeaderProps {
  id?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  onClose?: () => void;
  closeLabel?: string;
  trailing?: ReactNode;
  className?: string;
}

/** Standard dialog title bar with optional subtitle, trailing controls and themed close button. */
export function DialogHeader({
  id,
  title,
  subtitle,
  onClose,
  closeLabel = 'Close',
  trailing,
  className = '',
}: DialogHeaderProps) {
  return (
    <div className={`ui-dialog-header ${className}`}>
      <div className="min-w-0 flex-1 text-left">
        <h3 id={id} className="ui-dialog-title">
          {title}
        </h3>
        {subtitle && <p className="ui-dialog-subtitle">{subtitle}</p>}
      </div>
      {(trailing || onClose) && (
        <div className="flex shrink-0 items-center gap-2">
          {trailing}
          {onClose && (
            <button
              type="button"
              data-focusable="true"
              onClick={onClose}
              aria-label={closeLabel}
              className="ui-dialog-close"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export interface DialogRowProps {
  icon?: ReactNode;
  label: ReactNode;
  note?: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  autoFocus?: boolean;
  className?: string;
}

/** Standard interactive action row for menu/picker dialogs (TitleMenu, Sports channel picker...). */
export function DialogRow({
  icon,
  label,
  note,
  onClick,
  disabled = false,
  autoFocus = false,
  className = '',
}: DialogRowProps) {
  return (
    <button
      type="button"
      data-focusable="true"
      autoFocus={autoFocus}
      disabled={disabled}
      onClick={onClick}
      className={`ui-dialog-row ${className}`}
    >
      {icon && <span className="ui-dialog-row-icon">{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="text-fg block font-semibold">{label}</span>
        {note && (
          <span className="text-fg-muted block truncate text-xs">{note}</span>
        )}
      </span>
    </button>
  );
}

export interface DialogFooterProps {
  children: ReactNode;
  className?: string;
}

/** Standard bottom action bar for dialogs. */
export function DialogFooter({ children, className = '' }: DialogFooterProps) {
  return <div className={`ui-dialog-footer ${className}`}>{children}</div>;
}
