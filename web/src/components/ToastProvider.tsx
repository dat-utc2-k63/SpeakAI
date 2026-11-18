'use client';

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import {
  startPreHydrationExtensionGuard,
  stripExtensionHydrationAttrs,
} from '@/lib/hydrationSanitizer';

if (typeof document !== 'undefined') {
  startPreHydrationExtensionGuard();
  stripExtensionHydrationAttrs();
}

export type ToastVariant = 'success' | 'info' | 'danger';

interface ToastItem {
  id: number;
  message: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  showToast: (message: string, variant?: ToastVariant) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const removeToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const showToast = useCallback(
    (message: string, variant: ToastVariant = 'info') => {
      const id = Date.now() + Math.floor(Math.random() * 1000);
      setToasts((prev) => [...prev, { id, message, variant }]);
      window.setTimeout(() => {
        removeToast(id);
      }, 3600);
    },
    [removeToast],
  );

  const toastOverlay = mounted
    ? createPortal(
        <div className="fixed bottom-[max(5.5rem,env(safe-area-inset-bottom))] lg:bottom-6 right-4 left-4 sm:left-auto sm:right-6 z-50 flex sm:max-w-sm flex-col gap-2 pointer-events-none">
          {toasts.map((t) => {
            const borderCls =
              t.variant === 'success'
                ? 'border-l-4 border-l-emerald-600'
                : t.variant === 'danger'
                  ? 'border-l-4 border-l-rose-600'
                  : 'border-l-4 border-l-blue-600';
            const Icon =
              t.variant === 'success' ? CheckCircle2 : t.variant === 'danger' ? AlertCircle : Info;
            const iconColor =
              t.variant === 'success'
                ? 'text-emerald-600'
                : t.variant === 'danger'
                  ? 'text-rose-600'
                  : 'text-blue-600';

            return (
              <div
                key={t.id}
                role="status"
                className={`pointer-events-auto flex items-start gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 shadow-lg ${borderCls}`}
              >
                <Icon className={`mt-0.5 size-4 shrink-0 ${iconColor}`} />
                <span className="flex-1 leading-relaxed font-medium text-pretty">{t.message}</span>
                <button
                  type="button"
                  onClick={() => removeToast(t.id)}
                  className="text-slate-400 hover:text-slate-700 transition-colors duration-150"
                  aria-label="Đóng thông báo"
                >
                  <X className="size-4" />
                </button>
              </div>
            );
          })}
        </div>,
        document.body,
      )
    : null;

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {toastOverlay}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return ctx;
}
