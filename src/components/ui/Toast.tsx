'use client';

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';

type ToastTone = 'info' | 'error';

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

interface ToastContextValue {
  push: (message: string, tone?: ToastTone) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);
const NOOP_TOAST: ToastContextValue = { push: () => undefined };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (message: string, tone: ToastTone = 'info') => {
      const id = ++nextId.current;
      setToasts((current) => [...current.slice(-3), { id, message, tone }]);
      window.setTimeout(() => dismiss(id), 5_000);
    },
    [dismiss],
  );

  return (
    <ToastContext value={{ push }}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-3 bottom-[calc(var(--player-bar-clearance)_+_0.75rem)] z-[140] flex flex-col items-end gap-2 sm:inset-x-auto sm:right-5 sm:w-[min(360px,calc(100vw-2rem))] md:bottom-[calc(var(--player-bar-desktop-clearance)_+_0.75rem)]"
        aria-label="Notifications"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role={toast.tone === 'error' ? 'alert' : 'status'}
            className={`pointer-events-auto flex w-full items-start gap-3 rounded-xl border px-3.5 py-3 text-[13px] shadow-[0_12px_35px_rgba(25,74,102,0.18)] backdrop-blur-xl ${toast.tone === 'error' ? 'border-[rgba(180,61,69,0.28)] bg-[rgba(255,247,247,0.97)] text-[var(--danger)]' : 'border-[var(--glass-border)] bg-[rgba(251,252,254,0.97)] text-[var(--salt-white)]'}`}
          >
            <p className="min-w-0 flex-1 leading-relaxed">{toast.message}</p>
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              aria-label="Dismiss notification"
              title="Dismiss notification"
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-current opacity-65 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
        ))}
      </div>
    </ToastContext>
  );
}

export function useToast(): ToastContextValue {
  return useContext(ToastContext) ?? NOOP_TOAST;
}
