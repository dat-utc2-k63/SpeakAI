'use client';

import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Award,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  ExternalLink,
  Lightbulb,
  Loader2,
  MessageSquareHeart,
  MessageSquareQuote,
  MicOff,
  PencilLine,
  Volume2,
} from 'lucide-react';
import { Modal } from './ui/Modal';
import { IeltsCriteriaList, ScoreRingGauge, SkillRadarChart } from './ui/AnalyticsCharts';
import { fetchSessionDetail, submitTeacherReview } from '@/lib/practice';
import { formatScoreValue, getExamTypeName, getIeltsBandLabel, scoreTextColorClass } from '@/lib/utils';
import { useToast } from './ToastProvider';
import type { PracticeSession } from '@/lib/types';

interface PracticeDetailModalProps {
  sessionId: string | null;
  canReview?: boolean;
  hasPrev?: boolean;
  hasNext?: boolean;
  onPrev?: () => void;
  onNext?: () => void;
  onClose: () => void;
  onReviewed?: (updated: PracticeSession) => void;
}

export function PracticeDetailModal({
  sessionId,
  canReview = false,
  hasPrev = false,
  hasNext = false,
  onPrev,
  onNext,
  onClose,
  onReviewed,
}: PracticeDetailModalProps) {
  const { showToast } = useToast();
  const [detail, setDetail] = useState<PracticeSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!sessionId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchSessionDetail(sessionId)
      .then((res) => {
        if (cancelled) return;
        setDetail(res);
        setComment(res.teacher_comment || '');
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Không thể tải chi tiết bài làm.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const handleSubmitReview = async () => {
    if (!detail) return;
    setSubmitting(true);
    try {
      const updated = await submitTeacherReview(detail.id, comment);
      const merged: PracticeSession = {
        ...detail,
        status: updated.status || 'reviewed',
        teacher_comment: updated.teacher_comment ?? comment.trim(),
        reviewed_at: updated.reviewed_at || new Date().toISOString(),
        reviewed_by: updated.reviewed_by,
      };
      setDetail(merged);
      onReviewed?.(merged);
      showToast('Đã lưu nhận xét và xác nhận duyệt bài!', 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Lỗi lưu nhận xét';
      showToast(msg, 'danger');
    } finally {
      setSubmitting(false);
    }
  };

  const isExam = detail?.mode === 'exam';
  const hasTeacherReview = Boolean(detail?.teacher_comment || detail?.status === 'reviewed');

  return (
    <Modal
      open={Boolean(sessionId)}
      onClose={onClose}
      maxWidthClass="max-w-5xl"
      title={
        <span className="flex items-center gap-2">
          <Award className="h-5 w-5 text-amber-500" />
          {detail?.question_set?.title
            ? `Chi tiết: ${detail.question_set.title}`
            : 'Chi tiết bài Luyện tập & Thi thử'}
        </span>
      }
      subtitle={
        detail
          ? `${isExam ? 'Thi thử' : 'Luyện tập'} · Ngày ${new Date(detail.started_at).toLocaleString('vi-VN')}`
          : undefined
      }
    >
      {loading && (
        <div className="flex flex-col items-center justify-center py-14 text-slate-500">
          <Loader2 className="mb-3 h-7 w-7 animate-spin text-blue-600" />
          <p className="text-sm">Đang tải chi tiết bài làm...</p>
        </div>
      )}

      {!loading && error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          {error}
        </div>
      )}

      {!loading && !error && detail && (() => {
        const totalNum = Number(detail.score_total || 0);
        const rawBand = (detail.exam_band || '').trim();
        const isNumericBandDuplicate =
          rawBand !== '' && /^\d+(\.\d+)?\s*\/\s*10$/i.test(rawBand);
        const bandChip =
          rawBand && !isNumericBandDuplicate
            ? rawBand
            : getIeltsBandLabel(totalNum).band;

        return (
        <div className="space-y-5">
          <div className="section-card">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
              <div>
                <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <ClipboardCheck className="size-4 text-blue-600" />
                  Tổng quan Kết quả {isExam ? 'Thi thử' : 'Luyện tập'}
                </h4>
                <p className="mt-0.5 text-xs text-slate-500">
                  {getExamTypeName(detail.question_set?.exam_type)} · {detail.answers?.length || 0} câu đã chấm
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {detail.is_late && (
                  <span className="rounded-md border border-rose-200 bg-rose-50 px-2.5 py-0.5 text-xs font-semibold text-rose-700">
                    Nộp trễ hạn
                  </span>
                )}
                {isExam && (
                  <span className="rounded-md border border-blue-200 bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-blue-700">
                    {bandChip}
                  </span>
                )}
                <span
                  className={`rounded-md border px-2.5 py-0.5 text-xs font-semibold ${getIeltsBandLabel(totalNum).badgeClass}`}
                >
                  {getIeltsBandLabel(totalNum).level}
                </span>
                {(onPrev || onNext) && (
                  <div className="inline-flex items-center gap-1 ml-1">
                    <button
                      type="button"
                      disabled={!hasPrev}
                      onClick={onPrev}
                      aria-label="Bài trước trong hàng đợi"
                      className="rounded-md border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-35 transition-colors duration-150"
                    >
                      <ChevronLeft className="size-4" />
                    </button>
                    <button
                      type="button"
                      disabled={!hasNext}
                      onClick={onNext}
                      aria-label="Bài tiếp theo trong hàng đợi"
                      className="rounded-md border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-35 transition-colors duration-150"
                    >
                      <ChevronRight className="size-4" />
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="grid items-center gap-6 lg:grid-cols-12">
              <div className="lg:col-span-3 flex flex-col items-center justify-center rounded-xl border border-slate-200 bg-slate-50 p-5">
                <ScoreRingGauge
                  score={Number(detail.score_total || 0)}
                  max={9}
                  size={158}
                  strokeWidth={14}
                  label="IELTS Band / 9.0"
                />
              </div>

              <div className="lg:col-span-5 flex items-center justify-center py-1">
                <SkillRadarChart
                  size={250}
                  skills={[
                    {
                      label: 'Pronunciation (P)',
                      value: Number(detail.score_accuracy ?? detail.score_total ?? 0),
                    },
                    {
                      label: 'Fluency (FC)',
                      value: detail.score_context != null ? Number(detail.score_context) : null,
                    },
                    {
                      label: 'Lexical (LR)',
                      value: detail.score_lexical != null ? Number(detail.score_lexical) : null,
                    },
                    {
                      label: 'Grammar (GRA)',
                      value: detail.score_grammar != null ? Number(detail.score_grammar) : null,
                    },
                  ]}
                />
              </div>

              <div className="lg:col-span-4">
                <IeltsCriteriaList
                  compact
                  pr={Number(detail.score_accuracy ?? detail.score_total ?? 0)}
                  fc={detail.score_context != null ? Number(detail.score_context) : null}
                  lr={detail.score_lexical != null ? Number(detail.score_lexical) : null}
                  gra={detail.score_grammar != null ? Number(detail.score_grammar) : null}
                />
              </div>
            </div>
          </div>

          {hasTeacherReview && (
            <div className="rounded-2xl border border-sky-200 bg-sky-50/80 p-4">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-sm font-bold text-sky-800">
                  <MessageSquareHeart className="h-4 w-4 text-sky-600" />
                  Nhận xét &amp; Đánh giá của Giáo viên
                </span>
                <span className="rounded-full border border-sky-200 bg-white px-2.5 py-0.5 text-xs font-semibold text-sky-700">
                  {detail.reviewed_at
                    ? `Đã duyệt ${new Date(detail.reviewed_at).toLocaleDateString('vi-VN')}`
                    : 'Giáo viên đã duyệt'}
                </span>
              </div>
              <p className="text-sm text-slate-800">
                {detail.teacher_comment || (
                  <span className="italic text-slate-500">
                    Giáo viên đã xác nhận hoàn thành bài làm.
                  </span>
                )}
              </p>
            </div>
          )}

          {canReview && ['completed', 'reviewed'].includes(detail.status) && (
            <div className="section-card space-y-3">
              <h4 className="flex items-center gap-2 text-sm font-bold text-blue-700">
                <PencilLine className="h-4 w-4" />
                Duyệt bài &amp; Ghi nhận xét cho Học viên
              </h4>
              <textarea
                rows={3}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Nhập nhận xét chi tiết về phát âm, ngữ pháp hoặc hướng cải thiện cho học viên..."
                className="w-full rounded-xl border border-slate-200 bg-slate-50/80 px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none"
              />
              <div className="flex justify-end">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={handleSubmitReview}
                  className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50 transition-colors duration-150"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Đang lưu nhận xét...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-4 w-4" />
                      {detail.status === 'reviewed'
                        ? 'Cập nhật nhận xét'
                        : 'Duyệt & Gửi nhận xét'}
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          <div className="space-y-3">
            <h4 className="flex items-center gap-2 text-sm font-bold text-slate-900">
              <ClipboardCheck className="h-4 w-4 text-blue-600" />
              Chi tiết từng câu ({detail.answers?.length || 0})
            </h4>

            {(detail.answers || []).map((a, idx) => {
              const aiEval = a.result_json?.llm_eval;
              const errors = aiEval?.grammar_errors || [];
              const gramScore = a.score_grammar ?? aiEval?.score_grammar ?? null;
              const ctxScore = a.score_context ?? aiEval?.score_context ?? null;
              const lexScore = a.score_lexical ?? aiEval?.score_lexical ?? null;
              const prScore = a.score_accuracy ?? a.score_total ?? 0;

              return (
                <div
                  key={a.id || a.question_id || idx}
                  className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3 shadow-sm"
                >
                  <div className="text-sm font-bold text-slate-900">
                    <span className="text-blue-600">
                      Câu {a.question?.order_num || idx + 1}:
                    </span>{' '}
                    {a.question?.question_text || ''}
                  </div>

                  <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
                    <div className="rounded-xl border border-blue-200 bg-blue-50/75 p-2.5 text-center">
                      <div className="text-[10px] font-bold uppercase text-blue-700">Điểm tổng</div>
                      <div className={`text-xl font-extrabold tabular-nums ${scoreTextColorClass(a.score_total)}`}>
                        {Number(a.score_total || 0).toFixed(1)}
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-slate-50/75 p-2.5 text-center">
                      <div className="text-[10px] font-bold uppercase text-slate-500">Phát âm</div>
                      <div className={`text-lg font-bold tabular-nums ${scoreTextColorClass(prScore)}`}>
                        {Number(prScore).toFixed(1)}
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-slate-50/75 p-2.5 text-center">
                      <div className="text-[10px] font-bold uppercase text-slate-500">Mạch lạc</div>
                      <div className={`text-lg font-bold tabular-nums ${ctxScore != null ? scoreTextColorClass(ctxScore) : 'text-slate-400'}`}>
                        {formatScoreValue(ctxScore)}
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-slate-50/75 p-2.5 text-center">
                      <div className="text-[10px] font-bold uppercase text-slate-500">Từ vựng</div>
                      <div className={`text-lg font-bold tabular-nums ${lexScore != null ? scoreTextColorClass(lexScore) : 'text-slate-400'}`}>
                        {formatScoreValue(lexScore)}
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-slate-50/75 p-2.5 text-center">
                      <div className="text-[10px] font-bold uppercase text-slate-500">Ngữ pháp</div>
                      <div className={`text-lg font-bold tabular-nums ${gramScore != null ? scoreTextColorClass(gramScore) : 'text-slate-400'}`}>
                        {formatScoreValue(gramScore)}
                      </div>
                    </div>
                  </div>

                  {a.transcript && (
                    <div className="rounded-xl border border-slate-200 bg-slate-50/75 p-3">
                      <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-slate-500">
                        <MessageSquareQuote className="h-3.5 w-3.5 text-blue-600" />
                        Nội dung bạn đã nói:
                      </div>
                      <p className="text-sm italic text-slate-800">&ldquo;{a.transcript}&rdquo;</p>
                    </div>
                  )}

                  {aiEval?.feedback_summary && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                      <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-amber-800">
                        <Lightbulb className="size-3.5" />
                        Nhận xét chi tiết:
                      </div>
                      <p className="text-xs leading-relaxed text-slate-700">
                        {aiEval.feedback_summary}
                      </p>
                    </div>
                  )}

                  {errors.length > 0 && (
                    <div className="rounded-xl border border-rose-200 bg-rose-50/80 p-3 space-y-2">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-rose-700">
                        <AlertCircle className="h-3.5 w-3.5" />
                        Lỗi ngữ pháp ({errors.length}):
                      </div>
                      {errors.map((err, eIdx) => (
                        <div
                          key={eIdx}
                          className="border-l-2 border-rose-400 pl-2.5 text-xs space-y-0.5"
                        >
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-rose-600 line-through">{err.error_text}</span>
                            <ArrowRight className="h-3 w-3 text-slate-400" />
                            <span className="font-bold text-emerald-700">{err.fix}</span>
                          </div>
                          {err.explanation && (
                            <div className="text-slate-600">{err.explanation}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {aiEval?.better_expression && (
                    <div className="rounded-xl border border-sky-200 bg-sky-50/80 p-3">
                      <div className="mb-1 flex items-center gap-1.5 text-xs font-bold text-sky-800">
                        <Lightbulb className="h-3.5 w-3.5" />
                        Gợi ý diễn đạt tự nhiên hơn:
                      </div>
                      <p className="text-xs italic text-slate-700">
                        &ldquo;{aiEval.better_expression}&rdquo;
                      </p>
                    </div>
                  )}

                  {a.audio_url ? (
                    <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
                      <div className="mb-1.5 flex items-center justify-between text-xs">
                        <span className="flex items-center gap-1.5 font-semibold text-sky-700">
                          <Volume2 className="h-3.5 w-3.5" />
                          Bản ghi âm câu trả lời
                        </span>
                        <a
                          href={a.audio_url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-slate-500 hover:text-blue-600 font-medium"
                        >
                          Mở file
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>
                      <audio controls src={a.audio_url} className="h-9 w-full" />
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 text-xs italic text-slate-400">
                      <MicOff className="h-3.5 w-3.5" />
                      Không có bản ghi âm
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        );
      })()}
    </Modal>
  );
}
