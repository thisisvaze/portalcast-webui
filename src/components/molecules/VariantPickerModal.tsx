import React, { useEffect, useRef } from 'react';
import { URL_PATHS } from '@/api/config';
import type { DiscoverVariant } from '@/api/endpoints/discover';
import Dialog, { DialogFooter, DialogHeader } from '@/components/ui/Dialog';
import Button from '@/components/ui/Button';

interface VariantPickerModalProps {
  isOpen: boolean;
  title: string;
  variants: DiscoverVariant[];
  onSelect: (variant: DiscoverVariant) => void;
  onClose: () => void;
}

const VariantPickerModal: React.FC<VariantPickerModalProps> = ({
  isOpen,
  title,
  variants,
  onSelect,
  onClose,
}) => {
  const firstButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isOpen) firstButtonRef.current?.focus();
  }, [isOpen]);

  if (!isOpen) return null;

  const baseUrl = URL_PATHS.HOST === '/' ? '' : URL_PATHS.HOST;

  return (
    <Dialog
      open={isOpen}
      onClose={onClose}
      labelledBy="variant-modal-title"
      className="max-w-lg text-left"
    >
      <DialogHeader
        id="variant-modal-title"
        title={title}
        subtitle="This title is available in multiple versions — pick one:"
        onClose={onClose}
        className="mb-5"
      />

      <div className="custom-scrollbar grid max-h-136 grid-cols-3 gap-3 overflow-y-auto">
        {variants.map((variant, index) => {
          const imageUrl = variant.screenshot_uri
            ? variant.screenshot_uri.startsWith('http')
              ? variant.screenshot_uri
              : `${baseUrl}/api/images${variant.screenshot_uri}`
            : null;
          return (
            <button
              key={`${variant.id}-${index}`}
              ref={index === 0 ? firstButtonRef : undefined}
              onClick={() => onSelect(variant)}
              data-focusable="true"
              className="group border-line hover:border-focus/60 hover:bg-interaction focus-visible:ring-focus flex flex-col items-center gap-2 rounded-xl border bg-white/5 p-2 text-center transition-all focus:outline-hidden focus-visible:ring-2"
            >
              <div className="flex aspect-2/3 w-full items-center justify-center overflow-hidden rounded-lg bg-black/30">
                {imageUrl ? (
                  <img
                    src={imageUrl}
                    alt={variant.variantLabel}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="text-2xl font-bold text-white/20">
                    {variant.variantLabel[0]?.toUpperCase()}
                  </span>
                )}
              </div>
              <span className="text-fg-soft group-hover:text-fg text-xs font-bold sm:text-sm">
                {variant.variantLabel}
              </span>
            </button>
          );
        })}
      </div>

      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      </DialogFooter>
    </Dialog>
  );
};

export default VariantPickerModal;
