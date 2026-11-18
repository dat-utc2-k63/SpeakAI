'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Inbox,
  Loader2,
  Search,
} from 'lucide-react';
import {
  fetchMyManagedClasses,
  fetchTeacherReviewInbox,
} from '@/lib/classes';
import { formatScoreValue, getExamTypeName, scoreBadgeBgClass } from '@/lib/utils';
import { PageHeader } from '@/components/ui/AnalyticsCharts';
import { Pagination } from '@/components/ui/Pagination';
import { PracticeDetailModal } from '@/components/PracticeDetailModal';
import { useToast } from '@/components/ToastProvider';
import type { ClassRecord, PracticeSession, Profile } from '@/lib/types';

interface TeacherReviewInboxViewProps {
  currentUser: Profile;
  onReviewedChange?: () => void;
}

const PAGE_SIZE = 15;

export function TeacherReviewInboxView({
  currentUser,
  onReviewedChange,
}: TeacherReviewInboxViewProps) {
  const { showToast } = useToast();

  const [classes, setClasses] = useState<ClassRecord[]>([]);
  const [classFilter, setClassFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'completed' | 'reviewed' | 'all'>('completed');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);

  const [items, setItems] = useState<PracticeSession[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => window.clearTimeout(t);
  }, [search]);

  useEffect(() => {
    fetchMyManagedClasses(currentUser.id, currentUser.role === 'admin' ? 'admin' : 'teacher')
      .then((list) => setClasses(list))
      .catch(() => setClasses([]));
  }, [currentUser.id, currentUser.role]);

  const loadInbox = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchTeacherReviewInbox({
        teacherId: currentUser.id,
        role: currentUser.role === 'admin' ? 'admin' : 'teacher',
        classId: classFilter,
        status: statusFilter,
        search: debouncedSearch,
        page,
        pageSize: PAGE_SIZE,
      });
      setItems(res.items);
      setTotal(res.total);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Không thể tải hàng đợi duyệt bài', 'danger');
    } finally {
      setLoading(false);
    }
  }, [classFilter, currentUser.id, currentUser.role, debouncedSearch, page, showToast, statusFilter]);

  useEffect(() => {
    loadInbox();
  }, [loadInbox]);

  const activeSession = activeIndex != null ? items[activeIndex] || null : null;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="DUYỆT BÀI TẬP TRUNG"
        title="Hàng đợi Duyệt bài Speaking"
        subtitle="Tổng hợp toàn bộ bài luyện tập và thi thử học viên vừa nộp trên tất cả các lớp bạn phụ trách. Mở 1 bài để chấm duyệt liên tiếp."
        pill={
          <span className="tabular-nums">
            {total} bài {statusFilter === 'completed' ? 'chờ duyệt' : 'khớp bộ lọc'}
          </span>
        }
        action={
          items.length > 0 ? (
            <button
              type="button"
              onClick={() => setActiveIndex(0)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 transition-colors duration-150"
            >
              <ClipboardCheck className="size-4" />
              Duyệt nhanh từ bài đầu
            </button>
          ) : undefined
        }
      />

      {/* Filters */}
      <div className="section-card grid gap-3 sm:grid-cols-4">
        <div className="relative sm:col-span-2">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm theo tên học viên, bài tập hoặc bộ đề..."
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-600 focus:outline-none"
          />
        </div>
        <select
          value={classFilter}
          onChange={(e) => {
            setClassFilter(e.target.value);
            setPage(1);
          }}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
        >
          <option value="">Tất cả lớp phụ trách</option>
          {classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.code})
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value as 'completed' | 'reviewed' | 'all');
            setPage(1);
          }}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
        >
          <option value="completed">Chờ duyệt</option>
          <option value="reviewed">Đã duyệt</option>
          <option value="all">Tất cả bài đã nộp</option>
        </select>
      </div>

      {/* Queue List */}
      {loading && items.length === 0 ? (
        <div className="section-card flex items-center justify-center py-14 text-slate-500">
          <Loader2 className="mr-2 size-5 animate-spin text-blue-600" />
          <span className="text-sm">Đang tải danh sách bài nộp...</span>
        </div>
      ) : items.length === 0 ? (
        <div className="section-card py-14 text-center space-y-2">
          <Inbox className="mx-auto size-9 text-emerald-600" />
          <h3 className="text-base font-semibold text-slate-900">
            {statusFilter === 'completed'
              ? 'Đã duyệt hết toàn bộ bài nộp!'
              : 'Không có bài nộp nào khớp bộ lọc'}
          </h3>
          <p className="text-xs text-slate-500">
            {statusFilter === 'completed'
              ? 'Khi học viên nộp bài mới, bài làm sẽ tự động xuất hiện tại đây.'
              : 'Thử chuyển bộ lọc sang trạng thái hoặc lớp khác.'}
          </p>
        </div>
      ) : (
        <>
          <div className="space-y-2.5">
            {items.map((s, idx) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setActiveIndex(idx)}
                className="section-card card-interactive flex w-full flex-wrap items-center justify-between gap-4 !p-4 text-left"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-bold text-slate-900">
                      {s.student?.full_name || 'Học viên'}
                    </span>
                    {s.class_info?.name && (
                      <span className="rounded-md border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700">
                        {s.class_info.name}
                      </span>
                    )}
                    <span
                      className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold ${
                        s.mode === 'exam'
                          ? 'border-amber-200 bg-amber-50 text-amber-800'
                          : 'border-slate-200 bg-slate-50 text-slate-700'
                      }`}
                    >
                      {s.mode === 'exam' ? 'Thi thử' : 'Luyện tập'}
                    </span>
                    {s.is_late && (
                      <span className="rounded-md border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700">
                        Nộp trễ
                      </span>
                    )}
                    {s.status === 'reviewed' ? (
                      <span className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                        <CheckCircle2 className="size-3" /> Đã duyệt
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                        <Clock className="size-3" /> Chờ duyệt
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-700">
                    {s.assignment?.title
                      ? `Bài tập: ${s.assignment.title}`
                      : `Bộ đề: ${s.question_set?.title || 'Speaking'}`}{' '}
                    <span className="text-slate-400">
                      · {getExamTypeName(s.question_set?.exam_type)}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500 tabular-nums">
                    Nộp lúc {new Date(s.completed_at || s.started_at).toLocaleString('vi-VN')}
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <div className="hidden sm:flex items-center gap-2 text-[11px] text-slate-500 tabular-nums">
                    <span>P {formatScoreValue(s.score_accuracy)}</span>
                    <span>FC {formatScoreValue(s.score_context)}</span>
                    <span>LR {formatScoreValue(s.score_lexical)}</span>
                    <span>GRA {formatScoreValue(s.score_grammar)}</span>
                  </div>
                  <span
                    className={`rounded-lg border px-3 py-1.5 text-sm font-bold tabular-nums ${scoreBadgeBgClass(s.score_total)}`}
                  >
                    {formatScoreValue(s.score_total)}
                  </span>
                </div>
              </button>
            ))}
          </div>

          <Pagination
            compact
            page={page}
            pageSize={PAGE_SIZE}
            totalCount={total}
            onPageChange={setPage}
            disabled={loading}
            itemLabel="bài nộp"
          />
        </>
      )}

      <PracticeDetailModal
        sessionId={activeSession?.id || null}
        canReview
        hasPrev={activeIndex != null && activeIndex > 0}
        hasNext={activeIndex != null && activeIndex < items.length - 1}
        onPrev={() => setActiveIndex((i) => (i != null && i > 0 ? i - 1 : i))}
        onNext={() => setActiveIndex((i) => (i != null && i < items.length - 1 ? i + 1 : i))}
        onClose={() => setActiveIndex(null)}
        onReviewed={() => {
          void loadInbox();
          onReviewedChange?.();
        }}
      />
    </div>
  );
}
