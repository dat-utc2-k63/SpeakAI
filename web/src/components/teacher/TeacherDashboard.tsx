'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Award,
  BarChart3,
  BookOpen,
  CheckCircle2,
  ClipboardCheck,
  GraduationCap,
  Loader2,
  Mic,
  Search,
  Users,
} from 'lucide-react';
import {
  fetchMyStudentIds,
  fetchMyStudentsPage,
  fetchStudentAssessmentsForTeacherPage,
  fetchStudentPracticeSessionsForTeacherPage,
  fetchTeacherClassAnalytics,
  fetchTeacherStats,
  fetchTeacherStudentOptions,
  type ClassSkillAnalytics,
} from '@/lib/teacher';
import { formatScoreValue, getAvatarUrl, hasVoiceEnrolled, scoreBadgeBgClass } from '@/lib/utils';
import { Modal } from '@/components/ui/Modal';
import { Pagination } from '@/components/ui/Pagination';
import {
  DistributionBarChart,
  PageHeader,
  SkillRadarChart,
} from '@/components/ui/AnalyticsCharts';
import { useToast } from '@/components/ToastProvider';
import { AssessmentCard, AssessmentDetailModal } from '@/components/AssessmentDetailModal';
import { PracticeDetailModal } from '@/components/PracticeDetailModal';
import { ClassroomAnalysisView } from '@/components/ClassroomAnalysisView';
import { TeacherQuestionSetsView } from './TeacherQuestionSetsView';
import { TeacherAssessView } from './TeacherAssessView';
import type { Assessment, PracticeSession, Profile } from '@/lib/types';

interface TeacherDashboardProps {
  currentUser: Profile;
  activeTab: string;
  gpuUrl: string;
  onNavigate: (tab: string) => void;
}

const STUDENT_PAGE_SIZE = 10;
const DETAIL_PAGE_SIZE = 6;

