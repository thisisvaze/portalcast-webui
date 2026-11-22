import React, { useEffect, useState } from 'react';
import {
  Bookmark,
  BookmarkCheck,
  Check,
  EyeOff,
  Info,
  Trash2,
} from 'lucide-react';
import type { MediaItem } from '@/types';
import type { TitleMenuExtra } from '@/context/TitleMenuContext';
import { contentIdOf } from '@/utils/contentId';
import { getMyListIds, setInMyList } from '@/api/endpoints/discover';
import { setNotInterested, setWatched } from '@/api/endpoints/user';
import { markHidden, useHiddenTitles } from '@/utils/hiddenTitles';
import Dialog, { DialogHeader, DialogRow } from '@/components/ui/Dialog';

interface TitleMenuProps {
  item: MediaItem;
  extra?: TitleMenuExtra;
  onClose: () => void;
  /** Something changed (watched, hidden, list): App refreshes Home and Continue Watching. */
  onChanged: () => void;
}

/**
 * The title menu (owner, 2026-10-22: hold a title on the TV and the phone, click on a PC):
 * My List, Mark as watched, Not interested (off your Home rows: new things instead of the
 * same ones) and, on Continue Watching, Remove. A sheet from the bottom on a phone, a small
 * panel in the middle on wider screens (Dialog). Escape or a tap outside closes it.
 */
const TitleMenu: React.FC<TitleMenuProps> = ({
  item,
  extra,
  onClose,
  onChanged,
}) => {
  const id = contentIdOf(item);
  const hidden = useHiddenTitles();
  const [inList, setInList] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const title = String(
    (item as unknown as { cw_show_title?: string }).cw_show_title ||
      item.title ||
      item.name ||
      ''
  );

  useEffect(() => {
    if (!id) return;
    getMyListIds()
      .then((ids) => setInList(ids ? ids.has(id) : null))
      .catch(() => {});
  }, [id]);

  const run = async (label: string, action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
      onChanged();
      setDone(label);
      setTimeout(onClose, 700);
    } catch {
      setDone("Couldn't do that. Try again.");
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      labelledBy="title-menu-title"
      focusGroup="title-menu"
      className="max-w-md self-end p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:self-center sm:p-4"
    >
      <DialogHeader
        id="title-menu-title"
        title={<span className="block truncate">{title}</span>}
        onClose={onClose}
        className="px-2 pb-2"
      />
      {done ? (
        <p className="text-accent flex items-center gap-2 px-3 py-5 text-sm font-semibold">
          <Check className="h-4 w-4" /> {done}
        </p>
      ) : !id ? (
        <p className="text-fg-muted px-3 py-5 text-sm">
          Nothing to do for this one.
        </p>
      ) : (
        <div className="space-y-0.5 border-t border-[var(--ui-dialog-divider)] pt-2">
          {extra?.onDetails && (
            <DialogRow
              disabled={busy}
              icon={<Info className="h-5 w-5" />}
              label="Details"
              note="Its page: episodes, cast, more like this"
              onClick={() => {
                onClose();
                extra.onDetails!();
              }}
            />
          )}
          {inList !== null && (
            <DialogRow
              disabled={busy}
              icon={
                inList ? (
                  <BookmarkCheck className="h-5 w-5" />
                ) : (
                  <Bookmark className="h-5 w-5" />
                )
              }
              label={inList ? 'Remove from My List' : 'Add to My List'}
              onClick={() =>
                void run(
                  inList ? 'Removed from My List' : 'Added to My List',
                  () => setInMyList(id, !inList)
                )
              }
            />
          )}
          <DialogRow
            disabled={busy}
            icon={<Check className="h-5 w-5" />}
            label="Mark as watched"
            note="Leaves Continue Watching and your suggestions"
            onClick={() =>
              void run('Marked as watched', () => setWatched(id, true))
            }
          />
          {hidden.has(id) ? (
            <DialogRow
              disabled={busy}
              icon={<EyeOff className="h-5 w-5" />}
              label="Show on Home again"
              note="You said Not interested"
              onClick={() =>
                void run('It can show on Home again', async () => {
                  await setNotInterested(id, false);
                  markHidden(id, false);
                })
              }
            />
          ) : (
            <DialogRow
              disabled={busy}
              icon={<EyeOff className="h-5 w-5" />}
              label="Not interested"
              note="Keeps it off your Home rows (undo in My List)"
              onClick={() =>
                void run("Got it: you won't see it on Home", async () => {
                  await setNotInterested(id, true);
                  markHidden(id, true);
                })
              }
            />
          )}
          {extra?.onRemoveFromContinue && (
            <DialogRow
              disabled={busy}
              icon={<Trash2 className="h-5 w-5" />}
              label="Remove from Continue Watching"
              note="Your place in it is forgotten"
              onClick={() =>
                void run('Removed from Continue Watching', async () => {
                  extra.onRemoveFromContinue!();
                })
              }
            />
          )}
        </div>
      )}
    </Dialog>
  );
};

export default TitleMenu;
