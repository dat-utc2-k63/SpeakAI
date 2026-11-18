'use client';

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface ModalProps {
  open: boolean;
  onClose?: () => void;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  maxWidthClass?: string;
  hideCloseButton?: boolean;
  closeOnBackdrop?: boolean;
  footer?: React.ReactNode;
  children: React.ReactNode;
}

// Track active stacked modals so closing a child modal doesn't prematurely unlock body scroll
let activeModalCount = 0;

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  maxWidthClass = 'max-w-2xl',
  hideCloseButton = false,
  closeOnBackdrop = true,
  footer,
  children,
}: ModalProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open || !onClose || hideCloseButton) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose, hideCloseButton]);

  useEffect(() => {
    if (!open) return;
    activeModalCount += 1;
    if (activeModalCount === 1) {
      document.body.style.overflow = 'hidden';
    }
    return () => {
      activeModalCount = Math.max(0, activeModalCount - 1);
      if (activeModalCount === 0) {
        document.body.style.overflow = '';
      }
    };
  }, [open]);

  if (!open || !mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50 p-0 sm:p-6"
      onMouseDown={(e) => {
        if (closeOnBackdrop && onClose && e.target === e.currentTarget) {
          onClose();
        }
      }}
      role="dialog"
      aria-modal="true"
    >
      <div
        className={`flex max-h-[92dvh] sm:max-h-[88dvh] w-full flex-col overflow-hidden rounded-t-2xl sm:rounded-xl border border-slate-200 bg-white text-slate-900 shadow-xl ${maxWidthClass}`}
      >
        <div className="mx-auto mt-2.5 h-1.5 w-11 shrink-0 rounded-full bg-slate-300 sm:hidden" />

        {(title || !hideCloseButton) && (
          <div className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 bg-white px-5 sm:px-6 py-4">
            <div className="min-w-0 flex-1">
              {title && (
                <h3 className="text-base sm:text-lg font-semibold text-slate-900 leading-snug text-balance">
                  {title}
                </h3>
              )}
              {subtitle && <div className="mt-0.5 text-xs text-slate-500 text-pretty">{subtitle}</div>}
            </div>
            {!hideCloseButton && onClose && (
              <button
                type="button"
                onClick={onClose}
                className="shrink-0 rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 active:scale-95 transition"
                aria-label="Đóng"
              >
                <X className="h-5 w-5" />
              </button>
            )}
          </div>
        )}

        <div className="flex-1 overflow-y-auto overscroll-contain px-5 sm:px-6 py-4 sm:py-5">
          {children}
        </div>

        {footer && (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2.5 border-t border-slate-100 bg-slate-50/75 px-5 sm:px-6 py-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))] sm:pb-4">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
