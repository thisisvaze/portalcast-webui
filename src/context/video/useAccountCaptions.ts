import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { LIVE_CAPTIONS_ID } from '@/utils/liveCaptions/preference';

const legacy = 'portalcast:autoCaptions:en';
const key = (id: number | undefined) => `${legacy}:${id ?? 'guest'}`;
const attempted = new Set<number>();
function cached(id: number | undefined) {
  try { return localStorage.getItem(key(id)); } catch { return null; }
}
function cache(id: number | undefined, enabled: boolean) {
  try { localStorage.setItem(key(id), enabled ? '1' : '0'); } catch { /* storage unavailable */ }
}

export function useAccountCaptions() {
  const { user, updatePreferences, loading } = useAuth();
  const id = user?.id;
  const saved = user?.preferences?.autoEnglishCaptions;
  const [local, setLocal] = useState<{ id?: number; enabled: boolean } | null>(null);
  const queue = useRef(Promise.resolve());
  const write = useCallback((enabled: boolean) => {
    const choice = { id, enabled };
    cache(id, enabled);
    setLocal(choice);
    if (id == null) return;
    // Keep rapid Auto → Off selections in order, even when the first request is slow.
    queue.current = queue.current.then(async () => {
      const prefs = await updatePreferences({ autoEnglishCaptions: enabled });
      if (prefs.autoEnglishCaptions === enabled) {
        setLocal(current => current === choice ? null : current);
      }
    });
  }, [id, updatePreferences]);

  useEffect(() => {
    if (id == null || loading) return;
    let existing = cached(id);
    // Claim the old browser-only opt-in once, for the signed-in account.
    try {
      if (existing === null && localStorage.getItem(legacy) === '1') existing = '1';
      localStorage.removeItem(legacy);
    } catch { /* no legacy choice */ }
    if (typeof saved === 'boolean') {
      if (!local) cache(id, saved);
    } else if (existing !== null && !attempted.has(id)) {
      attempted.add(id);
      write(existing === '1');
    }
  }, [id, saved, loading, local, write]);

  const chooseCaption = useCallback((trackId?: string) => {
    if (id != null) attempted.add(id);
    write(trackId === LIVE_CAPTIONS_ID);
  }, [id, write]);
  const autoCaptions = local && local.id === id ? local.enabled : saved ?? (cached(id) === '1');
  return { autoCaptions, chooseCaption };
}
