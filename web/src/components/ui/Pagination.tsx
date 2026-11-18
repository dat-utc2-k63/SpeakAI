'use client';

import React, { useMemo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface PaginationProps {
  page: number;
  pageSize: number;
  totalCount: number;
  onPageChange: (nextPage: number) => void;
  disabled?: boolean;
  itemLabel?: string;
  compact?: boolean;
  className?: string;
}

export function Pagination({
  page,
  pageSize,
  totalCount,
  onPageChange,
  disabled = false,
  itemLabel = 'bản ghi',
  compact = false,
  className = '',
}: PaginationProps) {
  const safeSize = Math.max(1, pageSize);
  const totalPages = Math.max(1, Math.ceil(totalCount / safeSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);

  const pageTokens = useMemo(() => {
    const tokens: Array<number | 'ellipsis-left' | 'ellipsis-right'> = [];
    if (totalPages <= 7) {
      for (let p = 1; p <= totalPages; p += 1) tokens.push(p);
      return tokens;
    }

    tokens.push(1);
    const start = Math.max(2, currentPage - 1);
    const end = Math.min(totalPages - 1, currentPage + 1);

    if (start > 2) tokens.push('ellipsis-left');
    for (let p = start; p <= end; p += 1) tokens.push(p);
    if (end < totalPages - 1) tokens.push('ellipsis-right');
    tokens.push(totalPages);

    return tokens;
  }, [currentPage, totalPages]);

  if (totalCount <= 0) return null;

  const from = (currentPage - 1) * safeSize + 1;
  const to = Math.min(totalCount, currentPage * safeSize);

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs shadow-sm ${
        compact ? 'rounded-lg px-3 py-2' : ''
      } ${className}`}
    >
      <div className="text-slate-500">
        Hiển thị{' '}
        <strong className="font-semibold text-slate-800 tabular-nums">
          {from}–{to}
        </strong>{' '}
        trong tổng số{' '}
        <strong className="font-semibold text-slate-800 tabular-nums">{totalCount}</strong> {itemLabel}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={disabled || currentPage <= 1}
            onClick={() => onPageChange(currentPage - 1)}
            aria-label="Trang trước"
            className="inline-flex size-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition-colors duration-150 hover:bg-slate-50 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronLeft className="size-4" />
          </button>

          {/* Desktop numbered pages */}
          <div className="hidden items-center gap-1 sm:flex">
            {pageTokens.map((token) =>
              typeof token === 'number' ? (
                <button
                  key={token}
                  type="button"
                  disabled={disabled}
                  onClick={() => onPageChange(token)}
                  aria-label={`Trang ${token}`}
                  aria-current={token === currentPage ? 'page' : undefined}
                  className={`inline-flex h-8 min-w-[2rem] items-center justify-center rounded-lg px-2 font-semibold tabular-nums transition-colors duration-150 ${
                    token === currentPage
                      ? 'bg-slate-900 text-white'
                      : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                  } disabled:opacity-50`}
                >
                  {token}
                </button>
              ) : (
                <span key={token} className="px-1.5 text-slate-400 select-none">
                  …
                </span>
              ),
            )}
          </div>

          {/* Mobile compact indicator */}
          <span className="inline-flex h-8 items-center rounded-lg border border-slate-200 bg-slate-50 px-2.5 font-semibold text-slate-700 tabular-nums sm:hidden">
            {currentPage} / {totalPages}
          </span>

          <button
            type="button"
            disabled={disabled || currentPage >= totalPages}
            onClick={() => onPageChange(currentPage + 1)}
            aria-label="Trang sau"
            className="inline-flex size-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition-colors duration-150 hover:bg-slate-50 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      )}
    </div>
  );
}

