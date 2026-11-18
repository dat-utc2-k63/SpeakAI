'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  ArrowRight,
  Award,
  BookOpen,
  ClipboardCheck,
  Languages,
  Loader2,
  School,
  Users,
} from 'lucide-react';
import { fetchMyManagedClasses } from '@/lib/classes';
import { getExamTypeName } from '@/lib/utils';
import { PageHeader } from '@/components/ui/AnalyticsCharts';
import { ClassWorkspaceView } from './ClassWorkspaceView';
import { useToast } from '@/components/ToastProvider';
import type { ClassRecord, Profile } from '@/lib/types';

interface TeacherClassesViewProps {
  currentUser: Profile;
  onStartClassroomAnalysis?: (classId: string, lessonId?: string) => void;
  onStartAssess1on1?: (classId: string, lessonId?: string) => void;
  onReviewChanged?: () => void;
}

export function TeacherClassesView({
  currentUser,
  onStartClassroomAnalysis,
  onStartAssess1on1,
  onReviewChanged,
}: TeacherClassesViewProps) {
  const { showToast } = useToast();
  const [classes, setClasses] = useState<ClassRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);

  const loadClasses = useCallback(async () => {
    setLoading(true);
    try {
      const list = await fetchMyManagedClasses(currentUser.id, 'teacher');
      setClasses(list);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Không thể tải danh sách lớp của bạn', 'danger');
    } finally {
      setLoading(false);
    }
  }, [currentUser.id, showToast]);

  useEffect(() => {
    loadClasses();
  }, [loadClasses]);

  if (selectedClassId) {
    return (
      <ClassWorkspaceView
        classId={selectedClassId}
        currentUser={currentUser}
        onBack={() => {
          setSelectedClassId(null);
          void loadClasses();
        }}
        onStartClassroomAnalysis={onStartClassroomAnalysis}
        onStartAssess1on1={onStartAssess1on1}
        onReviewChanged={onReviewChanged}
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="QUẢN LÝ GIẢNG DẠY"
        title="Lớp học của tôi"
        subtitle="Chọn một lớp để quản lý buổi học, điểm danh, giao bài tập Speaking, xem ma trận nộp bài và xuất báo cáo lớp."
        pill={<span className="tabular-nums">{classes.length} lớp được phân công</span>}
      />

      {loading ? (
        <div className="section-card flex items-center justify-center py-14 text-slate-500">
          <Loader2 className="mr-2 size-5 animate-spin text-blue-600" />
          <span className="text-sm">Đang tải danh sách lớp học...</span>
        </div>
      ) : classes.length === 0 ? (
        <div className="section-card py-14 text-center space-y-2">
          <School className="mx-auto size-9 text-slate-400" />
          <h3 className="text-base font-semibold text-slate-900">
            Bạn chưa được phân công lớp học nào
          </h3>
          <p className="mx-auto max-w-md text-xs text-slate-500 text-pretty">
            Theo quy trình trung tâm, Quản trị viên sẽ tạo lớp và phân công bạn làm Giáo viên chính hoặc Trợ giảng. Bạn vẫn có thể chuẩn bị sẵn Bộ đề Speaking trong lúc chờ phân lớp.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {classes.map((cls) => (
            <button
              key={cls.id}
              type="button"
              onClick={() => setSelectedClassId(cls.id)}
              className="section-card card-interactive flex flex-col justify-between gap-4 text-left"
            >
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-700">
                    {cls.code}
                  </span>
                  <div className="flex items-center gap-1.5">
                    {cls.my_member_role && (
                      <span className="rounded-md border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700">
                        {cls.my_member_role === 'assistant' ? 'Trợ giảng' : 'GV chính'}
                      </span>
                    )}
                    <span
                      className={`rounded-md border px-2 py-0.5 text-[11px] font-medium ${
                        cls.status === 'active'
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          : 'border-slate-200 bg-slate-100 text-slate-600'
                      }`}
                    >
                      {cls.status === 'active'
                        ? 'Đang học'
                        : cls.status === 'completed'
                          ? 'Hoàn thành'
                          : 'Lưu trữ'}
                    </span>
                  </div>
                </div>

                <div>
                  <h3 className="text-base font-bold text-slate-900 text-balance">{cls.name}</h3>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {getExamTypeName(cls.course_type)}
                    {cls.target_band != null ? ` · Mục tiêu Band ${Number(cls.target_band).toFixed(1)}` : ''}
                  </p>
                  {cls.schedule_text && (
                    <p className="mt-1 text-xs text-slate-600 truncate">{cls.schedule_text}</p>
                  )}
                </div>
              </div>

              <div className="space-y-3">
                <div className="grid grid-cols-4 gap-1.5 text-center text-[11px]">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                    <Users className="mx-auto size-3.5 text-slate-500 mb-0.5" />
                    <div className="font-bold text-slate-900 tabular-nums">{cls.student_count ?? 0}</div>
                    <div className="text-[10px] text-slate-500">HV</div>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                    <BookOpen className="mx-auto size-3.5 text-slate-500 mb-0.5" />
                    <div className="font-bold text-slate-900 tabular-nums">
                      {cls.assignment_count ?? 0}
                    </div>
                    <div className="text-[10px] text-slate-500">Bài tập</div>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                    <Award className="mx-auto size-3.5 text-emerald-600 mb-0.5" />
                    <div className="font-bold text-emerald-700 tabular-nums">
                      {cls.avg_band != null ? cls.avg_band.toFixed(1) : '--'}
                    </div>
                    <div className="text-[10px] text-slate-500">Band TB</div>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                    <Languages className="mx-auto size-3.5 text-blue-600 mb-0.5" />
                    <div className="font-bold text-blue-600 tabular-nums">
                      {cls.avg_en_percent != null ? `${cls.avg_en_percent.toFixed(0)}%` : '--'}
                    </div>
                    <div className="text-[10px] text-slate-500">EN TB</div>
                  </div>
                </div>

                <div className="flex items-center justify-between border-t border-slate-100 pt-2.5 text-xs">
                  {(cls.pending_review_count || 0) > 0 ? (
                    <span className="inline-flex items-center gap-1 font-semibold text-amber-700 tabular-nums">
                      <ClipboardCheck className="size-3.5" />
                      {cls.pending_review_count} bài chờ duyệt
                    </span>
                  ) : (
                    <span className="text-slate-500">Không có bài tồn đọng</span>
                  )}
                  <span className="inline-flex items-center gap-1 font-semibold text-blue-600">
                    Mở không gian lớp
                    <ArrowRight className="size-3.5" />
                  </span>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