export function TeacherDashboard({
  currentUser,
  activeTab,
  gpuUrl,
  onNavigate,
}: TeacherDashboardProps) {
  const { showToast } = useToast();

  // Overview state
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [stats, setStats] = useState({
    studentCount: 0,
    assessmentCount: 0,
    questionSetsCount: 0,
    avgScore: '0.0',
  });
  const [classAnalytics, setClassAnalytics] = useState<ClassSkillAnalytics | null>(null);
  const [previewStudents, setPreviewStudents] = useState<Profile[]>([]);

  // My Students Table state (server-paginated)
  const [studentSearch, setStudentSearch] = useState('');
  const [debouncedStudentSearch, setDebouncedStudentSearch] = useState('');
  const [studentVoiceFilter, setStudentVoiceFilter] = useState<'' | 'ready' | 'missing'>('');
  const [studentPage, setStudentPage] = useState(1);
  const [studentsData, setStudentsData] = useState<{ items: Profile[]; total: number }>({
    items: [],
    total: 0,
  });
  const [studentsLoading, setStudentsLoading] = useState(false);
  const studentsReqSeq = useRef(0);

  // Student dropdown options for 1-1 Assess tab
  const [assessStudentOptions, setAssessStudentOptions] = useState<Profile[]>([]);
  const [loadingAssessOptions, setLoadingAssessOptions] = useState(false);

  // Student Detail Modal (Merged Practice/Exam + 1-1 Assessments, paginated)
  const [detailStudent, setDetailStudent] = useState<Profile | null>(null);
  const [detailTab, setDetailTab] = useState<'practice' | 'assess'>('practice');
  const [detailModeFilter, setDetailModeFilter] = useState<'all' | 'practice' | 'exam'>('all');
  const [detailPracticePage, setDetailPracticePage] = useState(1);
  const [detailPracticeData, setDetailPracticeData] = useState<{
    items: PracticeSession[];
    total: number;
  }>({ items: [], total: 0 });
  const [detailAssessPage, setDetailAssessPage] = useState(1);
  const [detailAssessData, setDetailAssessData] = useState<{
    items: Assessment[];
    total: number;
  }>({ items: [], total: 0 });
  const [detailPracticeLoading, setDetailPracticeLoading] = useState(false);
  const [detailAssessLoading, setDetailAssessLoading] = useState(false);
  const detailPracticeSeq = useRef(0);
  const detailAssessSeq = useRef(0);

  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [selectedAssessment, setSelectedAssessment] = useState<Assessment | null>(null);

  // ── Load Overview Data ─────────────────────────────────────────────────────
  const loadOverview = useCallback(async () => {
    setOverviewLoading(true);
    try {
      const [st, studentIds, previewRes] = await Promise.all([
        fetchTeacherStats(currentUser.id),
        fetchMyStudentIds(currentUser.id),
        fetchMyStudentsPage(currentUser.id, { page: 1, pageSize: 6 }),
      ]);
      setStats(st);
      setPreviewStudents(previewRes.items);

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
      loadOverview();
    }
  }, [activeTab, loadOverview]);

  // ── Load My Students Table (Paginated) ─────────────────────────────────────
  useEffect(() => {
    const t = window.setTimeout(() => {
      setDebouncedStudentSearch(studentSearch);
      setStudentPage(1);
    }, 300);
    return () => window.clearTimeout(t);
  }, [studentSearch]);

  const loadStudentsPage = useCallback(async () => {
    const reqId = ++studentsReqSeq.current;
    setStudentsLoading(true);
    try {
      const res = await fetchMyStudentsPage(currentUser.id, {
        page: studentPage,
        pageSize: STUDENT_PAGE_SIZE,
        search: debouncedStudentSearch,
        voiceFilter: studentVoiceFilter,
      });
      if (reqId !== studentsReqSeq.current) return;
      if (res.items.length === 0 && studentPage > 1 && res.total > 0) {
        setStudentPage(studentPage - 1);
        return;
      }
      setStudentsData({ items: res.items, total: res.total });
    } catch (err) {
      if (reqId === studentsReqSeq.current) {
        showToast(err instanceof Error ? err.message : 'Lỗi tải danh sách học viên', 'danger');
      }
    } finally {
      if (reqId === studentsReqSeq.current) setStudentsLoading(false);
    }
  }, [currentUser.id, studentPage, debouncedStudentSearch, studentVoiceFilter, showToast]);

  useEffect(() => {
    if (activeTab === 'students') {
      loadStudentsPage();
    }
  }, [activeTab, loadStudentsPage]);

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

  // ── Student Detail Modal Paginated Loaders ─────────────────────────────────
  const loadStudentPracticeModalPage = useCallback(
    async (studentId: string, page: number, mode: 'all' | 'practice' | 'exam') => {
      const seq = ++detailPracticeSeq.current;
      setDetailPracticeLoading(true);
      try {
        const res = await fetchStudentPracticeSessionsForTeacherPage(studentId, {
          page,
          pageSize: DETAIL_PAGE_SIZE,
          mode,
        });
        if (seq !== detailPracticeSeq.current) return;
        if (res.items.length === 0 && page > 1 && res.total > 0) {
          setDetailPracticePage(page - 1);
          return;
        }
        setDetailPracticeData({ items: res.items, total: res.total });
      } catch (err) {
        if (seq === detailPracticeSeq.current) {
          showToast(err instanceof Error ? err.message : 'Lỗi tải lịch sử luyện tập', 'danger');
        }
      } finally {
        if (seq === detailPracticeSeq.current) setDetailPracticeLoading(false);
      }
    },
    [showToast],
  );

  const loadStudentAssessModalPage = useCallback(
    async (studentId: string, page: number) => {
      const seq = ++detailAssessSeq.current;
      setDetailAssessLoading(true);
      try {
        const res = await fetchStudentAssessmentsForTeacherPage(studentId, {
          page,
          pageSize: DETAIL_PAGE_SIZE,
        });
        if (seq !== detailAssessSeq.current) return;
        if (res.items.length === 0 && page > 1 && res.total > 0) {
          setDetailAssessPage(page - 1);
          return;
        }
        setDetailAssessData({ items: res.items, total: res.total });
      } catch (err) {
        if (seq === detailAssessSeq.current) {
          showToast(err instanceof Error ? err.message : 'Lỗi tải đánh giá 1-1', 'danger');
        }
      } finally {
        if (seq === detailAssessSeq.current) setDetailAssessLoading(false);
      }
    },
    [showToast],
  );

  const handleOpenStudentDetail = (student: Profile) => {
    setDetailStudent(student);
    setDetailTab('practice');
    setDetailModeFilter('all');
    setDetailPracticePage(1);
    setDetailAssessPage(1);
    setDetailPracticeData({ items: [], total: 0 });
    setDetailAssessData({ items: [], total: 0 });
  };

  useEffect(() => {
    if (!detailStudent) return;
    loadStudentPracticeModalPage(detailStudent.id, detailPracticePage, detailModeFilter);
  }, [detailStudent, detailPracticePage, detailModeFilter, loadStudentPracticeModalPage]);

  useEffect(() => {
    if (!detailStudent) return;
    loadStudentAssessModalPage(detailStudent.id, detailAssessPage);
  }, [detailStudent, detailAssessPage, loadStudentAssessModalPage]);

  const voiceReady = hasVoiceEnrolled(currentUser);

  if (activeTab === 'overview' && overviewLoading && previewStudents.length === 0 && stats.studentCount === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-slate-500">
        <Loader2 className="mb-3 h-8 w-8 animate-spin text-blue-600" />
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
            subtitle="Theo dõi năng lực lớp học, biên soạn bộ đề, chấm hội thoại 1-1 và phân tích tiết dạy."
            pill={
              <>
                <span
                  className={`h-2 w-2 rounded-full ${voiceReady ? 'bg-emerald-500' : 'bg-amber-500'}`}
                />
                <span>{voiceReady ? 'Mẫu giọng sẵn sàng' : 'Chưa có mẫu giọng'}</span>
              </>
            }
          />

          {!voiceReady && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50/90 p-4 text-xs text-amber-900">
              <div className="flex items-center gap-2.5">
                <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" />
                <span>
                  Bạn chưa đăng ký mẫu giọng nói. Hãy đăng ký ngay để sử dụng tính năng Chấm hội thoại 1-1 và Phân tích lớp học (EN/VI).
                </span>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('profile')}
                className="rounded-xl bg-amber-500 px-3.5 py-2 font-bold text-white shadow-sm hover:bg-amber-600 transition"
              >
                Đăng ký mẫu giọng
              </button>
            </div>
          )}

          {/* 4 KPIs */}
          <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
            <div className="section-card card-interactive flex items-center gap-3.5 !p-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-sky-50 text-sky-600">
                <Users className="h-5 w-5" />
              </div>
              <div>
                <div className="text-2xl font-extrabold text-slate-900 tabular-nums">
                  {stats.studentCount}
                </div>
                <div className="text-xs font-medium text-slate-500">Học viên lớp tôi</div>
              </div>
            </div>

            <div className="section-card card-interactive flex items-center gap-3.5 !p-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
                <BookOpen className="h-5 w-5" />
              </div>
              <div>
                <div className="text-2xl font-extrabold text-slate-900 tabular-nums">
                  {stats.questionSetsCount}
                </div>
                <div className="text-xs font-medium text-slate-500">Bộ đề của tôi</div>
              </div>
            </div>

            <div className="section-card card-interactive flex items-center gap-3.5 !p-4">
              <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
                <ClipboardCheck className="size-5" />
              </div>
              <div>
                <div className="text-2xl font-extrabold text-slate-900 tabular-nums">
                  {stats.assessmentCount}
                </div>
                <div className="text-xs font-medium text-slate-500">Bài chấm 1-1</div>
              </div>
            </div>

            <div className="section-card card-interactive flex items-center gap-3.5 !p-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
                <Award className="h-5 w-5" />
              </div>
              <div>
                <div className="text-2xl font-extrabold text-emerald-600 tabular-nums">
                  {stats.avgScore}
                </div>
                <div className="text-xs font-medium text-slate-500">Điểm TB 1-1</div>
              </div>
            </div>
          </div>

          {/* 2 Selective Class Analytics Charts */}
          <div className="grid gap-6 lg:grid-cols-12">
            <div className="section-card lg:col-span-5 flex flex-col justify-between space-y-3">
              <div>
                <h3 className="flex items-center gap-2 text-base font-bold text-slate-900">
                  <BarChart3 className="h-4 w-4 text-blue-600" />
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
                  <Award className="h-4 w-4 text-emerald-600" />
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

          {/* Class Preview + Shortcuts */}
          <div className="grid gap-6 lg:grid-cols-12">
            <div className="section-card lg:col-span-7 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h3 className="flex items-center gap-2 text-base font-bold text-slate-900">
                  <GraduationCap className="h-5 w-5 text-sky-600" />
                  Học viên Lớp phụ trách ({stats.studentCount})
                </h3>
                <button
                  type="button"
                  onClick={() => onNavigate('students')}
                  className="text-xs font-semibold text-blue-600 hover:text-blue-500"
                >
                  Xem toàn bộ →
                </button>
              </div>

              {previewStudents.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
                  Hiện chưa có Học viên nào được gán vào lớp của bạn.
                </div>
              ) : (
                <div className="space-y-2.5">
                  {previewStudents.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => handleOpenStudentDetail(s)}
                      className="flex w-full items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50/75 p-3 text-left hover:border-blue-300 hover:bg-white transition"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <img
                          src={getAvatarUrl(s.full_name, 72)}
                          alt={s.full_name}
                          className="h-9 w-9 rounded-full border border-slate-200"
                        />
                        <div className="min-w-0">
                          <div className="truncate text-sm font-bold text-slate-900">
                            {s.full_name}
                          </div>
                          <div className="truncate text-xs text-slate-500">{s.email}</div>
                        </div>
                      </div>
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                          hasVoiceEnrolled(s)
                            ? 'border border-emerald-200 bg-emerald-50 text-emerald-700'
                            : 'border border-slate-200 bg-white text-slate-500'
                        }`}
                      >
                        {hasVoiceEnrolled(s) ? 'Có mẫu giọng' : 'Chưa có giọng'}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="section-card lg:col-span-5 space-y-3">
              <h3 className="flex items-center gap-2 border-b border-slate-100 pb-3 text-base font-semibold text-slate-900">
                <ClipboardCheck className="size-4 text-blue-600" />
                Lối tắt Nghiệp vụ
              </h3>
              <button
                type="button"
                onClick={() => onNavigate('questionsets')}
                className="flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-slate-50/75 p-4 text-left hover:border-blue-300 hover:bg-white transition"
              >
                <div>
                  <div className="text-sm font-bold text-slate-900">Biên soạn &amp; Mở Bộ đề</div>
                  <div className="text-xs text-slate-500">Quản lý đề Speaking cho học viên</div>
                </div>
                <BookOpen className="h-5 w-5 text-blue-600" />
              </button>

              <button
                type="button"
                onClick={() => onNavigate('assess')}
                className="flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-slate-50/75 p-4 text-left hover:border-sky-300 hover:bg-white transition"
              >
                <div>
                  <div className="text-sm font-bold text-slate-900">Chấm &amp; Đánh giá Hội thoại 1-1</div>
                  <div className="text-xs text-slate-500">Tách giọng Giáo viên – Học viên bằng AI</div>
                </div>
                <ClipboardCheck className="h-5 w-5 text-sky-600" />
              </button>

              <button
                type="button"
                onClick={() => onNavigate('classroom')}
                className="flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-slate-50/75 p-4 text-left hover:border-emerald-300 hover:bg-white transition"
              >
                <div>
                  <div className="text-sm font-bold text-slate-900">Phân tích Ngôn ngữ Lớp học (EN/VI)</div>
                  <div className="text-xs text-slate-500">Đo tỷ lệ Tiếng Anh / Tiếng Việt tiết dạy</div>
                </div>
                <Mic className="h-5 w-5 text-emerald-600" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MY STUDENTS TAB — TABLE + PAGINATION */}
      {activeTab === 'students' && (
        <div className="space-y-5">
          <PageHeader
            eyebrow="QUẢN LÝ LỚP HỌC"
            title="Học viên Lớp của tôi"
            subtitle="Theo dõi danh sách học viên trong lớp và mở hồ sơ để xem lịch sử luyện tập, duyệt bài và chấm 1-1."
            pill={<span>{studentsData.total} học viên</span>}
          />

          <div className="section-card grid gap-3 sm:grid-cols-3">
            <div className="relative sm:col-span-2">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={studentSearch}
                onChange={(e) => setStudentSearch(e.target.value)}
                placeholder="Tìm tên hoặc email học viên..."
                className="w-full rounded-xl border border-slate-200 bg-slate-50/80 py-2.5 pl-9 pr-3 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none"
              />
            </div>

            <select
              value={studentVoiceFilter}
              onChange={(e) => {
                setStudentVoiceFilter(e.target.value as '' | 'ready' | 'missing');
                setStudentPage(1);
              }}
              className="rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2.5 text-sm text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none"
            >
              <option value="">Mọi mẫu giọng</option>
              <option value="ready">Đã có mẫu giọng</option>
              <option value="missing">Chưa có mẫu giọng</option>
            </select>
          </div>

          {studentsLoading && studentsData.items.length === 0 ? (
            <div className="section-card flex items-center justify-center py-12 text-slate-500">
              <Loader2 className="mr-2 h-5 w-5 animate-spin text-blue-600" />
              <span className="text-sm">Đang tải danh sách học viên...</span>
            </div>
          ) : (
            <>
              {/* DESKTOP TABLE (md+) */}
              <div className="section-card !p-0 overflow-hidden hidden md:block">
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
                    <thead className="bg-slate-50 text-slate-500">
                      <tr>
                        <th className="px-4 py-3 font-semibold">Học viên</th>
                        <th className="px-4 py-3 font-semibold">Số điện thoại</th>
                        <th className="px-4 py-3 font-semibold">Mẫu giọng nói</th>
                        <th className="px-4 py-3 font-semibold">Ngày tham gia</th>
                        <th className="px-4 py-3 text-right font-semibold">Thao tác</th>
                      </tr>
                    </thead>
                    <tbody
                      className={`divide-y divide-slate-100 bg-white ${studentsLoading ? 'opacity-60' : ''}`}
                    >
                      {studentsData.items.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                            Không tìm thấy học viên nào trong lớp phụ trách.
                          </td>
                        </tr>
                      ) : (
                        studentsData.items.map((s) => {
                          const voiceOk = hasVoiceEnrolled(s);
                          return (
                            <tr key={s.id} className="hover:bg-slate-50/80">
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-3">
                                  <img
                                    src={getAvatarUrl(s.full_name, 72)}
                                    alt={s.full_name}
                                    className="h-9 w-9 rounded-full border border-slate-200 shrink-0"
                                  />
                                  <div className="min-w-0">
                                    <div className="truncate font-bold text-slate-900">
                                      {s.full_name}
                                    </div>
                                    <div className="truncate text-[11px] text-slate-500">
                                      {s.email}
                                    </div>
                                  </div>
                                </div>
                              </td>
                              <td className="px-4 py-3 text-slate-600 tabular-nums">
                                {s.phone || <span className="text-slate-400">Chưa cập nhật</span>}
                              </td>
                              <td className="px-4 py-3">
                                <span
                                  className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${
                                    voiceOk
                                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                      : 'border-slate-200 bg-slate-50 text-slate-500'
                                  }`}
                                >
                                  <Mic className="h-3 w-3" />
                                  {voiceOk ? 'Đã có giọng' : 'Chưa có giọng'}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-slate-500 tabular-nums">
                                {new Date(s.created_at).toLocaleDateString('vi-VN')}
                              </td>
                              <td className="px-4 py-3 text-right">
                                <button
                                  type="button"
                                  onClick={() => handleOpenStudentDetail(s)}
                                  className="inline-flex items-center gap-1 rounded-xl border border-blue-200 bg-blue-50 px-3 py-1.5 text-[11px] font-semibold text-blue-700 hover:bg-blue-100 transition"
                                >
                                  Xem hồ sơ →
                                </button>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* MOBILE CARDS (< md) */}
              <div className="space-y-3 md:hidden">
                {studentsData.items.length === 0 ? (
                  <div className="section-card py-10 text-center text-sm text-slate-500">
                    Không tìm thấy học viên nào trong lớp phụ trách.
                  </div>
                ) : (
                  studentsData.items.map((s) => {
                    const voiceOk = hasVoiceEnrolled(s);
                    return (
                      <div key={s.id} className="section-card space-y-3 !p-4">
                        <div className="flex items-center gap-3">
                          <img
                            src={getAvatarUrl(s.full_name, 80)}
                            alt={s.full_name}
                            className="h-11 w-11 rounded-full border border-slate-200"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-bold text-slate-900">
                              {s.full_name}
                            </div>
                            <div className="truncate text-xs text-slate-500">{s.email}</div>
                            {s.phone && (
                              <div className="text-[11px] text-slate-400">SĐT: {s.phone}</div>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center justify-between border-t border-slate-100 pt-2.5 text-xs">
                          <span
                            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 font-semibold ${
                              voiceOk
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                : 'border-slate-200 bg-slate-50 text-slate-500'
                            }`}
                          >
                            <Mic className="h-3 w-3" />
                            {voiceOk ? 'Đã có giọng' : 'Chưa có giọng'}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleOpenStudentDetail(s)}
                            className="rounded-xl bg-blue-50 px-3 py-1.5 font-semibold text-blue-700"
                          >
                            Xem hồ sơ →
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              <Pagination
                page={studentPage}
                pageSize={STUDENT_PAGE_SIZE}
                totalCount={studentsData.total}
                onPageChange={setStudentPage}
                disabled={studentsLoading}
                itemLabel="học viên"
              />
            </>
          )}
        </div>
      )}

      {/* QUESTION SETS TAB */}
      {activeTab === 'questionsets' && (
        <TeacherQuestionSetsView currentUser={currentUser} />
      )}

      {/* MERGED ASSESS & HISTORY TAB */}
      {activeTab === 'assess' &&
        (loadingAssessOptions && assessStudentOptions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-500">
            <Loader2 className="mb-3 h-8 w-8 animate-spin text-blue-600" />
            <p className="text-sm">Đang tải danh sách học viên lớp phụ trách...</p>
          </div>
        ) : (
          <TeacherAssessView
            currentUser={currentUser}
            students={assessStudentOptions}
            gpuUrl={gpuUrl}
            onNavigateProfile={() => onNavigate('profile')}
          />
        ))}

      {/* CLASSROOM EN/VI TAB */}
      {activeTab === 'classroom' && (
        <ClassroomAnalysisView
          mode="teacher_self"
          lockedProfile={currentUser}
          gpuUrl={gpuUrl}
          onNavigateProfile={() => onNavigate('profile')}
        />
      )}

      {/* MODAL: STUDENT CONSOLIDATED DETAIL (Practice/Exam + 1-1 Assessments, PAGINATED) */}
      <Modal
        open={Boolean(detailStudent)}
        onClose={() => setDetailStudent(null)}
        maxWidthClass="max-w-4xl"
        title={`Hồ sơ Học viên · ${detailStudent?.full_name || ''}`}
        subtitle={detailStudent?.email}
      >
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex rounded-2xl border border-slate-200 bg-slate-100/90 p-1">
              <button
                type="button"
                onClick={() => setDetailTab('practice')}
                className={`rounded-xl px-4 py-1.5 text-xs font-semibold transition ${
                  detailTab === 'practice'
                    ? 'bg-white text-blue-700 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Luyện tập &amp; Thi thử ({detailPracticeData.total})
              </button>
              <button
                type="button"
                onClick={() => setDetailTab('assess')}
                className={`rounded-xl px-4 py-1.5 text-xs font-semibold transition ${
                  detailTab === 'assess'
                    ? 'bg-white text-blue-700 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Đánh giá 1-1 ({detailAssessData.total})
              </button>
            </div>

            {detailTab === 'practice' && (
              <select
                value={detailModeFilter}
                onChange={(e) => {
                  setDetailModeFilter(e.target.value as 'all' | 'practice' | 'exam');
                  setDetailPracticePage(1);
                }}
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none"
              >
                <option value="all">Tất cả hình thức</option>
                <option value="practice">Chỉ Luyện tập</option>
                <option value="exam">Chỉ Thi thử</option>
              </select>
            )}
          </div>

          <div key={detailTab} className="space-y-3">
            {detailTab === 'practice' ? (
              detailPracticeLoading && detailPracticeData.items.length === 0 ? (
                <div className="flex justify-center py-10">
                  <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
                </div>
              ) : detailPracticeData.items.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-500">
                  Học viên chưa có bài luyện tập hoặc thi thử nào.
                </div>
              ) : (
                <>
                  <div className={`space-y-2.5 ${detailPracticeLoading ? 'opacity-60' : ''}`}>
                    {detailPracticeData.items.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => setSelectedSessionId(s.id)}
                        className="flex w-full items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50/75 p-3.5 text-left hover:border-blue-300 hover:bg-white transition"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-bold text-slate-900">
                              {s.question_set?.title || 'Bộ đề Speaking'}
                            </span>
                            <span
                              className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ${
                                s.mode === 'exam'
                                  ? 'border border-amber-200 bg-amber-50 text-amber-800'
                                  : 'border border-blue-200 bg-blue-50 text-blue-700'
                              }`}
                            >
                              {s.mode === 'exam' ? s.exam_band || 'Thi thử' : 'Luyện tập'}
                            </span>
                            {s.status === 'reviewed' && (
                              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                                <CheckCircle2 className="h-3 w-3" /> Đã duyệt
                              </span>
                            )}
                          </div>
                          <div className="mt-1 text-xs text-slate-500">
                            {new Date(s.completed_at || s.started_at).toLocaleString('vi-VN')}
                            {s.teacher_comment ? ` · Nhận xét: "${s.teacher_comment}"` : ''}
                          </div>
                        </div>

                        <div
                          className={`rounded-xl border px-3 py-1.5 text-sm font-extrabold tabular-nums ${scoreBadgeBgClass(s.score_total)}`}
                        >
                          {formatScoreValue(s.score_total)}
                        </div>
                      </button>
                    ))}
                  </div>
                  <Pagination
                    compact
                    page={detailPracticePage}
                    pageSize={DETAIL_PAGE_SIZE}
                    totalCount={detailPracticeData.total}
                    onPageChange={setDetailPracticePage}
                    disabled={detailPracticeLoading}
                    itemLabel="bài làm"
                  />
                </>
              )
            ) : detailAssessLoading && detailAssessData.items.length === 0 ? (
              <div className="flex justify-center py-10">
                <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
              </div>
            ) : detailAssessData.items.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-500">
                Học viên chưa có buổi đánh giá hội thoại 1-1 nào.
              </div>
            ) : (
              <>
                <div
                  className={`grid gap-3 md:grid-cols-2 ${detailAssessLoading ? 'opacity-60' : ''}`}
                >
                  {detailAssessData.items.map((a) => (
                    <AssessmentCard key={a.id} assessment={a} onSelect={setSelectedAssessment} />
                  ))}
                </div>
                <Pagination
                  compact
                  page={detailAssessPage}
                  pageSize={DETAIL_PAGE_SIZE}
                  totalCount={detailAssessData.total}
                  onPageChange={setDetailAssessPage}
                  disabled={detailAssessLoading}
                  itemLabel="buổi chấm"
                />
              </>
            )}
          </div>
        </div>
      </Modal>

      <PracticeDetailModal
        sessionId={selectedSessionId}
        canReview
        onClose={() => setSelectedSessionId(null)}
        onReviewed={(updated) => {
          setDetailPracticeData((prev) => ({
            ...prev,
            items: prev.items.map((item) =>
              item.id === updated.id ? { ...item, ...updated } : item,
            ),
          }));
        }}
      />

      <AssessmentDetailModal
        assessment={selectedAssessment}
        onClose={() => setSelectedAssessment(null)}
      />
    </div>
  );
}
