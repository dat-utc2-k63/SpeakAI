'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Award,
  BarChart3,
  BookOpen,
  ClipboardCheck,
  Inbox,
  Loader2,
  Mic,
  School,
  Users,
} from 'lucide-react';
import {
  fetchMyStudentIds,
  fetchTeacherClassAnalytics,
  fetchTeacherStats,
  fetchTeacherStudentOptions,
  type ClassSkillAnalytics,
} from '@/lib/teacher';
import { countPendingReviewsForTeacher, fetchMyManagedClasses } from '@/lib/classes';
import { getExamTypeName, hasVoiceEnrolled } from '@/lib/utils';
import {
  DistributionBarChart,
  PageHeader,
  SkillRadarChart,
} from '@/components/ui/AnalyticsCharts';
import { useToast } from '@/components/ToastProvider';
import { ClassroomAnalysisView } from '@/components/ClassroomAnalysisView';
import { TeacherQuestionSetsView } from './TeacherQuestionSetsView';
import { TeacherAssessView } from './TeacherAssessView';
import { TeacherClassesView } from './TeacherClassesView';
import { TeacherReviewInboxView } from './TeacherReviewInboxView';
import type { ClassRecord, Profile } from '@/lib/types';

interface TeacherDashboardProps {
  currentUser: Profile;
  activeTab: string;
  gpuUrl: string;
  onNavigate: (tab: string) => void;
  onPendingReviewCountChange?: (count: number) => void;
}

