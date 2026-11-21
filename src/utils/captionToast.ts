import { toast, type Id } from 'react-toastify';

let activeCaptionToast: Id | null = null;

/**
 * Updates the active caption notification in place (no stacked toasts on rapid C taps),
 * or creates a fresh toast if the previous one already closed or is exiting.
 */
export function showCaptionToast(type: 'info' | 'success' | 'error', message: string, autoClose = 2500) {
  if (activeCaptionToast !== null && toast.isActive(activeCaptionToast)) {
    toast.update(activeCaptionToast, {
      render: message,
      type,
      autoClose,
      isLoading: false,
    });
    return;
  }
  activeCaptionToast = toast[type](message, { autoClose });
}

export function dismissCaptionToast() {
  if (activeCaptionToast !== null) {
    toast.dismiss(activeCaptionToast);
    activeCaptionToast = null;
  }
}
