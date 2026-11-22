import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import {
  getOpenSubtitlesStatus,
  linkOpenSubtitles,
  unlinkOpenSubtitles,
  setSubdlKey,
  removeSubdlKey,
  type OpenSubtitlesLinkStatus,
} from '@/api/endpoints/user';
import Dialog, { DialogFooter, DialogHeader } from '@/components/ui/Dialog';
import Button from '@/components/ui/Button';

type OpenSubtitlesModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

const inputClass = 'ui-field-input rounded-lg px-3 py-2';

const errorText = (err: unknown, fallback: string) =>
  (err as { response?: { data?: { error?: string } } })?.response?.data
    ?.error || fallback;

/**
 * The user's own subtitle accounts: OpenSubtitles login and/or API key, and a SubDL key.
 * Downloads then use their own quota and work even when the server has no key. Keys and
 * passwords are verified and stored encrypted by the server and never shown again.
 */
const OpenSubtitlesModal: React.FC<OpenSubtitlesModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [status, setStatus] = useState<OpenSubtitlesLinkStatus | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [osKey, setOsKey] = useState('');
  const [subdlKey, setSubdlKeyInput] = useState('');
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(() => {
    getOpenSubtitlesStatus()
      .then(setStatus)
      .catch(() => setStatus({ linked: false, username: null }));
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setStatus(null);
    refresh();
  }, [isOpen, refresh]);

  if (!isOpen) return null;

  const run = async (fn: () => Promise<void>, ok: string, fail: string) => {
    setLoading(true);
    try {
      await fn();
      toast.success(ok);
      setPassword('');
      setOsKey('');
      setSubdlKeyInput('');
      refresh();
    } catch (err) {
      toast.error(errorText(err, fail));
    } finally {
      setLoading(false);
    }
  };

  const saveOpenSubtitles = () => {
    if (!username && !osKey)
      return toast.error('Enter your OpenSubtitles login or API key');
    if (username && !password)
      return toast.error('Enter your OpenSubtitles password');
    void run(
      () => linkOpenSubtitles(username, password, osKey || undefined),
      'OpenSubtitles saved',
      'Could not save — check your details'
    );
  };

  const osKeyLine = !status
    ? null
    : status.hasOwnApiKey
      ? 'Using your own API key'
      : status.serverHasApiKey
        ? "Using the server's API key"
        : 'No API key yet — add one (free at opensubtitles.com/consumers)';
  const subdl = status?.subdl;

  return (
    <Dialog
      open={isOpen}
      onClose={onClose}
      labelledBy="opensubtitles-modal-title"
      dismissOnBackdrop={false}
      className="max-h-[90vh] max-w-md text-left"
    >
      <DialogHeader
        id="opensubtitles-modal-title"
        title="Subtitle Accounts"
        subtitle="Use your own accounts so subtitle downloads use your personal quota. Details are checked, then stored encrypted on your server."
        onClose={onClose}
        className="mb-5"
      />

      {!status ? (
        <p className="text-fg-subtle mb-6 text-sm">Loading…</p>
      ) : (
        <>
          {/* OpenSubtitles */}
          <div className="text-fg mb-2 text-sm font-semibold">
            OpenSubtitles
          </div>
          <div className="border-divider/50 bg-panel-raised/40 mb-3 rounded-lg border p-3 text-sm">
            <p
              className={
                status.linked
                  ? 'font-semibold text-emerald-400'
                  : 'text-fg-soft'
              }
            >
              {status.linked
                ? `Signed in as ${status.username}`
                : 'Not signed in'}
            </p>
            {osKeyLine && (
              <p className="text-fg-muted mt-1 text-xs">{osKeyLine}</p>
            )}
          </div>
          <div className="mb-3 space-y-2">
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="OpenSubtitles username"
              data-focusable="true"
              className={inputClass}
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              data-focusable="true"
              className={inputClass}
            />
            <input
              type="password"
              value={osKey}
              onChange={(e) => setOsKey(e.target.value)}
              placeholder="API key (optional — only if the server has none)"
              data-focusable="true"
              className={inputClass}
            />
          </div>
          <div className="mb-6 flex justify-end gap-2">
            {(status.linked || status.hasOwnApiKey) && (
              <Button
                variant="danger"
                onClick={() =>
                  void run(
                    unlinkOpenSubtitles,
                    'OpenSubtitles removed',
                    'Could not remove'
                  )
                }
                disabled={loading}
              >
                Remove
              </Button>
            )}
            <Button
              variant="accent"
              onClick={saveOpenSubtitles}
              disabled={loading}
            >
              Save
            </Button>
          </div>

          {/* SubDL */}
          <div className="text-fg mb-2 text-sm font-semibold">SubDL</div>
          <div className="border-divider/50 bg-panel-raised/40 text-fg-soft mb-3 rounded-lg border p-3 text-sm">
            {subdl?.hasOwnApiKey
              ? 'Using your own API key'
              : subdl?.serverHasApiKey
                ? "Using the server's API key"
                : 'No API key — free at subdl.com'}
          </div>
          <input
            type="password"
            value={subdlKey}
            onChange={(e) => setSubdlKeyInput(e.target.value)}
            placeholder="SubDL API key"
            data-focusable="true"
            className={`${inputClass} mb-3`}
          />
          <div className="mb-6 flex justify-end gap-2">
            {subdl?.hasOwnApiKey && (
              <Button
                variant="danger"
                onClick={() =>
                  void run(
                    removeSubdlKey,
                    'SubDL key removed',
                    'Could not remove'
                  )
                }
                disabled={loading}
              >
                Remove
              </Button>
            )}
            <Button
              variant="accent"
              onClick={() =>
                subdlKey
                  ? void run(
                      () => setSubdlKey(subdlKey),
                      'SubDL key saved',
                      'SubDL rejected that key'
                    )
                  : toast.error('Enter your SubDL API key')
              }
              disabled={loading}
            >
              Save
            </Button>
          </div>
        </>
      )}

      <DialogFooter className="mt-0">
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      </DialogFooter>
    </Dialog>
  );
};

export default OpenSubtitlesModal;