export function TeacherDashboard({
  currentUser,
  activeTab,
  gpuUrl,
  onNavigate,
  onPendingReviewCountChange,
}: TeacherDashboardProps) {
  const { showToast } = useToast();

  // Deep-link context when jumping from ClassWorkspace to EN/VI or 1-1 Assess
  const [prefillClassId, setPrefillClassId] = useState('');
  const [prefillLessonId, setPrefillLessonId] = useState('');
  const [pendingReviewCount, setPendingReviewCount] = useState(0);

  const refreshPendingReviewBadge = useCallback(async () => {
    const cnt = await countPendingReviewsForTeacher();
    setPendingReviewCount(cnt);
    onPendingReviewCountChange?.(cnt);
  }, [onPendingReviewCountChange]);

  useEffect(() => {
    void refreshPendingReviewBadge();
  }, [refreshPendingReviewBadge]);

  // Overview state
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [stats, setStats] = useState({
    studentCount: 0,
    assessmentCount: 0,
    questionSetsCount: 0,
    avgScore: '0.0',
  });
  const [classAnalytics, setClassAnalytics] = useState<ClassSkillAnalytics | null>(null);
  const [myClasses, setMyClasses] = useState<ClassRecord[]>([]);

  // Student dropdown options for 1-1 Assess tab
  const [assessStudentOptions, setAssessStudentOptions] = useState<Profile[]>([]);
  const [loadingAssessOptions, setLoadingAssessOptions] = useState(false);

  // ── Load Overview Data ─────────────────────────────────────────────────────
  const loadOverview = useCallback(async () => {
    setOverviewLoading(true);
    try {
      const [st, studentIds, classesList] = await Promise.all([
        fetchTeacherStats(currentUser.id),
        fetchMyStudentIds(currentUser.id),
        fetchMyManagedClasses(currentUser.id, 'teacher').catch(() => []),
      ]);
      setStats(st);
      setMyClasses(classesList);

      const analytics = await fetchTeacherClassAnalytics(currentUser.id, studentIds).catch(
        () => null,
      );
      setClassAnalytics(analytics);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Lỗi tải dữ liệu tổng quan giáo viên', 'danger');
    } finally {
      setOverviewLoading(false);
    }
  }, [currentUser.id, showToast]);

  useEffect(() => {
    if (activeTab === 'overview') {
      void loadOverview();
      void refreshPendingReviewBadge();
    }
  }, [activeTab, loadOverview, refreshPendingReviewBadge]);

  // ── Load Student Dropdown Options for 1-1 Assess Tab ───────────────────────
  useEffect(() => {
    if (activeTab !== 'assess') return;
    let cancelled = false;
    setLoadingAssessOptions(true);
    fetchTeacherStudentOptions(currentUser.id)
      .then((list) => {
        if (!cancelled) setAssessStudentOptions(list);
      })
      .catch((err) => {
        if (!cancelled) {
          showToast(err instanceof Error ? err.message : 'Lỗi tải danh sách học viên', 'danger');
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingAssessOptions(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab, currentUser.id, showToast]);

  const voiceReady = hasVoiceEnrolled(currentUser);

  if (activeTab === 'overview' && overviewLoading && myClasses.length === 0 && stats.studentCount === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-slate-500">
        <Loader2 className="mb-3 size-8 animate-spin text-blue-600" />
        <p className="text-sm">Đang tải không gian Giáo viên...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* OVERVIEW TAB */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          <PageHeader
            eyebrow="KHÔNG GIAN GIÁO VIÊN"
            title={`Xin chào, ${currentUser.full_name}`}
            subtitle="Theo dõi lớp học phụ trách, duyệt bài nộp học viên, biên soạn bộ đề và chấm hội thoại 1-1."
            pill={
              <>
                <span
                  className={`size-2 rounded-full ${voiceReady ? 'bg-emerald-500' : 'bg-amber-500'}`}
                />
                <span>{voiceReady ? 'Mẫu giọng sẵn sàng' : 'Chưa có mẫu giọng'}</span>
              </>
            }
          />

          {!voiceReady && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
              <div className="flex items-center gap-2.5">
                <AlertTriangle className="size-5 shrink-0 text-amber-600" />
                <span className="text-pretty">
                  Bạn chưa đăng ký mẫu giọng nói. Hãy đăng ký mẫu giọng để hệ thống nhận diện và tách giọng chính xác khi Chấm hội thoại 1-1.
                </span>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('profile')}
                className="rounded-lg bg-slate-900 px-3.5 py-2 font-semibold text-white hover:bg-slate-800 transition-colors duration-150"
              >
                Đăng ký mẫu giọng
              </button>
            </div>
          )}

          {/* 4 KPIs */}
          <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
            <div className="section-card card-interactive flex items-center gap-3.5 !p-4">
              <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                <School className="size-5" />
              </div>
              <div>
                <div className="text-2xl font-bold text-slate-900 tabular-nums">
                  {myClasses.length}
                </div>
                <div className="text-xs font-medium text-slate-500">Lớp đang phụ trách</div>
              </div>
            </div>

            <div className="section-card card-interactive flex items-center gap-3.5 !p-4">
              <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
                <Inbox className="size-5" />
              </div>
              <div>
                <div className="text-2xl font-bold text-amber-600 tabular-nums">
                  {pendingReviewCount}
                </div>
                <div className="text-xs font-medium text-slate-500">Bài chờ nhận xét</div>
              </div>
            </div>

            <div className="section-card card-interactive flex items-center gap-3.5 !p-4">
              <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
                <Users className="size-5" />
              </div>
              <div>
                <div className="text-2xl font-bold text-slate-900 tabular-nums">
                  {stats.studentCount}
                </div>
                <div className="text-xs font-medium text-slate-500">Học viên đang dạy</div>
              </div>
            </div>

            <div className="section-card card-interactive flex items-center gap-3.5 !p-4">
              <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                <Award className="size-5" />
              </div>
              <div>
                <div className="text-2xl font-bold text-emerald-600 tabular-nums">
                  {stats.avgScore}
                </div>
                <div className="text-xs font-medium text-slate-500">Điểm TB Hội thoại 1-1</div>
              </div>
            </div>
          </div>

          {/* 2 Selective Class Analytics Charts */}
          <div className="grid gap-6 lg:grid-cols-12">
            <div className="section-card lg:col-span-5 flex flex-col justify-between space-y-3">
              <div>
                <h3 className="flex items-center gap-2 text-base font-bold text-slate-900">
                  <BarChart3 className="size-4 text-blue-600" />
                  Năng lực 4 kỹ năng TB của lớp
                </h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  Tổng hợp từ bài chấm 1-1 và bài luyện tập của học viên trong lớp.
                </p>
              </div>
              <div className="flex justify-center py-2">
                <SkillRadarChart
                  size={255}
                  skills={[
                    { label: 'Pronunciation (P)', value: classAnalytics?.avgAccuracy ?? null },
                    { label: 'Fluency (FC)', value: classAnalytics?.avgContext ?? null },
                    { label: 'Lexical (LR)', value: classAnalytics?.avgLexical ?? null },
                    { label: 'Grammar (GRA)', value: classAnalytics?.avgGrammar ?? null },
                  ]}
                />
              </div>
            </div>

            <div className="section-card lg:col-span-7 space-y-4">
              <div>
                <h3 className="flex items-center gap-2 text-base font-bold text-slate-900">
                  <Award className="size-4 text-emerald-600" />
                  Phân bố điểm kết quả lớp học
                </h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  Phân loại các bài đã hoàn thành của học viên ({classAnalytics?.totalRecords || 0} bài).
                </p>
              </div>

              <DistributionBarChart
                emptyText="Chưa có bài chấm hoặc bài luyện tập hoàn thành nào của học viên trong lớp."
                unit=" bài"
                items={[
                  {
                    label: 'Xuất sắc (8.0 – 9.0)',
                    value: classAnalytics?.distribution.excellent || 0,
                    colorClass: 'bg-emerald-500',
                  },
                  {
                    label: 'Khá tốt (6.5 – 7.9)',
                    value: classAnalytics?.distribution.good || 0,
                    colorClass: 'bg-sky-500',
                  },
                  {
                    label: 'Trung bình đạt (5.0 – 6.4)',
                    value: classAnalytics?.distribution.fair || 0,
                    colorClass: 'bg-amber-400',
                  },
                  {
                    label: 'Cần luyện thêm (< 5.0)',
                    value: classAnalytics?.distribution.needsWork || 0,
                    colorClass: 'bg-rose-500',
                  },
                ]}
              />
            </div>
          </div>

          {/* Managed Classes Summary + Quick Shortcuts */}
          <div className="grid gap-6 lg:grid-cols-12">
            <div className="section-card lg:col-span-7 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h3 className="flex items-center gap-2 text-base font-bold text-slate-900">
                  <School className="size-5 text-blue-600" />
                  Lớp học phụ trách ({myClasses.length})
                </h3>
                <button
                  type="button"
                  onClick={() => onNavigate('classes')}
                  className="text-xs font-semibold text-blue-600 hover:text-blue-700"
                >
                  Vào Lớp học của tôi →
                </button>
              </div>

              {pendingReviewCount > 0 && (
                <button
                  type="button"
                  onClick={() => onNavigate('review')}
                  className="flex w-full items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-left text-xs hover:bg-amber-100/70 transition-colors duration-150"
                >
                  <div className="flex items-center gap-2.5">
                    <Inbox className="size-4 shrink-0 text-amber-700" />
                    <span className="font-semibold text-amber-900">
                      Có <span className="tabular-nums">{pendingReviewCount}</span> bài nộp đang chờ bạn nhận xét
                    </span>
                  </div>
                  <span className="shrink-0 font-semibold text-amber-800">Duyệt ngay →</span>
                </button>
              )}

              {myClasses.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
                  Hiện chưa có lớp học nào được phân công cho bạn.
                </div>
              ) : (
                <div className="space-y-2.5">
                  {myClasses.slice(0, 5).map((cls) => (
                    <button
                      key={cls.id}
                      type="button"
                      onClick={() => onNavigate('classes')}
                      className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-left hover:border-blue-300 hover:bg-white transition-colors duration-150"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-semibold text-slate-900">
                            {cls.name}
                          </span>
                          <span className="rounded border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[10px] text-slate-500">
                            {cls.code}
                          </span>
                        </div>
                        <div className="mt-0.5 text-xs text-slate-500">
                          {getExamTypeName(cls.course_type)}
                          {cls.student_count != null ? ` · ${cls.student_count} học viên` : ''}
                          {cls.schedule_text ? ` · ${cls.schedule_text}` : ''}
                        </div>
                      </div>
                      <span className="shrink-0 text-xs font-semibold text-blue-600">Mở lớp →</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="section-card lg:col-span-5 space-y-3">
              <h3 className="flex items-center gap-2 border-b border-slate-100 pb-3 text-base font-semibold text-slate-900">
                <ClipboardCheck className="size-4 text-blue-600" />
                Thao tác nhanh
              </h3>
              <button
                type="button"
                onClick={() => onNavigate('questionsets')}
                className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-slate-50 p-4 text-left hover:border-blue-300 hover:bg-white transition-colors duration-150"
              >
                <div>
                  <div className="text-sm font-semibold text-slate-900">Biên soạn &amp; Mở Bộ đề</div>
                  <div className="text-xs text-slate-500">
                    Quản lý {stats.questionSetsCount} bộ đề Speaking của bạn
                  </div>
                </div>
                <BookOpen className="size-5 text-blue-600" />
              </button>

              <button
                type="button"
                onClick={() => onNavigate('assess')}
                className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-slate-50 p-4 text-left hover:border-blue-300 hover:bg-white transition-colors duration-150"
              >
                <div>
                  <div className="text-sm font-semibold text-slate-900">Chấm Hội thoại 1-1</div>
                  <div className="text-xs text-slate-500">
                    Tách giọng Giáo viên – Học viên và chấm Speaking tự động
                  </div>
                </div>
                <ClipboardCheck className="size-5 text-blue-600" />
              </button>

              <button
                type="button"
                onClick={() => onNavigate('classroom')}
                className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-slate-50 p-4 text-left hover:border-blue-300 hover:bg-white transition-colors duration-150"
              >
                <div>
                  <div className="text-sm font-semibold text-slate-900">Phân tích Tiết dạy EN/VI</div>
                  <div className="text-xs text-slate-500">
                    Đo tỷ lệ Tiếng Anh / Tiếng Việt trong buổi học
                  </div>
                </div>
                <Mic className="size-5 text-emerald-600" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* QUESTION SETS TAB */}
      {activeTab === 'questionsets' && (
        <TeacherQuestionSetsView currentUser={currentUser} />
      )}

      {/* MY CLASSES WORKSPACE TAB */}
      {activeTab === 'classes' && (
        <TeacherClassesView
          currentUser={currentUser}
          onStartClassroomAnalysis={(cid, lid) => {
            setPrefillClassId(cid);
            setPrefillLessonId(lid || '');
            onNavigate('classroom');
          }}
          onStartAssess1on1={(cid, lid) => {
            setPrefillClassId(cid);
            setPrefillLessonId(lid || '');
            onNavigate('assess');
          }}
          onReviewChanged={() => void refreshPendingReviewBadge()}
        />
      )}

      {/* REVIEW INBOX TAB */}
      {activeTab === 'review' && (
        <TeacherReviewInboxView
          currentUser={currentUser}
          onReviewedChange={() => void refreshPendingReviewBadge()}
        />
      )}

      {/* MERGED ASSESS & HISTORY TAB */}
      {activeTab === 'assess' &&
        (loadingAssessOptions && assessStudentOptions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-500">
            <Loader2 className="mb-3 size-8 animate-spin text-blue-600" />
            <p className="text-sm">Đang tải danh sách học viên lớp phụ trách...</p>
          </div>
        ) : (
          <TeacherAssessView
            currentUser={currentUser}
            students={assessStudentOptions}
            gpuUrl={gpuUrl}
            initialClassId={prefillClassId}
            initialLessonId={prefillLessonId}
            onNavigateProfile={() => onNavigate('profile')}
          />
        ))}

      {/* CLASSROOM EN/VI TAB */}
      {activeTab === 'classroom' && (
        <ClassroomAnalysisView
          mode="teacher_self"
          lockedProfile={currentUser}
          gpuUrl={gpuUrl}
          initialClassId={prefillClassId}
          initialLessonId={prefillLessonId}
          onNavigateProfile={() => onNavigate('profile')}
        />
      )}
    </div>
  );
}
