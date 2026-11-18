'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Calendar,
  CheckCircle2,
  Clock,
  Loader2,
  Play,
  School,
} from 'lucide-react';
import {
  fetchStudentAssignments,
  fetchStudentClasses,
  type StudentClassEnrollment,
} from '@/lib/classes';
import { getExamTypeName } from '@/lib/utils';
import { PageHeader } from '@/components/ui/AnalyticsCharts';
import { useToast } from '@/components/ToastProvider';
import type { AssignmentRecord, Profile } from '@/lib/types';

interface StudentClassesViewProps {
  currentUser: Profile;
  onStartAssignment: (assignment: AssignmentRecord) => void;
  onOpenSelfPractice: () => void;
  onViewSessionDetail: (sessionId: string) => void;
}

export function StudentClassesView({
  currentUser,
  onStartAssignment,
  onOpenSelfPractice,
  onViewSessionDetail,
}: StudentClassesViewProps) {
  const { showToast } = useToast();
  const [enrollments, setEnrollments] = useState<StudentClassEnrollment[]>([]);
  const [assignments, setAssignments] = useState<AssignmentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'todo' | 'done' | 'all'>('todo');
  const [classFilter, setClassFilter] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [clsList, asgList] = await Promise.all([
        fetchStudentClasses(currentUser.id),
        fetchStudentAssignments(currentUser.id),
      ]);
      setEnrollments(clsList);
      setAssignments(asgList);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Không thể tải thông tin lớp học', 'danger');
    } finally {
      setLoading(false);
    }
  }, [currentUser.id, showToast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const filteredAssignments = useMemo(() => {
    return assignments.filter((a) => {
      if (classFilter && a.class_id !== classFilter) return false;
      const done = (a.used_attempts || 0) > 0;
      if (filter === 'todo' && done) return false;
      if (filter === 'done' && !done) return false;
      return true;
    });
  }, [assignments, classFilter, filter]);

  const pendingCount = assignments.filter((a) => (a.used_attempts || 0) === 0).length;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="LỚP HỌC CỦA TÔI"
        title="Lớp học & Bài tập được giao"
        subtitle="Theo dõi các lớp bạn đang tham gia, tỷ lệ chuyên cần và hoàn thành các bài tập Speaking đúng hạn."
        pill={
          <span className="tabular-nums">
            {enrollments.length} lớp · {pendingCount} bài cần làm
          </span>
        }
      />

      {loading ? (
        <div className="section-card flex items-center justify-center py-14 text-slate-500">
          <Loader2 className="mr-2 size-5 animate-spin text-blue-600" />
          <span className="text-sm">Đang tải thông tin lớp học...</span>
        </div>
      ) : enrollments.length === 0 ? (
        <div className="section-card py-14 text-center space-y-4">
          <School className="mx-auto size-10 text-slate-400" />
          <div className="space-y-1">
            <h3 className="text-base font-bold text-slate-900 text-balance">
              Bạn đang chờ Trung tâm xếp lớp
            </h3>
            <p className="mx-auto max-w-md text-xs text-slate-500 text-pretty">
              Tài khoản của bạn chưa được gán vào lớp học nào. Khi Quản trị viên xếp lớp, lịch học và bài tập sẽ tự động hiển thị tại đây. Trong lúc chờ, bạn có thể luyện nói ngay với Kho tự luyện chung.
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenSelfPractice}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white hover:bg-slate-800 transition-colors duration-150"
          >
            <BookOpen className="size-4" />
            Mở Kho tự luyện chung
            <ArrowRight className="size-3.5" />
          </button>
        </div>
      ) : (
        <>
          {/* Enrolled Class Cards */}
          <div className="grid gap-4 md:grid-cols-2">
            {enrollments.map((enr) => {
              const cls = enr.classInfo;
              const attRate =
                enr.attendanceTotal > 0
                  ? Math.round((enr.attendancePresent / enr.attendanceTotal) * 100)
                  : null;
              return (
                <div key={cls.id} className="section-card space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-700">
                          {cls.code}
                        </span>
                        <span className="rounded border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700">
                          {getExamTypeName(cls.course_type)}
                        </span>
                      </div>
                      <h3 className="mt-1.5 text-base font-bold text-slate-900">{cls.name}</h3>
                    </div>
                    {cls.target_band != null && (
                      <span className="rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 tabular-nums shrink-0">
                        Mục tiêu {Number(cls.target_band).toFixed(1)}
                      </span>
                    )}
                  </div>

                  <div className="space-y-1 text-xs text-slate-600">
                    {cls.schedule_text && (
                      <div className="flex items-center gap-1.5">
                        <Calendar className="size-3.5 text-slate-400" />
                        <span>{cls.schedule_text}</span>
                      </div>
                    )}
                    <div>
                      Giáo viên:{' '}
                      <strong className="text-slate-800">
                        {enr.teachers.length > 0
                          ? enr.teachers
                              .map(
                                (t) =>
                                  `${t.full_name}${t.member_role === 'assistant' ? ' (Trợ giảng)' : ''}`,
                              )
                              .join(', ')
                          : 'Đang cập nhật'}
                      </strong>
                    </div>
                    <div className="tabular-nums">
                      Chuyên cần:{' '}
                      <strong className="text-slate-800">
                        {attRate != null
                          ? `${enr.attendancePresent}/${enr.attendanceTotal} buổi (${attRate}%)`
                          : 'Chưa có buổi điểm danh'}
                      </strong>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Assignments List */}
          <div className="section-card space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  Bài tập Speaking của lớp ({filteredAssignments.length})
                </h3>
                <p className="text-xs text-slate-500">
                  Bài tập tính điểm theo lượt cao nhất. Nộp sau hạn vẫn được ghi nhận nhưng gắn nhãn Nộp trễ.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {enrollments.length > 1 && (
                  <select
                    value={classFilter}
                    onChange={(e) => setClassFilter(e.target.value)}
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 focus:border-blue-600 focus:outline-none"
                  >
                    <option value="">Tất cả lớp</option>
                    {enrollments.map((e) => (
                      <option key={e.classInfo.id} value={e.classInfo.id}>
                        {e.classInfo.name}
                      </option>
                    ))}
                  </select>
                )}
                <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-0.5 text-xs">
                  {(
                    [
                      { id: 'todo', label: `Cần làm (${pendingCount})` },
                      { id: 'done', label: `Đã nộp (${assignments.length - pendingCount})` },
                      { id: 'all', label: 'Tất cả' },
                    ] as const
                  ).map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setFilter(t.id)}
                      className={`rounded-md px-2.5 py-1 font-semibold transition-colors duration-150 ${
                        filter === t.id
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {filteredAssignments.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 py-10 text-center space-y-2">
                <CheckCircle2 className="mx-auto size-7 text-emerald-600" />
                <p className="text-sm font-medium text-slate-700">
                  {filter === 'todo'
                    ? 'Tuyệt vời! Bạn không còn bài tập nào chưa nộp.'
                    : 'Chưa có bài tập nào trong mục này.'}
                </p>
                <button
                  type="button"
                  onClick={onOpenSelfPractice}
                  className="text-xs font-semibold text-blue-600 hover:text-blue-700"
                >
                  Luyện thêm trong Kho tự luyện →
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredAssignments.map((a) => {
                  const used = a.used_attempts || 0;
                  const maxAtt = a.max_attempts || 0;
                  const exhausted = maxAtt > 0 && used >= maxAtt;
                  const isOverdue = Boolean(
                    a.due_at && new Date(a.due_at).getTime() < Date.now() && used === 0,
                  );

                  return (
                    <div
                      key={a.id}
                      className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-xl border border-slate-200 bg-white p-4"
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-sm font-bold text-slate-900">{a.title}</span>
                          {a.class_info?.name && (
                            <span className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                              {a.class_info.name}
                            </span>
                          )}
                          <span
                            className={`rounded border px-2 py-0.5 text-[11px] font-semibold ${
                              a.mode === 'exam'
                                ? 'border-amber-200 bg-amber-50 text-amber-800'
                                : 'border-blue-200 bg-blue-50 text-blue-700'
                            }`}
                          >
                            {a.mode === 'exam' ? 'Thi thử bấm giờ' : 'Luyện tập từng câu'}
                          </span>
                          {isOverdue && (
                            <span className="inline-flex items-center gap-1 rounded border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700">
                              <AlertTriangle className="size-3" /> Quá hạn
                            </span>
                          )}
                          {a.has_late_submission && (
                            <span className="rounded border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700">
                              Nộp trễ
                            </span>
                          )}
                        </div>

                        {a.instructions && (
                          <p className="text-xs text-slate-600 text-pretty">{a.instructions}</p>
                        )}

                        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 tabular-nums">
                          <span className="inline-flex items-center gap-1">
                            <Clock className="size-3.5" />
                            Hạn nộp:{' '}
                            <strong className={isOverdue ? 'text-rose-600' : 'text-slate-700'}>
                              {a.due_at
                                ? new Date(a.due_at).toLocaleString('vi-VN')
                                : 'Không giới hạn'}
                            </strong>
                          </span>
                          <span>
                            Lượt làm: <strong>{used}</strong>
                            {maxAtt > 0 ? `/${maxAtt}` : ' (Không giới hạn)'}
                          </span>
                          {a.best_score != null && (
                            <span className="font-semibold text-emerald-700">
                              Điểm cao nhất: {a.best_score.toFixed(1)}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {a.latest_session?.id && (
                          <button
                            type="button"
                            onClick={() => onViewSessionDetail(a.latest_session!.id)}
                            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors duration-150"
                          >
                            Xem bài nộp
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={exhausted}
                          onClick={() => onStartAssignment(a)}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-45 transition-colors duration-150"
                        >
                          <Play className="size-3.5" />
                          {exhausted
                            ? 'Đã hết lượt'
                            : used > 0
                              ? 'Làm lại cải thiện'
                              : 'Làm bài ngay'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
