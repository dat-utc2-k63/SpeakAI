'use client';

import React from 'react';
import { BarChart3, Bot, ChevronRight, MessageSquareText, Trash2 } from 'lucide-react';
import { Modal } from './ui/Modal';
import { IeltsCriteriaList, ScoreRingGauge, SkillRadarChart } from './ui/AnalyticsCharts';
import { ComprehensiveAiFeedback, DialogueTimeline } from './AiFeedbackBlocks';
import { getIeltsBandLabel } from '@/lib/utils';
import type { Assessment } from '@/lib/types';

interface AssessmentCardProps {
  assessment: Assessment;
  fallbackTeacherName?: string;
  showDelete?: boolean;
  onSelect: (assessment: Assessment) => void;
  onDelete?: (assessment: Assessment) => void;
}

export function AssessmentCard({
  assessment,
  fallbackTeacherName = 'Giáo viên phụ trách',
  showDelete = false,
  onSelect,
  onDelete,
}: AssessmentCardProps) {
  const dateStr = new Date(assessment.created_at).toLocaleDateString('vi-VN');
  const displayName =
    assessment.student?.full_name || assessment.teacher?.full_name || fallbackTeacherName;
  const customTitle = assessment.result_json?.title;
  const totalVal = assessment.score_total != null ? Number(assessment.score_total) : null;
  const badgeColor =
    totalVal != null && totalVal >= 8
      ? 'bg-emerald-600 text-white'
      : totalVal != null && totalVal >= 6
        ? 'bg-blue-600 text-white'
        : totalVal != null && totalVal >= 4
          ? 'bg-amber-600 text-white'
          : 'bg-rose-600 text-white';

  const prScore = assessment.score_accuracy ?? assessment.score_total ?? 0;
  const lrScore = assessment.score_lexical ?? assessment.result_json?.score_lexical;

  return (
    <div className="section-card card-interactive flex items-center gap-3 !p-4">
      <button
        type="button"
        onClick={() => onSelect(assessment)}
        className="flex flex-1 items-center gap-3.5 text-left min-w-0"
      >
        <div
          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-lg font-extrabold shadow-md tabular-nums ${badgeColor}`}
        >
          {totalVal != null ? totalVal.toFixed(1) : '--'}
        </div>

        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold text-slate-900">
            {customTitle ? (
              <>
                <span className="text-blue-600">{customTitle}</span> — {displayName}
              </>
            ) : (
              `Đánh giá của ${displayName}`
            )}
          </div>
          <div className="mt-0.5 text-xs text-slate-500">{dateStr}</div>
          <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px] font-semibold">
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-emerald-700">
              Phát âm: {Number(prScore).toFixed(1)}
            </span>
            {assessment.score_context != null && (
              <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-sky-700">
                Mạch lạc: {Number(assessment.score_context).toFixed(1)}
              </span>
            )}
            {lrScore != null && (
              <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-amber-700">
                Từ vựng: {Number(lrScore).toFixed(1)}
              </span>
            )}
            {assessment.score_grammar != null && (
              <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-blue-700">
                Ngữ pháp: {Number(assessment.score_grammar).toFixed(1)}
              </span>
            )}
          </div>
        </div>

        <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
      </button>

      {showDelete && onDelete && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(assessment);
          }}
          className="rounded-xl border border-rose-200 bg-rose-50 p-2 text-rose-600 hover:bg-rose-100 transition"
          title="Xóa bài đánh giá"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

interface AssessmentDetailModalProps {
  assessment: Assessment | null;
  onClose: () => void;
}

export function AssessmentDetailModal({ assessment, onClose }: AssessmentDetailModalProps) {
  if (!assessment) return null;

  const r = assessment.result_json || {};
  const turns = r.dialogue?.turns || r.turns || [];
  const otf = r.overall_transformer_feedback || {};
  const aiEval = r.ai_eval || null;

  const total = Number(assessment.score_total || 0);
  const bandInfo = getIeltsBandLabel(total);
  const gramVal = assessment.score_grammar ?? aiEval?.score_grammar ?? null;
  const ctxVal = assessment.score_context ?? aiEval?.score_context ?? null;
  const lexVal = assessment.score_lexical ?? aiEval?.score_lexical ?? r.score_lexical ?? null;
  const prVal = assessment.score_accuracy ?? assessment.score_total ?? 0;

  return (
    <Modal
      open={Boolean(assessment)}
      onClose={onClose}
      maxWidthClass="max-w-5xl"
      title={
        <span className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-blue-600" />
          {r.title || 'Chi tiết kết quả đánh giá hội thoại 1-1'}
        </span>
      }
      subtitle={`Ngày tạo: ${new Date(assessment.created_at).toLocaleString('vi-VN')}${
        assessment.student?.full_name ? ` · Học viên: ${assessment.student.full_name}` : ''
      }${assessment.teacher?.full_name ? ` · Giáo viên: ${assessment.teacher.full_name}` : ''}`}
    >
      <div className="space-y-5">
        {assessment.teacher_note && (
          <div className="flex items-start gap-2.5 rounded-2xl border border-amber-200 bg-amber-50/85 px-4 py-3 text-xs text-amber-900">
            <MessageSquareText className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <div>
              <span className="font-bold">Ghi chú quản lý / giáo viên:</span>{' '}
              <span>{assessment.teacher_note}</span>
            </div>
          </div>
        )}
        <div className="section-card">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
            <div>
              <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-blue-600" />
                Điểm Đánh Giá Cuộc Hội Thoại
              </h4>
              <p className="mt-0.5 text-xs text-slate-500">
                Tổng hợp đánh giá phát âm, ngữ pháp và khả năng phản hồi tự nhiên.
              </p>
            </div>
            <span className={`rounded-full border px-3 py-0.5 text-xs font-semibold ${bandInfo.badgeClass}`}>
              {bandInfo.band} ({bandInfo.level})
            </span>
          </div>

          <div className="grid items-center gap-6 lg:grid-cols-12">
            <div className="lg:col-span-3 flex flex-col items-center justify-center rounded-xl border border-slate-200 bg-slate-50 p-5">
              <ScoreRingGauge score={total} max={9} size={158} strokeWidth={14} label="IELTS Band / 9.0" />
            </div>

            <div className="lg:col-span-5 flex items-center justify-center py-1">
              <SkillRadarChart
                size={250}
                skills={[
                  { label: 'Pronunciation (P)', value: Number(prVal) },
                  { label: 'Fluency (FC)', value: ctxVal != null ? Number(ctxVal) : null },
                  { label: 'Lexical (LR)', value: lexVal != null ? Number(lexVal) : gramVal != null ? Number(gramVal) : null },
                  { label: 'Grammar (GRA)', value: gramVal != null ? Number(gramVal) : null },
                ]}
              />
            </div>

            <div className="lg:col-span-4">
              <IeltsCriteriaList
                compact
                pr={Number(prVal)}
                fc={ctxVal != null ? Number(ctxVal) : null}
                lr={lexVal != null ? Number(lexVal) : gramVal != null ? Number(gramVal) : null}
                gra={gramVal != null ? Number(gramVal) : null}
              />
            </div>
          </div>
        </div>

        {(aiEval || otf.summary || (otf.tips && otf.tips.length > 0)) && (
          <div className="section-card">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h4 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                <Bot className="h-4 w-4 text-blue-600" />
                Nhận xét chi tiết từ AI
              </h4>
            </div>
            <ComprehensiveAiFeedback
              aiEval={aiEval}
              otf={otf}
              scores={{
                total,
                accuracy: prVal,
                context: ctxVal,
                lexical: lexVal,
                grammar: gramVal,
              }}
            />
          </div>
        )}

        <div className="section-card">
          <h4 className="mb-4 flex items-center gap-2 text-sm font-bold text-slate-900">
            <MessageSquareText className="h-4 w-4 text-blue-600" />
            Chi tiết từng lượt nói ({turns.length})
          </h4>
          <DialogueTimeline turns={turns} />
        </div>
      </div>
    </Modal>
  );
}
