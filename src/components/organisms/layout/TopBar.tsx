import React from 'react';
import { useVideoContext } from '@/context/video';
import { Check } from 'lucide-react';
import { BackArrowIcon, CopyLinkIcon, DownloadIcon } from '@/components/atoms/Icons';

interface TopBarProps {
  onBack: () => void;
  /** The decoded video ("2160p · 24 fps · 3840×2160"), on the right of the same row. */
  stats?: string | null;
}

export const TopBar = React.memo<TopBarProps>(({ onBack, stats }) => {
  const { handleCopyLink, handleDownload, copied, isTizen, contentType } =
    useVideoContext();

  if (isTizen && !stats) return null;
  return (
    <div className="top-bar-container absolute left-0 right-0 top-0 p-2 md:p-4">
      <div className="flex items-center space-x-2 md:space-x-4">
        {!isTizen && (
          <>
            <button
              data-focusable="true"
              onClick={onBack}
              title="Back"
              aria-label="Back"
              className="ui-player-button flex items-center rounded-lg px-3 py-1.5 text-sm text-white shadow-xs transition-all duration-300 hover:shadow-md active:scale-95 md:px-4 md:py-2 md:text-base"
            >
              <BackArrowIcon className="h-4 w-4 md:mr-2 md:h-5 md:w-5" />
              <span className="hidden md:inline">Back</span>
            </button>

            <button
              data-focusable="true"
              onClick={handleCopyLink}
              title={copied ? 'Copied' : 'Copy link'}
              aria-label="Copy link"
              className="ui-player-button relative flex items-center rounded-lg px-3 py-1.5 text-sm text-white shadow-xs transition-all duration-300 hover:shadow-md active:scale-95 md:px-4 md:py-2 md:text-base"
            >
              {copied ? <Check className="h-4 w-4 md:mr-2 md:h-5 md:w-5" /> : <CopyLinkIcon className="h-4 w-4 md:mr-2 md:h-5 md:w-5" />}
              <span className="hidden md:inline">
                {copied ? 'Copied!' : 'Copy Link'}
              </span>
            </button>

            {contentType !== 'tv' && (
              <button
                data-focusable="true"
                // TEMP diagnostic (unwanted "Download started"): detail 0 = Enter/remote or a script, else a real click.
                onClick={(e) => handleDownload(e.detail === 0 ? 'Enter key' : 'a click')}
                title="Download"
                aria-label="Download"
                className="ui-player-button flex items-center rounded-lg px-3 py-1.5 text-sm text-white shadow-xs transition-all duration-300 hover:shadow-md active:scale-95 md:px-4 md:py-2 md:text-base"
              >
                <DownloadIcon className="h-4 w-4 md:mr-2 md:h-5 md:w-5" />
                <span className="hidden md:inline">Download</span>
              </button>
            )}
          </>
        )}

        {stats && (
          <div className="ui-player-badge ml-auto rounded-md bg-black/60 px-3 py-1 text-xs font-semibold tracking-wide text-fg md:text-sm">
            {stats}
          </div>
        )}
      </div>
    </div>
  );
});

TopBar.displayName = 'TopBar';
