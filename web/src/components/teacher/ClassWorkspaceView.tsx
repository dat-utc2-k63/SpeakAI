'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Award,
  BookOpen,
  Calendar,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  FileSpreadsheet,
  Languages,
  Loader2,
  Mic,
  Plus,
  Printer,
  Save,
  Trash2,
  Users,
} from 'lucide-react';
import {
  createAssignment,
  createLesson,
  deleteAssignment,
  deleteLesson,
  exportClassReportCsv,
  fetchAssignableQuestionSets,
  fetchClassWorkspaceBundle,
  saveLessonAttendanceBulk,
  updateLesson,
  type ClassWorkspaceBundle,
} from '@/lib/classes';
import { formatDurationReadable, formatScoreValue, getExamTypeName, getAvatarUrl } from '@/lib/utils';
import { Modal } from '@/components/ui/Modal';
import { ClassroomTimelineStrip, SkillRadarChart } from '@/components/ui/AnalyticsCharts';
import { PracticeDetailModal } from '@/components/PracticeDetailModal';
import { AssessmentDetailModal } from '@/components/AssessmentDetailModal';
import { StudentRecordModal } from '@/components/StudentRecordModal';
import { useToast } from '@/components/ToastProvider';
import type {
  Assessment,
  AttendanceStatus,
  ClassroomAnalysisRecord,
  LessonRecord,
  LessonStatus,
  Profile,
  QuestionSet,
  SessionMode,
} from '@/lib/types';

interface ClassWorkspaceViewProps {
  classId: string;
  currentUser: Profile;
  onBack: () => void;
  onStartClassroomAnalysis?: (classId: string, lessonId?: string) => void;
  onStartAssess1on1?: (classId: string, lessonId?: string) => void;
  onReviewChanged?: () => void;
}

type WorkspaceTab = 'overview' | 'lessons' | 'assignments' | 'students' | 'history';

