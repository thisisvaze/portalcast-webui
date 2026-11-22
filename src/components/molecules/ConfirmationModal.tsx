import React, { useEffect, useRef } from 'react';
import Dialog, { DialogFooter, DialogHeader } from '@/components/ui/Dialog';
import Button from '@/components/ui/Button';

type ConfirmationModalProps = {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  isDestructive?: boolean;
};

const ConfirmationModal: React.FC<
  ConfirmationModalProps & {
    showInput?: boolean;
    inputValue?: string;
    inputPlaceholder?: string;
    onInputChange?: (val: string) => void;
  }
> = ({
  isOpen,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
  isDestructive = false,
  showInput = false,
  inputValue = '',
  inputPlaceholder = '',
  onInputChange,
}) => {
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isOpen) {
      // Modal open aana udane focus-ai inge thalluvom
      confirmButtonRef.current?.focus();
    }
  }, [isOpen]);
  if (!isOpen) return null;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (showInput && (e.target as HTMLElement).tagName === 'INPUT') {
        onConfirm();
      }
    } else if (e.key === 'Escape') {
      onCancel();
    }
  };

  return (
    <Dialog
      open={isOpen}
      onClose={onCancel}
      labelledBy="modal-title"
      onKeyDown={handleKeyDown}
      className="max-w-md text-left"
    >
      <DialogHeader id="modal-title" title={title} subtitle={message} />

      {showInput && (
        <input
          type="text"
          value={inputValue}
          onChange={(e) => onInputChange?.(e.target.value)}
          placeholder={inputPlaceholder}
          data-focusable="true"
          autoFocus
          className="ui-field-input mt-4 rounded-lg px-3 py-2"
        />
      )}

      <DialogFooter>
        <Button variant="secondary" onClick={onCancel}>
          {cancelLabel}
        </Button>
        <Button
          ref={confirmButtonRef}
          variant={isDestructive ? 'danger' : 'accent'}
          onClick={onConfirm}
        >
          {confirmLabel}
        </Button>
      </DialogFooter>
    </Dialog>
  );
};

export default ConfirmationModal;