const ATTENDANCE_LABELS: Record<AttendanceStatus, { label: string; cls: string }> = {
  present: { label: 'Có mặt', cls: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  late: { label: 'Trễ', cls: 'border-amber-200 bg-amber-50 text-amber-800' },
  absent: { label: 'Vắng', cls: 'border-rose-200 bg-rose-50 text-rose-700' },
  excused: { label: 'Có phép', cls: 'border-slate-200 bg-slate-100 text-slate-700' },
};

export function ClassWorkspaceView({
  classId,
  currentUser,
  onBack,
  onStartClassroomAnalysis,
  onStartAssess1on1,
  onReviewChanged,
}: ClassWorkspaceViewProps) {
  const { showToast } = useToast();

  const [bundle, setBundle] = useState<ClassWorkspaceBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<WorkspaceTab>('overview');

  // Lesson modal & attendance state
  const [lessonModalOpen, setLessonModalOpen] = useState(false);
  const [editingLesson, setEditingLesson] = useState<LessonRecord | null>(null);
  const [lessonNo, setLessonNo] = useState(1);
  const [lessonTitle, setLessonTitle] = useState('');
  const [lessonDate, setLessonDate] = useState('');
  const [lessonNotes, setLessonNotes] = useState('');
  const [lessonStatus, setLessonStatus] = useState<LessonStatus>('planned');
  const [savingLesson, setSavingLesson] = useState(false);

  const [attendanceLessonId, setAttendanceLessonId] = useState<string | null>(null);
  const [attendanceDraft, setAttendanceDraft] = useState<
    Record<string, { status: AttendanceStatus; note: string }>
  >({});
  const [savingAttendance, setSavingAttendance] = useState(false);

  // Assignment modal state
  const [asgModalOpen, setAsgModalOpen] = useState(false);
  const [availableSets, setAvailableSets] = useState<QuestionSet[]>([]);
  const [asgSetId, setAsgSetId] = useState('');
  const [asgTitle, setAsgTitle] = useState('');
  const [asgInstructions, setAsgInstructions] = useState('');
  const [asgMode, setAsgMode] = useState<SessionMode>('practice');
  const [asgDueAt, setAsgDueAt] = useState('');
  const [asgMaxAttempts, setAsgMaxAttempts] = useState<number>(0);
  const [asgMinBand, setAsgMinBand] = useState<string>('');
  const [asgLessonId, setAsgLessonId] = useState<string>('');
  const [savingAsg, setSavingAsg] = useState(false);

  // Detail modals
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [selectedAssessment, setSelectedAssessment] = useState<Assessment | null>(null);
  const [selectedAnalysis, setSelectedAnalysis] = useState<ClassroomAnalysisRecord | null>(null);
  const [selectedStudentRecordId, setSelectedStudentRecordId] = useState<string | null>(null);

  const loadWorkspace = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchClassWorkspaceBundle(classId);
      setBundle(data);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Không thể tải dữ liệu lớp học', 'danger');
    } finally {
      setLoading(false);
    }
  }, [classId, showToast]);

  useEffect(() => {
    loadWorkspace();
  }, [loadWorkspace]);

  const students = useMemo(
    () => (bundle?.members || []).filter((m) => m.member_role === 'student' && m.profile),
    [bundle?.members],
  );
  const teachers = useMemo(
    () =>
      (bundle?.members || []).filter(
        (m) => (m.member_role === 'lead_teacher' || m.member_role === 'assistant') && m.profile,
      ),
    [bundle?.members],
  );

  // Open lesson create/edit
  const openCreateLesson = () => {
    const nextNo = (bundle?.lessons.reduce((m, l) => Math.max(m, l.lesson_no), 0) || 0) + 1;
    setEditingLesson(null);
    setLessonNo(nextNo);
    setLessonTitle('');
    setLessonDate('');
    setLessonNotes('');
    setLessonStatus('planned');
    setLessonModalOpen(true);
  };

  const openEditLesson = (l: LessonRecord) => {
    setEditingLesson(l);
    setLessonNo(l.lesson_no);
    setLessonTitle(l.title);
    setLessonDate(l.scheduled_at ? new Date(l.scheduled_at).toISOString().slice(0, 16) : '');
    setLessonNotes(l.summary_notes || '');
    setLessonStatus(l.status);
    setLessonModalOpen(true);
  };

  const handleSaveLesson = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!lessonTitle.trim()) return;
    setSavingLesson(true);
    try {
      const scheduledIso = lessonDate ? new Date(lessonDate).toISOString() : null;
      if (editingLesson) {
        await updateLesson(editingLesson.id, {
          lesson_no: lessonNo,
          title: lessonTitle.trim(),
          scheduled_at: scheduledIso,
          summary_notes: lessonNotes.trim() || null,
          status: lessonStatus,
        });
        showToast('Đã cập nhật buổi học.', 'success');
      } else {
        await createLesson({
          class_id: classId,
          lesson_no: lessonNo,
          title: lessonTitle.trim(),
          scheduled_at: scheduledIso,
          summary_notes: lessonNotes.trim() || null,
          status: lessonStatus,
          created_by: currentUser.id,
        });
        showToast('Đã tạo buổi học mới.', 'success');
      }
      setLessonModalOpen(false);
      await loadWorkspace();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Lỗi lưu buổi học', 'danger');
    } finally {
      setSavingLesson(false);
    }
  };

  const handleDeleteLesson = async (l: LessonRecord) => {
    if (!window.confirm(`Xóa Buổi ${l.lesson_no}: "${l.title}" và dữ liệu điểm danh của buổi này?`)) return;
    try {
      await deleteLesson(l.id);
      showToast('Đã xóa buổi học.', 'info');
      await loadWorkspace();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Lỗi xóa buổi học', 'danger');
    }
  };

  const openAttendancePanel = (l: LessonRecord) => {
    const existingMap = new Map(
      (bundle?.attendance || [])
        .filter((a) => a.lesson_id === l.id)
        .map((a) => [a.student_id, a]),
    );
    const nextDraft: Record<string, { status: AttendanceStatus; note: string }> = {};
    for (const m of students) {
      const ex = existingMap.get(m.user_id);
      nextDraft[m.user_id] = {
        status: ex?.status || 'present',
        note: ex?.note || '',
      };
    }
    setAttendanceDraft(nextDraft);
    setAttendanceLessonId(l.id);
  };

  const handleSaveAttendance = async () => {
    if (!attendanceLessonId) return;
    setSavingAttendance(true);
    try {
      const entries = Object.entries(attendanceDraft).map(([student_id, val]) => ({
        student_id,
        status: val.status,
        note: val.note || null,
      }));
      await saveLessonAttendanceBulk(attendanceLessonId, currentUser.id, entries);
      showToast('Đã lưu điểm danh buổi học!', 'success');
      setAttendanceLessonId(null);
      await loadWorkspace();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Lỗi lưu điểm danh', 'danger');
    } finally {
      setSavingAttendance(false);
    }
  };

  // Assignments
  const openCreateAssignment = async () => {
    setAsgModalOpen(true);
    setAsgTitle('');
    setAsgInstructions('');
    setAsgMode('practice');
    setAsgDueAt('');
    setAsgMaxAttempts(0);
    setAsgMinBand(bundle?.classInfo.target_band ? String(bundle.classInfo.target_band) : '');
    setAsgLessonId('');
    setAsgSetId('');
    try {
      const sets = await fetchAssignableQuestionSets();
      setAvailableSets(sets);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Không thể tải kho bộ đề', 'danger');
    }
  };

  const handleSaveAssignment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!asgSetId || !asgTitle.trim()) return;
    setSavingAsg(true);
    try {
      await createAssignment({
        class_id: classId,
        lesson_id: asgLessonId || null,
        set_id: asgSetId,
        title: asgTitle.trim(),
        instructions: asgInstructions.trim() || null,
        mode: asgMode,
        due_at: asgDueAt ? new Date(asgDueAt).toISOString() : null,
        max_attempts: asgMaxAttempts,
        min_band_target: asgMinBand ? Number(asgMinBand) : null,
        assigned_by: currentUser.id,
      });
      showToast('Đã giao bài tập cho lớp!', 'success');
      setAsgModalOpen(false);
      await loadWorkspace();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Lỗi giao bài tập', 'danger');
    } finally {
      setSavingAsg(false);
    }
  };

  const handleDeleteAssignment = async (id: string, title: string) => {
    if (!window.confirm(`Xóa bài tập "${title}" khỏi lớp? (Bài đã nộp vẫn giữ trong lịch sử học viên)`)) return;
    try {
      await deleteAssignment(id);
      showToast('Đã xóa bài tập.', 'info');
      await loadWorkspace();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Lỗi xóa bài tập', 'danger');
    }
  };

  if (loading && !bundle) {
    return (
      <div className="section-card flex items-center justify-center py-16 text-slate-500">
        <Loader2 className="mr-2 size-5 animate-spin text-blue-600" />
        <span className="text-sm">Đang tải không gian lớp học...</span>
      </div>
    );
  }

  if (!bundle) {
    return (
      <div className="section-card py-12 text-center space-y-3">
        <p className="text-sm text-slate-500">Không tìm thấy thông tin lớp học.</p>
        <button
          type="button"
          onClick={onBack}
          className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white"
        >
          Quay lại danh sách lớp
        </button>
      </div>
    );
  }

  const cls = bundle.classInfo;
  const totalCompletionPairs = bundle.studentRows.length * bundle.assignments.length;
  const completedPairs = bundle.studentRows.reduce((s, r) => s + r.assignmentsCompleted, 0);
  const completionPct =
    totalCompletionPairs > 0 ? Math.round((completedPairs / totalCompletionPairs) * 100) : null;
  const avgEnPct =
    bundle.analyses.length > 0
      ? Number(
          (
            bundle.analyses.reduce((s, a) => s + Number(a.en_percent || 0), 0) /
            bundle.analyses.length
          ).toFixed(1),
        )
      : null;
  const atRiskStudents = bundle.studentRows.filter((r) => r.isAtRisk);
  const pendingReviewCount = bundle.sessions.filter((s) => s.status === 'completed').length;

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <button
            type="button"
            onClick={onBack}
            className="no-print inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-900 transition-colors duration-150"
          >
            <ArrowLeft className="size-3.5" />
            Quay lại danh sách lớp
          </button>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-2xl font-bold text-slate-900 text-balance">{cls.name}</h2>
            <span className="rounded-md border border-slate-200 bg-white px-2 py-0.5 font-mono text-xs font-semibold text-slate-700">
              {cls.code}
            </span>
            <span className="rounded-md border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700">
              {getExamTypeName(cls.course_type)}
            </span>
            {cls.target_band != null && (
              <span className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 tabular-nums">
                Mục tiêu Band {Number(cls.target_band).toFixed(1)}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 text-pretty">
            {cls.schedule_text ? `Lịch học: ${cls.schedule_text} · ` : ''}
            Giáo viên:{' '}
            {teachers.length > 0
              ? teachers
                  .map(
                    (t) =>
                      `${t.profile?.full_name}${t.member_role === 'assistant' ? ' (Trợ giảng)' : ''}`,
                  )
                  .join(', ')
              : 'Chưa phân công'}
          </p>
        </div>

        <div className="no-print flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => exportClassReportCsv(bundle)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors duration-150"
          >
            <FileSpreadsheet className="size-3.5 text-emerald-600" />
            Tải báo cáo Excel
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 transition-colors duration-150"
          >
            <Printer className="size-3.5" />
            In / Lưu PDF
          </button>
        </div>
      </div>

      {/* 5 Workspace Tabs */}
      <div className="no-print flex items-center gap-1 overflow-x-auto border-b border-slate-200 pb-px">
        {(
          [
            { id: 'overview', label: 'Tổng quan & Báo cáo' },
            { id: 'lessons', label: `Buổi học & Điểm danh (${bundle.lessons.length})` },
            { id: 'assignments', label: `Bài tập & Ma trận (${bundle.assignments.length})` },
            { id: 'students', label: `Học viên (${students.length})` },
            {
              id: 'history',
              label: `Lịch sử EN/VI & 1-1 (${bundle.analyses.length + bundle.assessments.length})`,
            },
          ] as Array<{ id: WorkspaceTab; label: string }>
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`shrink-0 border-b-2 px-3.5 py-2.5 text-xs font-semibold transition-colors duration-150 ${
              tab === t.id
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* TAB 1: OVERVIEW & PRINTABLE REPORT */}
      {tab === 'overview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
            <div className="section-card !p-4 flex items-center gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                <Users className="size-5" />
              </div>
              <div>
                <div className="text-2xl font-bold text-slate-900 tabular-nums">{students.length}</div>
                <div className="text-xs text-slate-500">Học viên lớp</div>
              </div>
            </div>

            <div className="section-card !p-4 flex items-center gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
                <Award className="size-5" />
              </div>
              <div>
                <div className="text-2xl font-bold text-emerald-700 tabular-nums">
                  {bundle.skillAverages.avgTotal != null
                    ? bundle.skillAverages.avgTotal.toFixed(1)
                    : '--'}
                </div>
                <div className="text-xs text-slate-500">
                  Band TB {cls.target_band != null ? `/ Mục tiêu ${Number(cls.target_band).toFixed(1)}` : ''}
                </div>
              </div>
            </div>

            <div className="section-card !p-4 flex items-center gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-700">
                <ClipboardCheck className="size-5" />
              </div>
              <div>
                <div className="text-2xl font-bold text-slate-900 tabular-nums">
                  {completionPct != null ? `${completionPct}%` : '--'}
                </div>
                <div className="text-xs text-slate-500">
                  Tỷ lệ nộp BT ({pendingReviewCount} chờ duyệt)
                </div>
              </div>
            </div>

            <div className="section-card !p-4 flex items-center gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-700">
                <Languages className="size-5" />
              </div>
              <div>
                <div className="text-2xl font-bold text-blue-600 tabular-nums">
                  {avgEnPct != null ? `${avgEnPct}%` : '--'}
                </div>
                <div className="text-xs text-slate-500">
                  Tỷ lệ EN TB ({bundle.analyses.length} buổi)
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-12">
            <div className="section-card lg:col-span-5 space-y-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Hồ sơ 4 kỹ năng IELTS của lớp</h3>
                <p className="text-xs text-slate-500">
                  Tổng hợp từ bài tập Speaking &amp; các buổi chấm hội thoại 1-1 của lớp.
                </p>
              </div>
              <SkillRadarChart
                size={250}
                skills={[
                  { label: 'Pronunciation (P)', value: bundle.skillAverages.avgP },
                  { label: 'Fluency (FC)', value: bundle.skillAverages.avgFC },
                  { label: 'Lexical (LR)', value: bundle.skillAverages.avgLR },
                  { label: 'Grammar (GRA)', value: bundle.skillAverages.avgGRA },
                ]}
              />
            </div>

            <div className="section-card lg:col-span-7 space-y-3">
              <div className="flex items-center justify-between gap-2 border-b border-slate-200 pb-2.5">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <AlertTriangle className="size-4 text-amber-600" />
                  Học viên cần chú ý ({atRiskStudents.length})
                </h3>
                <span className="text-[11px] text-slate-500">
                  Band thấp hơn mục tiêu &ge; 1.0, bỏ bài quá hạn, hoặc chuyên cần &lt; 75%
                </span>
              </div>

              {atRiskStudents.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 py-10 text-center">
                  <CheckCircle2 className="size-7 text-emerald-600 mb-2" />
                  <p className="text-sm font-semibold text-slate-800">Cả lớp đang theo đúng tiến độ</p>
                  <p className="mt-1 text-xs text-slate-500">
                    Chưa có học viên nào tụt Band hoặc bỏ bài tập quá hạn.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {atRiskStudents.map((row) => (
                    <div
                      key={row.student.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-slate-900">
                          {row.student.full_name}
                        </div>
                        <div className="text-xs text-amber-800">{row.riskReasons.join(' · ')}</div>
                      </div>
                      <span className="rounded-md bg-white border border-amber-200 px-2.5 py-1 text-xs font-bold text-slate-900 tabular-nums">
                        Band {row.avgBand != null ? row.avgBand.toFixed(1) : '--'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Printable Class Scorecard Summary */}
          <div className="section-card space-y-3">
            <h3 className="text-sm font-semibold text-slate-900">
              Bảng tổng hợp tiến độ lớp học ({bundle.studentRows.length} học viên)
            </h3>
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="px-3.5 py-2.5 font-semibold">Học viên</th>
                    <th className="px-3.5 py-2.5 font-semibold">Chuyên cần</th>
                    <th className="px-3.5 py-2.5 font-semibold">Bài tập</th>
                    <th className="px-3.5 py-2.5 font-semibold text-right">Band TB</th>
                    <th className="px-3.5 py-2.5 font-semibold text-right">P</th>
                    <th className="px-3.5 py-2.5 font-semibold text-right">FC</th>
                    <th className="px-3.5 py-2.5 font-semibold text-right">LR</th>
                    <th className="px-3.5 py-2.5 font-semibold text-right">GRA</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {bundle.studentRows.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                        Lớp chưa có học viên nào được phân công.
                      </td>
                    </tr>
                  ) : (
                    bundle.studentRows.map((r) => (
                      <tr key={r.student.id}>
                        <td className="px-3.5 py-2.5">
                          <button
                            type="button"
                            onClick={() => setSelectedStudentRecordId(r.student.id)}
                            className="text-left group"
                          >
                            <div className="font-semibold text-slate-900 group-hover:text-blue-600 transition-colors">
                              {r.student.full_name}
                            </div>
                            <div className="text-[11px] text-slate-500">{r.student.email}</div>
                          </button>
                        </td>
                        <td className="px-3.5 py-2.5 tabular-nums text-slate-700">
                          {r.attendanceRate != null
                            ? `${r.attendancePresent}/${r.attendanceTotal} (${r.attendanceRate}%)`
                            : '--'}
                        </td>
                        <td className="px-3.5 py-2.5 tabular-nums text-slate-700">
                          {r.assignmentsCompleted}/{r.assignmentsTotal}
                        </td>
                        <td className="px-3.5 py-2.5 text-right font-bold text-slate-900 tabular-nums">
                          {r.avgBand != null ? r.avgBand.toFixed(1) : '--'}
                        </td>
                        <td className="px-3.5 py-2.5 text-right text-emerald-700 font-semibold tabular-nums">
                          {r.avgP != null ? r.avgP.toFixed(1) : '--'}
                        </td>
                        <td className="px-3.5 py-2.5 text-right text-blue-600 font-semibold tabular-nums">
                          {r.avgFC != null ? r.avgFC.toFixed(1) : '--'}
                        </td>
                        <td className="px-3.5 py-2.5 text-right text-amber-700 font-semibold tabular-nums">
                          {r.avgLR != null ? r.avgLR.toFixed(1) : '--'}
                        </td>
                        <td className="px-3.5 py-2.5 text-right text-slate-700 font-semibold tabular-nums">
                          {r.avgGRA != null ? r.avgGRA.toFixed(1) : '--'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: LESSONS & ATTENDANCE */}
      {tab === 'lessons' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Lộ trình Buổi học &amp; Điểm danh</h3>
              <p className="text-xs text-slate-500">
                Tạo từng buổi học, điểm danh nhanh 1 click và gắn phân tích EN/VI hoặc chấm 1-1 trực tiếp vào buổi.
              </p>
            </div>
            <button
              type="button"
              onClick={openCreateLesson}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 transition-colors duration-150"
            >
              <Plus className="size-3.5" />
              Thêm buổi học
            </button>
          </div>

          {bundle.lessons.length === 0 ? (
            <div className="section-card py-12 text-center space-y-3">
              <Calendar className="mx-auto size-8 text-slate-400" />
              <p className="text-sm text-slate-600">Lớp chưa có buổi học nào trong lộ trình.</p>
              <button
                type="button"
                onClick={openCreateLesson}
                className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 transition-colors duration-150"
              >
                Tạo Buổi học đầu tiên
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {bundle.lessons.map((l) => {
                const lAtt = bundle.attendance.filter((a) => a.lesson_id === l.id);
                const presentCount = lAtt.filter((a) => a.status === 'present' || a.status === 'late').length;
                const lAnalyses = bundle.analyses.filter((a) => a.lesson_id === l.id);
                const lAssess = bundle.assessments.filter((a) => a.lesson_id === l.id);
                return (
                  <div key={l.id} className="section-card !p-4 space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-md bg-slate-900 px-2 py-0.5 text-[11px] font-semibold text-white tabular-nums">
                            Buổi {l.lesson_no}
                          </span>
                          <span className="text-sm font-semibold text-slate-900">{l.title}</span>
                          <span
                            className={`rounded-md border px-2 py-0.5 text-[11px] font-medium ${
                              l.status === 'completed'
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                : l.status === 'cancelled'
                                  ? 'border-rose-200 bg-rose-50 text-rose-700'
                                  : 'border-slate-200 bg-slate-50 text-slate-600'
                            }`}
                          >
                            {l.status === 'completed'
                              ? 'Đã dạy'
                              : l.status === 'cancelled'
                                ? 'Đã hủy'
                                : 'Dự kiến'}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                          {l.scheduled_at && (
                            <span className="inline-flex items-center gap-1 tabular-nums">
                              <Clock className="size-3.5" />
                              {new Date(l.scheduled_at).toLocaleString('vi-VN')}
                            </span>
                          )}
                          <span className="tabular-nums">
                            Điểm danh: <strong className="text-slate-800">{presentCount}/{students.length}</strong>
                          </span>
                          {lAnalyses.length > 0 && (
                            <span className="text-blue-600 font-medium tabular-nums">
                              EN/VI: {Number(lAnalyses[0].en_percent).toFixed(0)}% EN
                            </span>
                          )}
                          {lAssess.length > 0 && (
                            <span className="text-emerald-700 font-medium tabular-nums">
                              {lAssess.length} bài chấm 1-1
                            </span>
                          )}
                        </div>
                        {l.summary_notes && (
                          <p className="text-xs text-slate-600 text-pretty">{l.summary_notes}</p>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => openAttendancePanel(l)}
                          className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100 transition-colors duration-150"
                        >
                          Điểm danh
                        </button>
                        {onStartClassroomAnalysis && (
                          <button
                            type="button"
                            onClick={() => onStartClassroomAnalysis(classId, l.id)}
                            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors duration-150"
                          >
                            EN/VI
                          </button>
                        )}
                        {onStartAssess1on1 && (
                          <button
                            type="button"
                            onClick={() => onStartAssess1on1(classId, l.id)}
                            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors duration-150"
                          >
                            Chấm 1-1
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => openEditLesson(l)}
                          className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors duration-150"
                        >
                          Sửa
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteLesson(l)}
                          aria-label={`Xóa buổi ${l.lesson_no}`}
                          className="rounded-lg border border-rose-200 bg-rose-50 p-1.5 text-rose-600 hover:bg-rose-100 transition-colors duration-150"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: ASSIGNMENTS & CLASS MATRIX */}
      {tab === 'assignments' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                Bài tập giao theo lớp &amp; Ma trận nộp bài
              </h3>
              <p className="text-xs text-slate-500">
                Bảng tự lấy điểm cao nhất của mỗi học viên. Bấm trực tiếp vào điểm để xem chi tiết và duyệt bài.
              </p>
            </div>
            <button
              type="button"
              onClick={openCreateAssignment}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 transition-colors duration-150"
            >
              <Plus className="size-3.5" />
              Giao bài tập mới
            </button>
          </div>

          {bundle.assignments.length === 0 ? (
            <div className="section-card py-12 text-center space-y-3">
              <BookOpen className="mx-auto size-8 text-slate-400" />
              <p className="text-sm text-slate-600">Chưa có bài tập nào được giao cho lớp này.</p>
              <button
                type="button"
                onClick={openCreateAssignment}
                className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 transition-colors duration-150"
              >
                Giao bài tập đầu tiên
              </button>
            </div>
          ) : (
            <>
              {/* Assignment List */}
              <div className="grid gap-3 md:grid-cols-2">
                {bundle.assignments.map((a) => {
                  const submittedCount = bundle.studentRows.filter(
                    (r) => r.cells[a.id]?.status !== 'not_submitted',
                  ).length;
                  return (
                    <div key={a.id} className="section-card !p-4 flex items-start justify-between gap-3">
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-sm font-semibold text-slate-900 truncate">{a.title}</span>
                          <span
                            className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold ${
                              a.mode === 'exam'
                                ? 'border-amber-200 bg-amber-50 text-amber-800'
                                : 'border-blue-200 bg-blue-50 text-blue-700'
                            }`}
                          >
                            {a.mode === 'exam' ? 'Thi thử' : 'Luyện tập'}
                          </span>
                        </div>
                        <div className="text-xs text-slate-500">
                          Bộ đề: <strong className="text-slate-700">{a.question_set?.title}</strong>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500 tabular-nums">
                          <span>
                            Hạn nộp:{' '}
                            <strong className="text-slate-700">
                              {a.due_at ? new Date(a.due_at).toLocaleString('vi-VN') : 'Không giới hạn'}
                            </strong>
                          </span>
                          <span>·</span>
                          <span>
                            Tối đa: {a.max_attempts > 0 ? `${a.max_attempts} lượt` : 'Không giới hạn'}
                          </span>
                          <span>·</span>
                          <span className="font-semibold text-blue-600">
                            Đã nộp: {submittedCount}/{students.length}
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDeleteAssignment(a.id, a.title)}
                        aria-label={`Xóa bài tập ${a.title}`}
                        className="rounded-lg border border-rose-200 bg-rose-50 p-1.5 text-rose-600 hover:bg-rose-100 transition-colors duration-150 shrink-0"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* Submission Matrix */}
              <div className="section-card space-y-3">
                <h4 className="text-sm font-semibold text-slate-900">
                  Ma trận Học viên &times; Bài tập (Điểm cao nhất)
                </h4>
                <div className="overflow-x-auto rounded-lg border border-slate-200">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                      <tr>
                        <th className="sticky left-0 bg-slate-50 px-3.5 py-2.5 font-semibold min-w-[180px]">
                          Học viên
                        </th>
                        {bundle.assignments.map((a) => (
                          <th key={a.id} className="px-3 py-2.5 font-semibold text-center min-w-[125px]">
                            <div className="truncate max-w-[140px] mx-auto" title={a.title}>
                              {a.title}
                            </div>
                            <div className="text-[10px] font-normal text-slate-400">
                              {a.due_at ? new Date(a.due_at).toLocaleDateString('vi-VN') : 'Không hạn'}
                            </div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {bundle.studentRows.map((row) => (
                        <tr key={row.student.id} className="hover:bg-slate-50">
                          <td className="sticky left-0 bg-white px-3.5 py-2.5 font-semibold text-slate-900">
                            {row.student.full_name}
                          </td>
                          {bundle.assignments.map((a) => {
                            const cell = row.cells[a.id];
                            if (!cell || cell.status === 'not_submitted') {
                              const overdue = a.due_at && new Date(a.due_at).getTime() < Date.now();
                              return (
                                <td key={a.id} className="px-3 py-2.5 text-center">
                                  <span
                                    className={`inline-block rounded-md px-2 py-0.5 text-[11px] font-medium ${
                                      overdue
                                        ? 'border border-rose-200 bg-rose-50 text-rose-700'
                                        : 'text-slate-400'
                                    }`}
                                  >
                                    {overdue ? 'Quá hạn' : 'Chưa nộp'}
                                  </span>
                                </td>
                              );
                            }
                            return (
                              <td key={a.id} className="px-3 py-2.5 text-center">
                                <button
                                  type="button"
                                  onClick={() => cell.bestSessionId && setSelectedSessionId(cell.bestSessionId)}
                                  className={`inline-flex flex-col items-center rounded-lg border px-2.5 py-1 transition-colors duration-150 ${
                                    cell.status === 'reviewed'
                                      ? 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                                      : 'border-blue-200 bg-blue-50 text-blue-800 hover:bg-blue-100'
                                  }`}
                                >
                                  <span className="font-bold tabular-nums">
                                    {cell.bestScore != null ? cell.bestScore.toFixed(1) : '--'}
                                  </span>
                                  <span className="text-[10px]">
                                    {cell.status === 'reviewed' ? 'Đã duyệt' : 'Chờ duyệt'}
                                    {cell.isLate ? ' · Trễ' : ''}
                                  </span>
                                </button>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* TAB 4: STUDENTS IN CLASS */}
      {tab === 'students' && (
        <div className="section-card space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">
              Danh sách Học viên ({bundle.studentRows.length})
            </h3>
            <span className="text-xs text-slate-500">
              Quản trị viên quản lý việc thêm/gỡ học viên khỏi lớp.
            </span>
          </div>
          {bundle.studentRows.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 py-10 text-center text-sm text-slate-500">
              Lớp chưa có học viên. Vui lòng liên hệ Quản trị viên để xếp học viên vào lớp.
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {bundle.studentRows.map((row) => (
                <div
                  key={row.student.id}
                  className="rounded-xl border border-slate-200 bg-white p-4 space-y-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <img
                        src={getAvatarUrl(row.student.full_name, 72)}
                        alt={row.student.full_name}
                        className="size-10 rounded-full border border-slate-200 object-cover"
                      />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-slate-900">
                          {row.student.full_name}
                        </div>
                        <div className="truncate text-xs text-slate-500">{row.student.email}</div>
                      </div>
                    </div>
                    <span
                      className={`rounded-md border px-2 py-0.5 text-[11px] font-medium shrink-0 ${
                        row.student.voice_enrolled
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          : 'border-amber-200 bg-amber-50 text-amber-800'
                      }`}
                    >
                      {row.student.voice_enrolled ? 'Có mẫu giọng' : 'Chưa có giọng'}
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-center text-xs">
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                      <div className="text-[11px] text-slate-500">Band TB</div>
                      <div className="font-bold text-slate-900 tabular-nums">
                        {row.avgBand != null ? row.avgBand.toFixed(1) : '--'}
                      </div>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                      <div className="text-[11px] text-slate-500">Bài tập</div>
                      <div className="font-bold text-blue-600 tabular-nums">
                        {row.assignmentsCompleted}/{row.assignmentsTotal}
                      </div>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                      <div className="text-[11px] text-slate-500">Chuyên cần</div>
                      <div className="font-bold text-emerald-700 tabular-nums">
                        {row.attendanceRate != null ? `${row.attendanceRate}%` : '--'}
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-end border-t border-slate-100 pt-2.5">
                    <button
                      type="button"
                      onClick={() => setSelectedStudentRecordId(row.student.id)}
                      className="text-xs font-semibold text-blue-600 hover:text-blue-700"
                    >
                      Xem hồ sơ &amp; lịch sử học tập →
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 5: CLASSROOM EN/VI & 1-1 HISTORY */}
      {tab === 'history' && (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="section-card space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Languages className="size-4 text-blue-600" />
                Lịch sử Phân tích Tiết dạy EN/VI ({bundle.analyses.length})
              </h3>
              {onStartClassroomAnalysis && (
                <button
                  type="button"
                  onClick={() => onStartClassroomAnalysis(classId)}
                  className="text-xs font-semibold text-blue-600 hover:text-blue-700"
                >
                  + Phân tích mới
                </button>
              )}
            </div>

            {bundle.analyses.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 py-8 text-center text-xs text-slate-500">
                Chưa có bản ghi phân tích EN/VI nào gắn với lớp này.
              </div>
            ) : (
              <div className="space-y-2.5">
                {bundle.analyses.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => setSelectedAnalysis(a)}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 p-3 text-left hover:bg-white transition-colors duration-150 space-y-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs font-semibold text-slate-900">
                        {a.lesson ? `Buổi ${a.lesson.lesson_no}: ${a.lesson.title}` : a.file_name}
                      </span>
                      <span className="text-[11px] text-slate-500 tabular-nums shrink-0">
                        {new Date(a.created_at).toLocaleDateString('vi-VN')}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs font-semibold tabular-nums">
                      <span className="text-blue-600">EN {Number(a.en_percent).toFixed(1)}%</span>
                      <span className="text-amber-600">VI {Number(a.vi_percent).toFixed(1)}%</span>
                    </div>
                    <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                      <div className="bg-blue-600" style={{ width: `${a.en_percent}%` }} />
                      <div className="bg-amber-500" style={{ width: `${a.vi_percent}%` }} />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="section-card space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Mic className="size-4 text-emerald-600" />
                Lịch sử Chấm Hội thoại 1-1 ({bundle.assessments.length})
              </h3>
              {onStartAssess1on1 && (
                <button
                  type="button"
                  onClick={() => onStartAssess1on1(classId)}
                  className="text-xs font-semibold text-blue-600 hover:text-blue-700"
                >
                  + Chấm 1-1 mới
                </button>
              )}
            </div>

            {bundle.assessments.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 py-8 text-center text-xs text-slate-500">
                Chưa có buổi chấm hội thoại 1-1 nào gắn với lớp này.
              </div>
            ) : (
              <div className="space-y-2.5">
                {bundle.assessments.map((ass) => (
                  <button
                    key={ass.id}
                    type="button"
                    onClick={() => setSelectedAssessment(ass)}
                    className="flex w-full items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-left hover:bg-white transition-colors duration-150"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold text-slate-900">
                        {ass.result_json?.title || `Hội thoại · ${ass.student?.full_name || 'Học viên'}`}
                      </div>
                      <div className="text-[11px] text-slate-500 tabular-nums">
                        {ass.student?.full_name} · {new Date(ass.created_at).toLocaleDateString('vi-VN')}
                      </div>
                    </div>
                    <span className="rounded-md bg-slate-900 px-2.5 py-1 text-xs font-bold text-white tabular-nums shrink-0">
                      {formatScoreValue(ass.score_total)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL: CREATE / EDIT LESSON */}
      <Modal
        open={lessonModalOpen}
        onClose={() => setLessonModalOpen(false)}
        maxWidthClass="max-w-lg"
        title={editingLesson ? `Chỉnh sửa Buổi ${editingLesson.lesson_no}` : 'Thêm Buổi học mới'}
      >
        <form onSubmit={handleSaveLesson} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">Buổi số</label>
              <input
                type="number"
                min={1}
                required
                value={lessonNo}
                onChange={(e) => setLessonNo(Number(e.target.value) || 1)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm tabular-nums focus:border-blue-600 focus:outline-none"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-semibold text-slate-700">Trạng thái</label>
              <select
                value={lessonStatus}
                onChange={(e) => setLessonStatus(e.target.value as LessonStatus)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-600 focus:outline-none"
              >
                <option value="planned">Dự kiến</option>
                <option value="completed">Đã dạy xong</option>
                <option value="cancelled">Đã hủy</option>
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">
              Chủ đề buổi học <span className="text-rose-600">*</span>
            </label>
            <input
              type="text"
              required
              value={lessonTitle}
              onChange={(e) => setLessonTitle(e.target.value)}
              placeholder="Ví dụ: IELTS Part 2 - Describe a memorable journey"
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-600 focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">
              Thời gian học (tùy chọn)
            </label>
            <input
              type="datetime-local"
              value={lessonDate}
              onChange={(e) => setLessonDate(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-600 focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">
              Ghi chú nội dung buổi dạy
            </label>
            <textarea
              rows={3}
              value={lessonNotes}
              onChange={(e) => setLessonNotes(e.target.value)}
              placeholder="Từ vựng trọng tâm, nhận xét chung cả lớp..."
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-600 focus:outline-none"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setLessonModalOpen(false)}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={savingLesson}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {savingLesson && <Loader2 className="size-3.5 animate-spin" />}
              Lưu buổi học
            </button>
          </div>
        </form>
      </Modal>

      {/* MODAL: 1-CLICK ATTENDANCE */}
      <Modal
        open={Boolean(attendanceLessonId)}
        onClose={() => setAttendanceLessonId(null)}
        maxWidthClass="max-w-2xl"
        title="Điểm danh buổi học"
        subtitle="Chọn trạng thái cho từng học viên và bấm Lưu điểm danh."
        footer={
          <>
            <button
              type="button"
              onClick={() => setAttendanceLessonId(null)}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Đóng
            </button>
            <button
              type="button"
              disabled={savingAttendance}
              onClick={handleSaveAttendance}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {savingAttendance ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
              Lưu điểm danh
            </button>
          </>
        }
      >
        {students.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">Lớp chưa có học viên để điểm danh.</p>
        ) : (
          <div className="space-y-2.5">
            {students.map((m) => {
              const cur = attendanceDraft[m.user_id] || { status: 'present' as AttendanceStatus, note: '' };
              return (
                <div
                  key={m.user_id}
                  className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between rounded-lg border border-slate-200 bg-slate-50 p-3"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-slate-900">
                      {m.profile?.full_name}
                    </div>
                    <div className="truncate text-[11px] text-slate-500">{m.profile?.email}</div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {(['present', 'late', 'absent', 'excused'] as AttendanceStatus[]).map((st) => (
                      <button
                        key={st}
                        type="button"
                        onClick={() =>
                          setAttendanceDraft((prev) => ({
                            ...prev,
                            [m.user_id]: { ...cur, status: st },
                          }))
                        }
                        className={`rounded-md border px-2.5 py-1 text-xs font-semibold transition-colors duration-150 ${
                          cur.status === st
                            ? ATTENDANCE_LABELS[st].cls
                            : 'border-slate-200 bg-white text-slate-500 hover:text-slate-900'
                        }`}
                      >
                        {ATTENDANCE_LABELS[st].label}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Modal>

      {/* MODAL: CREATE ASSIGNMENT */}
      <Modal
        open={asgModalOpen}
        onClose={() => setAsgModalOpen(false)}
        maxWidthClass="max-w-lg"
        title="Giao Bài tập Speaking cho lớp"
      >
        <form onSubmit={handleSaveAssignment} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">
              Chọn Bộ đề Speaking <span className="text-rose-600">*</span>
            </label>
            <select
              required
              value={asgSetId}
              onChange={(e) => {
                const sid = e.target.value;
                setAsgSetId(sid);
                const found = availableSets.find((s) => s.id === sid);
                if (found && !asgTitle) setAsgTitle(found.title);
              }}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-600 focus:outline-none"
            >
              <option value="">-- Chọn bộ đề --</option>
              {availableSets.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title} ({getExamTypeName(s.exam_type)} · {s.question_count || 0} câu
                  {s.is_published ? '' : ' · Riêng tư'})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">
              Tiêu đề bài tập <span className="text-rose-600">*</span>
            </label>
            <input
              type="text"
              required
              value={asgTitle}
              onChange={(e) => setAsgTitle(e.target.value)}
              placeholder="Ví dụ: BTVN Tuần 2 - IELTS Speaking Part 2"
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-600 focus:outline-none"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">Chế độ bắt buộc</label>
              <select
                value={asgMode}
                onChange={(e) => setAsgMode(e.target.value as SessionMode)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-600 focus:outline-none"
              >
                <option value="practice">Luyện tập từng câu</option>
                <option value="exam">Thi thử bấm giờ</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">Số lượt làm tối đa</label>
              <select
                value={asgMaxAttempts}
                onChange={(e) => setAsgMaxAttempts(Number(e.target.value))}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-600 focus:outline-none"
              >
                <option value={0}>Không giới hạn</option>
                <option value={1}>1 lượt duy nhất</option>
                <option value={2}>Tối đa 2 lượt</option>
                <option value={3}>Tối đa 3 lượt</option>
              </select>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">
                Hạn nộp (tùy chọn)
              </label>
              <input
                type="datetime-local"
                value={asgDueAt}
                onChange={(e) => setAsgDueAt(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-600 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">
                Band mục tiêu (1.0 – 9.0)
              </label>
              <input
                type="number"
                step="0.5"
                min={1}
                max={9}
                value={asgMinBand}
                onChange={(e) => setAsgMinBand(e.target.value)}
                placeholder="VD: 6.5"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm tabular-nums focus:border-blue-600 focus:outline-none"
              />
            </div>
          </div>

          {bundle.lessons.length > 0 && (
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">
                Gắn với Buổi học (tùy chọn)
              </label>
              <select
                value={asgLessonId}
                onChange={(e) => setAsgLessonId(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-600 focus:outline-none"
              >
                <option value="">-- Không gắn buổi cụ thể --</option>
                {bundle.lessons.map((l) => (
                  <option key={l.id} value={l.id}>
                    Buổi {l.lesson_no}: {l.title}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">
              Hướng dẫn thêm cho học viên
            </label>
            <textarea
              rows={2}
              value={asgInstructions}
              onChange={(e) => setAsgInstructions(e.target.value)}
              placeholder="Yêu cầu cụ thể hoặc lưu ý phát âm..."
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-600 focus:outline-none"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setAsgModalOpen(false)}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={savingAsg}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {savingAsg && <Loader2 className="size-3.5 animate-spin" />}
              Giao bài tập
            </button>
          </div>
        </form>
      </Modal>

      {/* MODAL: SAVED EN/VI ANALYSIS VIEWER */}
      <Modal
        open={Boolean(selectedAnalysis)}
        onClose={() => setSelectedAnalysis(null)}
        maxWidthClass="max-w-4xl"
        title={selectedAnalysis?.file_name || 'Chi tiết phân tích tiết dạy EN/VI'}
        subtitle={
          selectedAnalysis
            ? `EN ${Number(selectedAnalysis.en_percent).toFixed(1)}% · VI ${Number(selectedAnalysis.vi_percent).toFixed(1)}% · ${formatDurationReadable(selectedAnalysis.total_audio_sec || 0)}`
            : undefined
        }
      >
        {selectedAnalysis?.result_json?.timeline ? (
          <ClassroomTimelineStrip
            segments={selectedAnalysis.result_json.timeline}
            totalAudioSec={Number(selectedAnalysis.total_audio_sec || 0)}
          />
        ) : (
          <p className="text-sm text-slate-500">Chưa có dữ liệu diễn biến chi tiết.</p>
        )}
      </Modal>

      {/* MODALS: PRACTICE REVIEW & 1-1 ASSESSMENT */}
      <PracticeDetailModal
        sessionId={selectedSessionId}
        canReview
        onClose={() => setSelectedSessionId(null)}
        onReviewed={() => {
          void loadWorkspace();
          onReviewChanged?.();
        }}
      />

      <AssessmentDetailModal
        assessment={selectedAssessment}
        onClose={() => setSelectedAssessment(null)}
      />

      <StudentRecordModal
        studentId={selectedStudentRecordId}
        canEditEnrollment={currentUser.role === 'admin'}
        canReviewSubmissions
        onClose={() => setSelectedStudentRecordId(null)}
        onUpdated={() => {
          void loadWorkspace();
          onReviewChanged?.();
        }}
      />
    </div>
  );
}
