'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  BookOpen,
  CheckCircle2,
  ClipboardCheck,
  Copy,
  Eye,
  EyeOff,
  FileEdit,
  FileText,
  GraduationCap,
  KeyRound,
  Link2,
  Loader2,
  Lock,
  MessageSquareText,
  Mic,
  Pencil,
  PieChart,
  Presentation,
  RefreshCw,
  School,
  Search,
  Server,
  ShieldCheck,
  Trash2,
  Unlock,
  UserCheck,
  UserPlus,
  Users,
} from 'lucide-react';
import {
  adminCleanupDraftAssessments,
  adminDeleteAssessment,
  adminUpdateAssessment,
  deletePracticeSessionByAdmin,
  fetchAdminAssessmentsPage,
  fetchAdminOverviewStats,
  fetchAdminPracticeSessionsPage,
  fetchAdminQuestionSetsPage,
  fetchAdminTeacherDirectory,
  fetchAdminUsersPage,
  type AdminOverviewStats,
} from '@/lib/admin';
import {
  adminCreateUser,
  adminResetUserPassword,
  adminUpdateUser,
  deleteUserByAdmin,
  updateGlobalGpuUrl,
} from '@/lib/auth';
import { setRuntimeGpuUrl } from '@/lib/aiEval';
import { deleteQuestionSet, togglePublishSet } from '@/lib/questionSets';
import {
  formatScoreValue,
  getAvatarUrl,
  getExamTypeName,
  getLevelLabel,
  hasVoiceEnrolled,
  scoreBadgeBgClass,
} from '@/lib/utils';
import { Modal } from '@/components/ui/Modal';
import { Pagination } from '@/components/ui/Pagination';
import {
  DistributionBarChart,
  PageHeader,
  RatioDonutChart,
} from '@/components/ui/AnalyticsCharts';
import { useToast } from '@/components/ToastProvider';
import { AssessmentDetailModal } from '@/components/AssessmentDetailModal';
import { PracticeDetailModal } from '@/components/PracticeDetailModal';
import { ClassroomAnalysisView } from '@/components/ClassroomAnalysisView';
import { StudentRecordModal } from '@/components/StudentRecordModal';
import { AdminClassesView } from './AdminClassesView';
import type {
  AccountStatus,
  Assessment,
  GpuHealthData,
  PracticeSession,
  Profile,
  QuestionLevel,
  QuestionSet,
  UserRole,
} from '@/lib/types';

interface AdminDashboardProps {
  currentUser: Profile;
  activeTab: string;
  gpuUrl: string;
  onGpuUrlChange: (url: string) => void;
  onNavigate: (tab: string) => void;
  onPendingCountChange?: (count: number) => void;
}

const USERS_PAGE_SIZE = 10;
const SETS_PAGE_SIZE = 8;
const SESSIONS_PAGE_SIZE = 10;
const ASSESSMENTS_PAGE_SIZE = 10;

export function AdminDashboard({
  currentUser,
  activeTab,
  gpuUrl,
  onGpuUrlChange,
  onNavigate,
  onPendingCountChange,
}: AdminDashboardProps) {
  const { showToast } = useToast();

  // Shared overview & lightweight teacher directory
  const [overviewStats, setOverviewStats] = useState<AdminOverviewStats | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [teacherDirectory, setTeacherDirectory] = useState<Profile[]>([]);
  const [classroomTeachers, setClassroomTeachers] = useState<Profile[]>([]);
  const [classroomLoading, setClassroomLoading] = useState(false);
  const [monitoringSubTab, setMonitoringSubTab] = useState<'assessments' | 'classroom'>('assessments');

  // Health monitor (used on Overview)
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [healthData, setHealthData] = useState<GpuHealthData | null>(null);

  // GPU URL Modal
  const [gpuModalOpen, setGpuModalOpen] = useState(false);
  const [gpuUrlDraft, setGpuUrlDraft] = useState(gpuUrl);
  const [savingGpuUrl, setSavingGpuUrl] = useState(false);

  // TAB: USERS (paginated)
  const [userSearch, setUserSearch] = useState('');
  const [debouncedUserSearch, setDebouncedUserSearch] = useState('');
  const [userRoleFilter, setUserRoleFilter] = useState('');
  const [userStatusFilter, setUserStatusFilter] = useState('');
  const [userVoiceFilter, setUserVoiceFilter] = useState('');
  const [userPage, setUserPage] = useState(1);
  const [usersData, setUsersData] = useState<{ items: Profile[]; total: number }>({
    items: [],
    total: 0,
  });
  const [usersLoading, setUsersLoading] = useState(false);
  const usersReqSeq = useRef(0);

  const [editingUser, setEditingUser] = useState<Profile | null>(null);
  const [editRole, setEditRole] = useState<UserRole>('student');
  const [editStatus, setEditStatus] = useState<AccountStatus>('active');
  const [savingUser, setSavingUser] = useState(false);
  const [resetPasswordDraft, setResetPasswordDraft] = useState('');
  const [resettingPassword, setResettingPassword] = useState(false);
  const [deletingUser, setDeletingUser] = useState<Profile | null>(null);
  const [deletingUserBusy, setDeletingUserBusy] = useState(false);
  const [viewingStudentId, setViewingStudentId] = useState<string | null>(null);

  // Create User Modal (Admin-only provisioning)
  const [createUserOpen, setCreateUserOpen] = useState(false);
  const [newRole, setNewRole] = useState<'student' | 'teacher'>('student');
  const [newFullName, setNewFullName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newStudentCode, setNewStudentCode] = useState('');
  const [newDob, setNewDob] = useState('');
  const [newEntryLevel, setNewEntryLevel] = useState<QuestionLevel | ''>('');
  const [newTargetBand, setNewTargetBand] = useState('');
  const [newGuardianName, setNewGuardianName] = useState('');
  const [newGuardianPhone, setNewGuardianPhone] = useState('');
  const [newEnrollmentNote, setNewEnrollmentNote] = useState('');
  const [creatingUser, setCreatingUser] = useState(false);
  const [createdCredential, setCreatedCredential] = useState<{
    fullName: string;
    role: 'student' | 'teacher';
    email: string;
    password: string;
    studentCode?: string | null;
  } | null>(null);

  // TAB: CONTENT — Question Sets (paginated)
  const [setSearch, setSetSearch] = useState('');
  const [debouncedSetSearch, setDebouncedSetSearch] = useState('');
  const [setPublishFilter, setSetPublishFilter] = useState('');
  const [setsPage, setSetsPage] = useState(1);
  const [setsData, setSetsData] = useState<{ items: QuestionSet[]; total: number }>({
    items: [],
    total: 0,
  });
  const [setsLoading, setSetsLoading] = useState(false);
  const setsReqSeq = useRef(0);
  const [deletingSet, setDeletingSet] = useState<QuestionSet | null>(null);
  const [deletingSetBusy, setDeletingSetBusy] = useState(false);

  // TAB: CONTENT — Practice & Exam Sessions (paginated)
  const [sessionSearch, setSessionSearch] = useState('');
  const [debouncedSessionSearch, setDebouncedSessionSearch] = useState('');
  const [sessionModeFilter, setSessionModeFilter] = useState('');
  const [sessionsPage, setSessionsPage] = useState(1);
  const [sessionsData, setSessionsData] = useState<{ items: PracticeSession[]; total: number }>({
    items: [],
    total: 0,
  });
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const sessionsReqSeq = useRef(0);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [deletingSession, setDeletingSession] = useState<PracticeSession | null>(null);
  const [deletingSessionBusy, setDeletingSessionBusy] = useState(false);

  // TAB: ASSESSMENTS 1-1 (paginated)
  const [assessSearch, setAssessSearch] = useState('');
  const [debouncedAssessSearch, setDebouncedAssessSearch] = useState('');
  const [assessTeacherFilter, setAssessTeacherFilter] = useState('');
  const [assessSavedFilter, setAssessSavedFilter] = useState<'' | 'saved' | 'draft'>('');
  const [assessScoreFilter, setAssessScoreFilter] = useState<
    '' | 'excellent' | 'good' | 'fair' | 'needsWork'
  >('');
  const [assessPage, setAssessPage] = useState(1);
  const [assessmentsData, setAssessmentsData] = useState<{ items: Assessment[]; total: number }>({
    items: [],
    total: 0,
  });
  const [assessmentsLoading, setAssessmentsLoading] = useState(false);
  const assessmentsReqSeq = useRef(0);

  const [selectedAssessment, setSelectedAssessment] = useState<Assessment | null>(null);
  const [editingAssessment, setEditingAssessment] = useState<Assessment | null>(null);
  const [editAssessTitle, setEditAssessTitle] = useState('');
  const [editAssessNote, setEditAssessNote] = useState('');
  const [editAssessSaved, setEditAssessSaved] = useState(true);
  const [savingAssess, setSavingAssess] = useState(false);

  const [deletingAssessment, setDeletingAssessment] = useState<Assessment | null>(null);
  const [deletingAssessBusy, setDeletingAssessBusy] = useState(false);
  const [cleanupDraftsOpen, setCleanupDraftsOpen] = useState(false);
  const [cleaningDraftsBusy, setCleaningDraftsBusy] = useState(false);

  // ── Shared Overview & Directory Loaders ────────────────────────────────────
  const loadOverviewAndDirectory = useCallback(async () => {
    setOverviewLoading(true);
    try {
      const [stats, teachers] = await Promise.all([
        fetchAdminOverviewStats(),
        fetchAdminTeacherDirectory(false),
      ]);
      setOverviewStats(stats);
      setTeacherDirectory(teachers);
      onPendingCountChange?.(stats.pendingTeacherCount);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Lỗi tải dữ liệu tổng quan', 'danger');
    } finally {
      setOverviewLoading(false);
    }
  }, [onPendingCountChange, showToast]);

  useEffect(() => {
    loadOverviewAndDirectory();
  }, [loadOverviewAndDirectory]);

  // Health monitor only needed on overview
  const checkGpuHealth = useCallback(async (targetUrl: string) => {
    const clean = targetUrl.trim().replace(/\/+$/, '');
    if (!clean) {
      setHealthData(null);
      setHealthError('Chưa thiết lập đường dẫn hệ thống chấm điểm.');
      return;
    }

    setHealthLoading(true);
    setHealthError(null);
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 7000);
    try {
      const res = await fetch(`${clean}/health`, {
        method: 'GET',
        signal: controller.signal,
      });
      if (!res.ok) throw new Error('offline');
      const json = (await res.json()) as GpuHealthData & { data?: GpuHealthData };
      setHealthData(json.data ? json.data : json);
    } catch (err) {
      setHealthData(null);
      setHealthError(
        err instanceof Error && err.name === 'AbortError'
          ? 'Hệ thống chấm điểm tạm thời không phản hồi. Vui lòng kiểm tra lại.'
          : 'Hệ thống chấm điểm hiện chưa kết nối.',
      );
    } finally {
      window.clearTimeout(timer);
      setHealthLoading(false);
    }
  }, []);

  useEffect(() => {
    setGpuUrlDraft(gpuUrl);
    if (activeTab === 'overview') {
      checkGpuHealth(gpuUrl);
    }
  }, [activeTab, gpuUrl, checkGpuHealth]);

  // Lazy load full teacher voice samples only for classroom sub-tab
  useEffect(() => {
    if (activeTab !== 'monitoring' || monitoringSubTab !== 'classroom') return;
    let cancelled = false;
    setClassroomLoading(true);
    fetchAdminTeacherDirectory(true)
      .then((list) => {
        if (!cancelled) setClassroomTeachers(list);
      })
      .catch((err) => {
        if (!cancelled) {
          showToast(err instanceof Error ? err.message : 'Lỗi tải danh sách mẫu giọng giáo viên', 'danger');
        }
      })
      .finally(() => {
        if (!cancelled) setClassroomLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab, monitoringSubTab, showToast]);

  // ── Debounce effects for paginated search inputs ───────────────────────────
  useEffect(() => {
    const t = window.setTimeout(() => {
      setDebouncedUserSearch(userSearch);
      setUserPage(1);
    }, 300);
    return () => window.clearTimeout(t);
  }, [userSearch]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setDebouncedSetSearch(setSearch);
      setSetsPage(1);
    }, 300);
    return () => window.clearTimeout(t);
  }, [setSearch]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setDebouncedSessionSearch(sessionSearch);
      setSessionsPage(1);
    }, 300);
    return () => window.clearTimeout(t);
  }, [sessionSearch]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setDebouncedAssessSearch(assessSearch);
      setAssessPage(1);
    }, 300);
    return () => window.clearTimeout(t);
  }, [assessSearch]);

  // ── Paginated Fetchers ─────────────────────────────────────────────────────
  const loadUsersPage = useCallback(async () => {
    const reqId = ++usersReqSeq.current;
    setUsersLoading(true);
    try {
      const res = await fetchAdminUsersPage({
        page: userPage,
        pageSize: USERS_PAGE_SIZE,
        search: debouncedUserSearch,
        role: userRoleFilter,
        status: userStatusFilter,
        voice: userVoiceFilter,
      });
      if (reqId !== usersReqSeq.current) return;
      if (res.items.length === 0 && userPage > 1 && res.total > 0) {
        setUserPage(userPage - 1);
        return;
      }
      setUsersData({ items: res.items, total: res.total });
    } catch (err) {
      if (reqId === usersReqSeq.current) {
        showToast(err instanceof Error ? err.message : 'Lỗi tải danh sách tài khoản', 'danger');
      }
    } finally {
      if (reqId === usersReqSeq.current) setUsersLoading(false);
    }
  }, [
    userPage,
    debouncedUserSearch,
    userRoleFilter,
    userStatusFilter,
    userVoiceFilter,
    showToast,
  ]);

  useEffect(() => {
    if (activeTab === 'users') loadUsersPage();
  }, [activeTab, loadUsersPage]);

  const loadSetsPage = useCallback(async () => {
    const reqId = ++setsReqSeq.current;
    setSetsLoading(true);
    try {
      const res = await fetchAdminQuestionSetsPage({
        page: setsPage,
        pageSize: SETS_PAGE_SIZE,
        search: debouncedSetSearch,
        publishFilter: setPublishFilter,
      });
      if (reqId !== setsReqSeq.current) return;
      if (res.items.length === 0 && setsPage > 1 && res.total > 0) {
        setSetsPage(setsPage - 1);
        return;
      }
      setSetsData({ items: res.items, total: res.total });
    } catch (err) {
      if (reqId === setsReqSeq.current) {
        showToast(err instanceof Error ? err.message : 'Lỗi tải danh sách bộ đề', 'danger');
      }
    } finally {
      if (reqId === setsReqSeq.current) setSetsLoading(false);
    }
  }, [setsPage, debouncedSetSearch, setPublishFilter, showToast]);

  const loadSessionsPage = useCallback(async () => {
    const reqId = ++sessionsReqSeq.current;
    setSessionsLoading(true);
    try {
      const res = await fetchAdminPracticeSessionsPage({
        page: sessionsPage,
        pageSize: SESSIONS_PAGE_SIZE,
        search: debouncedSessionSearch,
        mode: sessionModeFilter,
      });
      if (reqId !== sessionsReqSeq.current) return;
      if (res.items.length === 0 && sessionsPage > 1 && res.total > 0) {
        setSessionsPage(sessionsPage - 1);
        return;
      }
      setSessionsData({ items: res.items, total: res.total });
    } catch (err) {
      if (reqId === sessionsReqSeq.current) {
        showToast(err instanceof Error ? err.message : 'Lỗi tải nhật ký luyện thi', 'danger');
      }
    } finally {
      if (reqId === sessionsReqSeq.current) setSessionsLoading(false);
    }
  }, [sessionsPage, debouncedSessionSearch, sessionModeFilter, showToast]);

  useEffect(() => {
    if (activeTab === 'content') {
      loadSetsPage();
    }
  }, [activeTab, loadSetsPage]);

  useEffect(() => {
    if (activeTab === 'content') {
      loadSessionsPage();
    }
  }, [activeTab, loadSessionsPage]);

  const loadAssessmentsPage = useCallback(async () => {
    const reqId = ++assessmentsReqSeq.current;
    setAssessmentsLoading(true);
    try {
      const res = await fetchAdminAssessmentsPage({
        page: assessPage,
        pageSize: ASSESSMENTS_PAGE_SIZE,
        search: debouncedAssessSearch,
        teacherId: assessTeacherFilter,
        savedFilter: assessSavedFilter,
        scoreFilter: assessScoreFilter,
      });
      if (reqId !== assessmentsReqSeq.current) return;
      if (res.items.length === 0 && assessPage > 1 && res.total > 0) {
        setAssessPage(assessPage - 1);
        return;
      }
      setAssessmentsData({ items: res.items, total: res.total });
    } catch (err) {
      if (reqId === assessmentsReqSeq.current) {
        showToast(err instanceof Error ? err.message : 'Lỗi tải danh sách hội thoại 1-1', 'danger');
      }
    } finally {
      if (reqId === assessmentsReqSeq.current) setAssessmentsLoading(false);
    }
  }, [
    assessPage,
    debouncedAssessSearch,
    assessTeacherFilter,
    assessSavedFilter,
    assessScoreFilter,
    showToast,
  ]);

  useEffect(() => {
    if (activeTab === 'monitoring' && monitoringSubTab === 'assessments') loadAssessmentsPage();
  }, [activeTab, monitoringSubTab, loadAssessmentsPage]);

  // ── Derived lookups ────────────────────────────────────────────────────────
  const voicePct = useMemo(() => {
    if (!overviewStats || overviewStats.nonAdminTotalCount <= 0) return 0;
    return Math.round(
      (overviewStats.voiceReadyNonAdminCount / overviewStats.nonAdminTotalCount) * 100,
    );
  }, [overviewStats]);

  // ── Mutations ──────────────────────────────────────────────────────────────
  const handleQuickTeacherDecision = async (teacher: Profile, nextStatus: 'active' | 'suspended') => {
    try {
      await adminUpdateUser(teacher.id, {
        role: 'teacher',
        status: nextStatus,
        teacherId: null,
      });
      showToast(
        nextStatus === 'active'
          ? `Đã phê duyệt Giáo viên "${teacher.full_name}"!`
          : `Đã khóa tài khoản "${teacher.full_name}".`,
        nextStatus === 'active' ? 'success' : 'info',
      );
      await Promise.all([
        loadOverviewAndDirectory(),
        activeTab === 'users' ? loadUsersPage() : Promise.resolve(),
      ]);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Lỗi cập nhật trạng thái giáo viên', 'danger');
    }
  };

  const generateReadablePassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    let out = '';
    for (let i = 0; i < 10; i++) {
      out += chars[Math.floor(Math.random() * chars.length)];
    }
    return out;
  };

  const openCreateUserModal = (role: 'student' | 'teacher' = 'student') => {
    setNewRole(role);
    setNewFullName('');
    setNewEmail('');
    setNewPhone('');
    setNewPassword(generateReadablePassword());
    setNewStudentCode('');
    setNewDob('');
    setNewEntryLevel('');
    setNewTargetBand('');
    setNewGuardianName('');
    setNewGuardianPhone('');
    setNewEnrollmentNote('');
    setCreatedCredential(null);
    setCreateUserOpen(true);
  };

  const handleCreateUserSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFullName.trim() || !newEmail.trim() || newPassword.length < 6) {
      showToast('Vui lòng nhập đầy đủ họ tên, email và mật khẩu (tối thiểu 6 ký tự).', 'danger');
      return;
    }
    setCreatingUser(true);
    try {
      const created = await adminCreateUser({
        role: newRole,
        full_name: newFullName.trim(),
        email: newEmail.trim().toLowerCase(),
        phone: newPhone.trim() || undefined,
        password: newPassword,
        student_code: newRole === 'student' ? newStudentCode.trim() || undefined : undefined,
        date_of_birth: newRole === 'student' ? newDob.trim() || undefined : undefined,
        entry_level: newRole === 'student' ? newEntryLevel : '',
        target_band:
          newRole === 'student' && newTargetBand.trim() !== '' ? Number(newTargetBand) : null,
        guardian_name: newRole === 'student' ? newGuardianName.trim() || undefined : undefined,
        guardian_phone: newRole === 'student' ? newGuardianPhone.trim() || undefined : undefined,
        enrollment_note: newRole === 'student' ? newEnrollmentNote.trim() || undefined : undefined,
      });

      setCreatedCredential({
        fullName: created.full_name,
        role: newRole,
        email: created.email,
        password: newPassword,
        studentCode: created.student_code,
      });
      showToast(
        `Đã cấp tài khoản ${newRole === 'student' ? 'Học viên' : 'Giáo viên'} "${created.full_name}" thành công!`,
        'success',
      );
      await Promise.all([loadOverviewAndDirectory(), loadUsersPage()]);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Không thể tạo tài khoản mới.', 'danger');
    } finally {
      setCreatingUser(false);
    }
  };

  const handleCopyCredentials = async () => {
    if (!createdCredential) return;
    const lines = [
      `Thông tin đăng nhập SpeakAI (${createdCredential.role === 'student' ? 'Học viên' : 'Giáo viên'})`,
      `Họ tên: ${createdCredential.fullName}`,
      ...(createdCredential.studentCode ? [`Mã học viên: ${createdCredential.studentCode}`] : []),
      `Email: ${createdCredential.email}`,
      `Mật khẩu ban đầu: ${createdCredential.password}`,
      `Lưu ý: Vui lòng đổi mật khẩu trong mục Hồ sơ cá nhân sau khi đăng nhập.`,
    ].join('\n');
    try {
      await navigator.clipboard.writeText(lines);
      showToast('Đã sao chép thông tin đăng nhập!', 'success');
    } catch {
      showToast('Không thể sao chép tự động. Vui lòng chọn và sao chép thủ công.', 'info');
    }
  };

  const handleOpenEditUser = (u: Profile) => {
    setEditingUser(u);
    setEditRole(u.role);
    setEditStatus(u.status);
    setResetPasswordDraft('');
  };

  const handleResetUserPassword = async () => {
    if (!editingUser) return;
    if (resetPasswordDraft.length < 6) {
      showToast('Mật khẩu mới phải có ít nhất 6 ký tự.', 'danger');
      return;
    }
    setResettingPassword(true);
    try {
      await adminResetUserPassword(editingUser.id, resetPasswordDraft);
      showToast(`Đã đặt lại mật khẩu mới cho "${editingUser.full_name}"!`, 'success');
      setResetPasswordDraft('');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Không thể đặt lại mật khẩu.', 'danger');
    } finally {
      setResettingPassword(false);
    }
  };

  const handleSaveUserEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    setSavingUser(true);
    try {
      await adminUpdateUser(editingUser.id, {
        role: editRole,
        status: editStatus,
        teacherId: editRole === 'student' ? editingUser.teacher_id || null : null,
      });
      showToast(`Đã cập nhật tài khoản "${editingUser.full_name}"!`, 'success');
      setEditingUser(null);
      await Promise.all([loadOverviewAndDirectory(), loadUsersPage()]);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Lỗi cập nhật tài khoản', 'danger');
    } finally {
      setSavingUser(false);
    }
  };

  const handleConfirmDeleteUser = async () => {
    if (!deletingUser) return;
    setDeletingUserBusy(true);
    try {
      await deleteUserByAdmin(deletingUser.id);
      showToast(`Đã xóa tài khoản "${deletingUser.full_name}".`, 'info');
      setDeletingUser(null);
      await Promise.all([loadOverviewAndDirectory(), loadUsersPage()]);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Lỗi xóa tài khoản', 'danger');
    } finally {
      setDeletingUserBusy(false);
    }
  };

  const handleTogglePublish = async (qs: QuestionSet) => {
    try {
      await togglePublishSet(qs.id, !qs.is_published);
      setSetsData((prev) => ({
        ...prev,
        items: prev.items.map((item) =>
          item.id === qs.id ? { ...item, is_published: !qs.is_published } : item,
        ),
      }));
      showToast(
        !qs.is_published ? `Đã mở bộ đề "${qs.title}".` : `Đã ẩn bộ đề "${qs.title}".`,
        'success',
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Lỗi cập nhật trạng thái bộ đề', 'danger');
    }
  };

  const handleConfirmDeleteSet = async () => {
    if (!deletingSet) return;
    setDeletingSetBusy(true);
    try {
      await deleteQuestionSet(deletingSet.id);
      showToast(`Đã xóa bộ đề "${deletingSet.title}".`, 'info');
      setDeletingSet(null);
      await Promise.all([loadOverviewAndDirectory(), loadSetsPage(), loadSessionsPage()]);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Lỗi xóa bộ đề', 'danger');
    } finally {
      setDeletingSetBusy(false);
    }
  };

  const handleConfirmDeleteSession = async () => {
    if (!deletingSession) return;
    setDeletingSessionBusy(true);
    try {
      await deletePracticeSessionByAdmin(deletingSession.id);
      showToast('Đã xóa lượt làm bài khỏi hệ thống.', 'info');
      setDeletingSession(null);
      await Promise.all([loadOverviewAndDirectory(), loadSessionsPage()]);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Lỗi xóa lượt làm bài', 'danger');
    } finally {
      setDeletingSessionBusy(false);
    }
  };

  const handleOpenEditAssessment = (a: Assessment) => {
    setEditingAssessment(a);
    setEditAssessTitle(a.result_json?.title || '');
    setEditAssessNote(a.teacher_note || '');
    setEditAssessSaved(Boolean(a.saved));
  };

  const handleSaveAssessmentEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAssessment) return;
    setSavingAssess(true);
    try {
      await adminUpdateAssessment(editingAssessment.id, {
        title: editAssessTitle,
        teacherNote: editAssessNote,
        saved: editAssessSaved,
        existingResultJson: editingAssessment.result_json,
      });
      showToast('Đã cập nhật buổi chấm hội thoại 1-1!', 'success');
      setEditingAssessment(null);
      await Promise.all([loadOverviewAndDirectory(), loadAssessmentsPage()]);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Lỗi cập nhật buổi chấm 1-1', 'danger');
    } finally {
      setSavingAssess(false);
    }
  };

  const handleConfirmDeleteAssessment = async () => {
    if (!deletingAssessment) return;
    setDeletingAssessBusy(true);
    try {
      await adminDeleteAssessment(deletingAssessment.id);
      showToast('Đã xóa buổi chấm hội thoại 1-1.', 'info');
      setDeletingAssessment(null);
      await Promise.all([loadOverviewAndDirectory(), loadAssessmentsPage()]);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Lỗi xóa buổi chấm 1-1', 'danger');
    } finally {
      setDeletingAssessBusy(false);
    }
  };

  const handleConfirmCleanupDrafts = async () => {
    setCleaningDraftsBusy(true);
    try {
      const removed = await adminCleanupDraftAssessments();
      showToast(`Đã xóa ${removed} kết quả chấm 1-1 chưa lưu.`, 'success');
      setCleanupDraftsOpen(false);
      await Promise.all([loadOverviewAndDirectory(), loadAssessmentsPage()]);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Lỗi xóa kết quả chưa lưu', 'danger');
    } finally {
      setCleaningDraftsBusy(false);
    }
  };

  const handleSaveGpuUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = gpuUrlDraft.trim().replace(/\/+$/, '');
    setSavingGpuUrl(true);
    try {
      await updateGlobalGpuUrl(cleaned);
      setRuntimeGpuUrl(cleaned);
      onGpuUrlChange(cleaned);
      setGpuModalOpen(false);
      showToast('Đã cập nhật kết nối hệ thống chấm điểm!', 'success');
      await checkGpuHealth(cleaned);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Lỗi lưu kết nối hệ thống chấm điểm', 'danger');
    } finally {
      setSavingGpuUrl(false);
    }
  };

  if (overviewLoading && !overviewStats && activeTab === 'overview') {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-slate-500">
        <Loader2 className="mb-3 h-8 w-8 animate-spin text-blue-600" />
        <p className="text-sm">Đang tải dữ liệu quản trị...</p>
      </div>
    );
  }

  const pendingTeachers = overviewStats?.pendingTeachers || [];
  const totalActivities =
    (overviewStats?.savedAssessmentCount || 0) +
    (overviewStats?.practiceSessionCount || 0) +
    (overviewStats?.examSessionCount || 0);

  return (
    <div className="space-y-6">
      {/* TAB 1: OVERVIEW & TEACHER APPROVAL */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          <PageHeader
            eyebrow="QUẢN TRỊ HỆ THỐNG"
            title="Tổng quan Hệ thống"
            subtitle="Theo dõi hoạt động toàn hệ thống, phê duyệt giáo viên và giám sát phân lớp."
            pill={
              <>
                <span
                  className={`h-2 w-2 rounded-full ${healthData ? 'bg-emerald-500' : 'bg-amber-500'}`}
                />
                <span>{healthData ? 'Hệ thống chấm điểm sẵn sàng' : 'Kiểm tra kết nối chấm điểm'}</span>
              </>
            }
            action={
              <button
                type="button"
                onClick={() => loadOverviewAndDirectory()}
                className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${overviewLoading ? 'animate-spin' : ''}`} />
                Làm mới
              </button>
            }
          />

          {/* 4 KPIs */}
          <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
            <div className="section-card card-interactive flex items-center gap-3.5 !p-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
                <Users className="h-5 w-5" />
              </div>
              <div>
                <div className="text-2xl font-extrabold text-slate-900 tabular-nums">
                  {overviewStats?.totalUsers ?? 0}
                </div>
                <div className="text-xs font-medium text-slate-500">Tổng tài khoản</div>
              </div>
            </div>

            <div className="section-card card-interactive flex items-center gap-3.5 !p-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-50 text-amber-600">
                <UserCheck className="h-5 w-5" />
              </div>
              <div>
                <div className="text-2xl font-extrabold text-amber-600 tabular-nums">
                  {overviewStats?.pendingTeacherCount ?? 0}
                </div>
                <div className="text-xs font-medium text-slate-500">GV chờ duyệt</div>
              </div>
            </div>

            <div className="section-card card-interactive flex items-center gap-3.5 !p-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-sky-50 text-sky-600">
                <BookOpen className="h-5 w-5" />
              </div>
              <div>
                <div className="text-2xl font-extrabold text-slate-900 tabular-nums">
                  {overviewStats?.questionSetCount ?? 0}
                </div>
                <div className="text-xs font-medium text-slate-500">Bộ đề Speaking</div>
              </div>
            </div>

            <div className="section-card card-interactive flex items-center gap-3.5 !p-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
                <Activity className="h-5 w-5" />
              </div>
              <div>
                <div className="text-2xl font-extrabold text-slate-900 tabular-nums">
                  {totalActivities}
                </div>
                <div className="text-xs font-medium text-slate-500">Lượt chấm &amp; Thi</div>
              </div>
            </div>
          </div>

          {/* 2 Selective Admin Analytics Charts */}
          <div className="grid gap-6 lg:grid-cols-12">
            <div className="section-card lg:col-span-5 flex flex-col justify-between space-y-4">
              <div>
                <h3 className="flex items-center gap-2 text-base font-bold text-slate-900">
                  <PieChart className="h-4 w-4 text-blue-600" />
                  Cơ cấu Tài khoản &amp; Mẫu giọng
                </h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  Phân bổ vai trò người dùng và mức độ sẵn sàng giọng nói.
                </p>
              </div>

              <RatioDonutChart
                size={136}
                strokeWidth={15}
                centerValue={`${overviewStats?.totalUsers ?? 0}`}
                centerLabel="Tài khoản"
                segments={[
                  { label: 'Học viên', value: overviewStats?.studentCount ?? 0, color: '#0EA5E9' },
                  {
                    label: 'Giáo viên',
                    value: overviewStats?.activeTeacherCount ?? 0,
                    color: '#4F46E5',
                  },
                  {
                    label: 'Chờ duyệt',
                    value: overviewStats?.pendingTeacherCount ?? 0,
                    color: '#F59E0B',
                  },
                  {
                    label: 'Quản trị viên & Khác',
                    value: overviewStats?.otherUserCount ?? 0,
                    color: '#94A3B8',
                  },
                ]}
              />

              <div className="rounded-2xl border border-slate-100 bg-slate-50/85 p-3 space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-600">Đã đăng ký mẫu giọng</span>
                  <span className="font-extrabold text-emerald-600 tabular-nums">
                    {overviewStats?.voiceReadyNonAdminCount ?? 0}/
                    {overviewStats?.nonAdminTotalCount ?? 0} ({voicePct}%)
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
                  <div
                    className="h-full rounded-full bg-emerald-600"
                    style={{ width: `${voicePct}%` }}
                  />
                </div>
              </div>
            </div>

            <div className="section-card lg:col-span-7 flex flex-col justify-between space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="flex items-center gap-2 text-base font-bold text-slate-900">
                    <BarChart3 className="h-4 w-4 text-blue-600" />
                    Hoạt động Speaking &amp; Bộ đề toàn hệ thống
                  </h3>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Thống kê lượt đánh giá hoàn thành theo từng hình thức.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setMonitoringSubTab('assessments');
                    onNavigate('monitoring');
                  }}
                  className="text-xs font-semibold text-blue-600 hover:text-blue-500"
                >
                  Giám sát chấm điểm →
                </button>
              </div>

              <DistributionBarChart
                emptyText="Chưa có lượt đánh giá hoặc luyện tập hoàn thành nào."
                unit=" lượt"
                items={[
                  {
                    label: 'Chấm hội thoại 1-1',
                    value: overviewStats?.savedAssessmentCount ?? 0,
                    colorClass: 'bg-blue-600',
                  },
                  {
                    label: 'Luyện tập từng câu',
                    value: overviewStats?.practiceSessionCount ?? 0,
                    colorClass: 'bg-sky-500',
                  },
                  {
                    label: 'Thi thử bấm giờ',
                    value: overviewStats?.examSessionCount ?? 0,
                    colorClass: 'bg-slate-700',
                  },
                ]}
              />

              <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 text-[11px]">
                <span className="font-semibold text-slate-500 mr-1">Kho bộ đề:</span>
                <span className="rounded-md border border-blue-200 bg-blue-50 px-2.5 py-0.5 font-semibold text-blue-700 tabular-nums">
                  IELTS: {overviewStats?.formatCounts.ielts ?? 0}
                </span>
                <span className="rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 font-semibold text-emerald-700 tabular-nums">
                  VSTEP: {overviewStats?.formatCounts.vstep ?? 0}
                </span>
                <span className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-0.5 font-semibold text-amber-800 tabular-nums">
                  TOEIC: {overviewStats?.formatCounts.toeic ?? 0}
                </span>
                <span className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-0.5 font-semibold text-slate-600 tabular-nums">
                  Chung: {overviewStats?.formatCounts.general ?? 0}
                </span>
              </div>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-12">
            {/* Pending Teacher Approval / Center Quick Provisioning */}
            <div className="section-card lg:col-span-7 space-y-4">
              <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-3">
                <h3 className="flex items-center gap-2 text-base font-bold text-slate-900">
                  <UserPlus className="h-5 w-5 text-blue-600" />
                  {pendingTeachers.length > 0
                    ? `Tài khoản chờ duyệt (${overviewStats?.pendingTeacherCount ?? 0})`
                    : 'Cấp tài khoản & Quản lý Lớp học'}
                </h3>
                <button
                  type="button"
                  onClick={() => onNavigate('users')}
                  className="text-xs font-semibold text-blue-600 hover:text-blue-700"
                >
                  Quản lý tài khoản →
                </button>
              </div>

              {pendingTeachers.length === 0 ? (
                <div className="space-y-3">
                  <p className="text-xs text-slate-600 text-pretty">
                    Tài khoản Học viên và Giáo viên được Giáo vụ cấp trực tiếp tại mục <strong>Tài khoản</strong>, sau đó xếp lớp tập trung tại mục <strong>Quản lý Lớp học</strong>.
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => {
                        onNavigate('users');
                        openCreateUserModal('student');
                      }}
                      className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-left hover:border-blue-300 hover:bg-white transition-colors duration-150"
                    >
                      <div>
                        <div className="text-sm font-semibold text-slate-900">Cấp tài khoản Học viên</div>
                        <div className="text-xs text-slate-500">Tạo tài khoản &amp; lưu hồ sơ ghi danh</div>
                      </div>
                      <UserPlus className="size-5 shrink-0 text-blue-600" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onNavigate('classes')}
                      className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-left hover:border-blue-300 hover:bg-white transition-colors duration-150"
                    >
                      <div>
                        <div className="text-sm font-semibold text-slate-900">Xếp lớp Học viên</div>
                        <div className="text-xs text-slate-500">Nơi duy nhất thực hiện xếp lớp</div>
                      </div>
                      <School className="size-5 shrink-0 text-emerald-600" />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {pendingTeachers.map((t) => (
                    <div
                      key={t.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50/60 p-3.5"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <img
                          src={getAvatarUrl(t.full_name, 80)}
                          alt={t.full_name}
                          className="h-10 w-10 rounded-full border border-slate-200"
                        />
                        <div className="min-w-0">
                          <div className="truncate text-sm font-bold text-slate-900">{t.full_name}</div>
                          <div className="truncate text-xs text-slate-500">{t.email}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleQuickTeacherDecision(t, 'active')}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-emerald-500 transition"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Phê duyệt
                        </button>
                        <button
                          type="button"
                          onClick={() => handleQuickTeacherDecision(t, 'suspended')}
                          className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-100 transition"
                        >
                          <Lock className="h-3.5 w-3.5" />
                          Khóa
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Service Status Card */}
            <div className="section-card lg:col-span-5 flex flex-col justify-between space-y-4">
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-3">
                  <h3 className="flex items-center gap-2 text-base font-bold text-slate-900">
                    <Server className="h-5 w-5 text-sky-600" />
                    Kết nối hệ thống chấm điểm
                  </h3>
                  <button
                    type="button"
                    onClick={() => checkGpuHealth(gpuUrl)}
                    disabled={healthLoading}
                    className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    <RefreshCw className={`h-3 w-3 ${healthLoading ? 'animate-spin' : ''}`} />
                    Kiểm tra
                  </button>
                </div>

                {healthLoading ? (
                  <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600">
                    <Loader2 className="h-4 w-4 animate-spin text-sky-600" />
                    Đang kiểm tra kết nối hệ thống chấm điểm...
                  </div>
                ) : healthData ? (
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50/80 p-4 text-xs space-y-1.5">
                    <div className="flex items-center gap-2 font-bold text-emerald-700">
                      <CheckCircle2 className="h-4 w-4 shrink-0" />
                      <span>Sẵn sàng hoạt động</span>
                    </div>
                    <p className="leading-relaxed text-emerald-800/85">
                      Hệ thống chấm phát âm, nhận diện giọng nói và đánh giá hội thoại đang kết nối ổn định.
                    </p>
                  </div>
                ) : (
                  <div className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50/85 p-4 text-xs text-amber-900">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                    <div>
                      <div className="font-bold text-amber-800">Chưa kết nối</div>
                      <p className="mt-0.5">{healthError || 'Hệ thống chấm điểm hiện chưa sẵn sàng.'}</p>
                    </div>
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() => {
                  setGpuUrlDraft(gpuUrl);
                  setGpuModalOpen(true);
                }}
                className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition"
              >
                <Link2 className="h-4 w-4" />
                Cập nhật kết nối chấm điểm
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: USERS (SERVER-PAGINATED) */}
      {activeTab === 'users' && (
        <div className="space-y-5">
          <PageHeader
            eyebrow="QUẢN LÝ TÀI KHOẢN & GHI DANH"
            title="Quản lý Tài khoản"
            subtitle="Chỉ Quản trị viên / Giáo vụ được cấp tài khoản Học viên và Giáo viên. Việc xếp lớp thực hiện tại mục Quản lý Lớp học."
            pill={<span className="tabular-nums">{usersData.total} tài khoản</span>}
            action={
              <button
                type="button"
                onClick={() => openCreateUserModal('student')}
                className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 transition-colors duration-150"
              >
                <UserPlus className="size-4" />
                Cấp tài khoản mới
              </button>
            }
          />

          <div className="section-card grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                placeholder="Tìm tên, email hoặc mã HV..."
                className="w-full rounded-xl border border-slate-200 bg-slate-50/80 py-2.5 pl-9 pr-3 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none"
              />
            </div>

            <select
              value={userRoleFilter}
              onChange={(e) => {
                setUserRoleFilter(e.target.value);
                setUserPage(1);
              }}
              className="rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2.5 text-sm text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none"
            >
              <option value="">Tất cả vai trò</option>
              <option value="admin">Quản trị viên</option>
              <option value="teacher">Giáo viên</option>
              <option value="student">Học viên</option>
            </select>

            <select
              value={userStatusFilter}
              onChange={(e) => {
                setUserStatusFilter(e.target.value);
                setUserPage(1);
              }}
              className="rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2.5 text-sm text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none"
            >
              <option value="">Tất cả trạng thái</option>
              <option value="active">Đang hoạt động</option>
              <option value="pending">Chờ duyệt</option>
              <option value="suspended">Đã khóa</option>
            </select>

            <select
              value={userVoiceFilter}
              onChange={(e) => {
                setUserVoiceFilter(e.target.value);
                setUserPage(1);
              }}
              className="rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2.5 text-sm text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none"
            >
              <option value="">Mọi mẫu giọng</option>
              <option value="ready">Đã đăng ký giọng</option>
              <option value="missing">Chưa đăng ký giọng</option>
            </select>
          </div>

          {usersLoading && usersData.items.length === 0 ? (
            <div className="section-card flex items-center justify-center py-12 text-slate-500">
              <Loader2 className="mr-2 h-5 w-5 animate-spin text-blue-600" />
              <span className="text-sm">Đang tải danh sách tài khoản...</span>
            </div>
          ) : (
            <>
              {/* DESKTOP USERS TABLE (md+) */}
              <div className="section-card !p-0 overflow-hidden hidden md:block">
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
                    <thead className="bg-slate-50 text-slate-500">
                      <tr>
                        <th className="px-4 py-3 font-semibold">Tài khoản</th>
                        <th className="px-4 py-3 font-semibold">Vai trò</th>
                        <th className="px-4 py-3 font-semibold">Trạng thái</th>
                        <th className="px-4 py-3 font-semibold">Mẫu giọng</th>
                        <th className="px-4 py-3 text-right font-semibold">Thao tác</th>
                      </tr>
                    </thead>
                    <tbody className={`divide-y divide-slate-100 bg-white ${usersLoading ? 'opacity-60' : ''}`}>
                      {usersData.items.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                            Không có tài khoản nào khớp bộ lọc.
                          </td>
                        </tr>
                      ) : (
                        usersData.items.map((u) => {
                          const isSelf = u.id === currentUser.id;
                          const voiceOk = hasVoiceEnrolled(u);

                          return (
                            <tr key={u.id} className="hover:bg-slate-50/80">
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-3">
                                  <img
                                    src={getAvatarUrl(u.full_name, 72)}
                                    alt={u.full_name}
                                    className="h-9 w-9 rounded-full border border-slate-200"
                                  />
                                  <div>
                                    <div className="font-bold text-slate-900">
                                      {u.full_name}
                                      {u.role === 'student' && u.student_code && (
                                        <span className="ml-1.5 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-600">
                                          {u.student_code}
                                        </span>
                                      )}
                                      {isSelf && (
                                        <span className="ml-1.5 rounded-md bg-blue-50 border border-blue-200 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">
                                          Bạn
                                        </span>
                                      )}
                                    </div>
                                    <div className="text-[11px] text-slate-500">{u.email}</div>
                                  </div>
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                {u.role === 'admin' ? (
                                  <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-0.5 text-rose-700 font-semibold">
                                    <ShieldCheck className="h-3 w-3" /> Quản trị viên
                                  </span>
                                ) : u.role === 'teacher' ? (
                                  <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-0.5 text-blue-700 font-semibold">
                                    <Presentation className="h-3 w-3" /> Giáo viên
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2.5 py-0.5 text-sky-700 font-semibold">
                                    <GraduationCap className="h-3 w-3" /> Học viên
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-3">
                                {u.status === 'active' ? (
                                  <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 font-semibold text-emerald-700">
                                    Hoạt động
                                  </span>
                                ) : u.status === 'pending' ? (
                                  <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 font-semibold text-amber-700">
                                    Chờ duyệt
                                  </span>
                                ) : (
                                  <span className="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-0.5 font-semibold text-rose-700">
                                    Đã khóa
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-3">
                                {u.role !== 'admin' ? (
                                  <div className="flex items-center gap-1 text-[11px]">
                                    <Mic className={`h-3 w-3 ${voiceOk ? 'text-emerald-600' : 'text-slate-400'}`} />
                                    <span className={voiceOk ? 'text-emerald-700 font-medium' : 'text-slate-500'}>
                                      {voiceOk ? 'Đã có mẫu giọng' : 'Chưa có giọng'}
                                    </span>
                                  </div>
                                ) : (
                                  <span className="text-[11px] text-slate-400">—</span>
                                )}
                              </td>
                              <td className="px-4 py-3 text-right">
                                <div className="inline-flex items-center gap-1.5">
                                  {u.role === 'teacher' && u.status === 'pending' && (
                                    <button
                                      type="button"
                                      onClick={() => handleQuickTeacherDecision(u, 'active')}
                                      className="inline-flex items-center gap-1 rounded-xl bg-emerald-600 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-emerald-500"
                                    >
                                      <CheckCircle2 className="h-3 w-3" />
                                      Duyệt
                                    </button>
                                  )}
                                  {u.role === 'student' && (
                                    <button
                                      type="button"
                                      onClick={() => setViewingStudentId(u.id)}
                                      className="inline-flex items-center gap-1 rounded-xl border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-[11px] font-semibold text-blue-700 hover:bg-blue-100"
                                    >
                                      <FileText className="h-3 w-3" />
                                      Hồ sơ
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => handleOpenEditUser(u)}
                                    className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                                  >
                                    <Pencil className="h-3 w-3" />
                                    Sửa tài khoản
                                  </button>
                                  {!isSelf && (
                                    <button
                                      type="button"
                                      onClick={() => setDeletingUser(u)}
                                      className="inline-flex items-center gap-1 rounded-xl border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-[11px] text-rose-600 hover:bg-rose-100"
                                      title="Xóa tài khoản"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* MOBILE USERS CARDS (< md) */}
              <div className="space-y-3 md:hidden">
                {usersData.items.length === 0 ? (
                  <div className="section-card py-10 text-center text-sm text-slate-500">
                    Không có tài khoản nào khớp bộ lọc.
                  </div>
                ) : (
                  usersData.items.map((u) => {
                    const isSelf = u.id === currentUser.id;
                    const voiceOk = hasVoiceEnrolled(u);

                    return (
                      <div key={u.id} className="section-card space-y-3 !p-4">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-3 min-w-0">
                            <img
                              src={getAvatarUrl(u.full_name, 72)}
                              alt={u.full_name}
                              className="h-10 w-10 rounded-full border border-slate-200"
                            />
                            <div className="min-w-0">
                              <div className="truncate text-sm font-bold text-slate-900">
                                {u.full_name}
                                {isSelf && (
                                  <span className="ml-1.5 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">
                                    Bạn
                                  </span>
                                )}
                              </div>
                              <div className="truncate text-xs text-slate-500">{u.email}</div>
                            </div>
                          </div>
                          {u.status === 'active' ? (
                            <span className="shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700">
                              Hoạt động
                            </span>
                          ) : u.status === 'pending' ? (
                            <span className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-700">
                              Chờ duyệt
                            </span>
                          ) : (
                            <span className="shrink-0 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-0.5 text-[11px] font-semibold text-rose-700">
                              Đã khóa
                            </span>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 font-semibold text-slate-700">
                            {u.role === 'admin' ? 'Quản trị viên' : u.role === 'teacher' ? 'Giáo viên' : 'Học viên'}
                          </span>
                          {u.role !== 'admin' && (
                            <span className={`inline-flex items-center gap-1 ${voiceOk ? 'text-emerald-700' : 'text-slate-400'}`}>
                              <Mic className="h-3 w-3" />
                              {voiceOk ? 'Có mẫu giọng' : 'Chưa có giọng'}
                            </span>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2.5">
                          {u.role === 'teacher' && u.status === 'pending' && (
                            <button
                              type="button"
                              onClick={() => handleQuickTeacherDecision(u, 'active')}
                              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-semibold text-white"
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              Duyệt
                            </button>
                          )}
                          {u.role === 'student' && (
                            <button
                              type="button"
                              onClick={() => setViewingStudentId(u.id)}
                              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700"
                            >
                              <FileText className="h-3.5 w-3.5" />
                              Hồ sơ
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleOpenEditUser(u)}
                            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            Sửa tài khoản
                          </button>
                          {!isSelf && (
                            <button
                              type="button"
                              onClick={() => setDeletingUser(u)}
                              className="inline-flex items-center justify-center rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              <Pagination
                page={userPage}
                pageSize={USERS_PAGE_SIZE}
                totalCount={usersData.total}
                onPageChange={setUserPage}
                disabled={usersLoading}
                itemLabel="tài khoản"
              />
            </>
          )}
        </div>
      )}

      {/* TAB 3: QUESTION SETS & PRACTICE/EXAM LOGS (PAGINATED) */}
      {activeTab === 'content' && (
        <div className="space-y-6">
          <PageHeader
            eyebrow="GIÁM SÁT NỘI DUNG"
            title="Bộ đề & Lịch sử Luyện thi"
            subtitle="Quản lý trạng thái mở/ẩn bộ đề Speaking và giám sát các lượt Luyện tập, Thi thử của học viên."
            action={
              <button
                type="button"
                onClick={() => {
                  setMonitoringSubTab('assessments');
                  onNavigate('monitoring');
                }}
                className="inline-flex items-center gap-1.5 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-100 transition"
              >
                <ClipboardCheck className="h-4 w-4" />
                Giám sát chấm điểm →
              </button>
            }
          />

          {/* Section 1: Question Sets Moderation */}
          <div className="section-card space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="flex items-center gap-2 text-base font-bold text-slate-900">
                <BookOpen className="h-5 w-5 text-sky-600" />
                Bộ đề Speaking ({setsData.total})
              </h3>
              <div className="flex flex-wrap gap-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={setSearch}
                    onChange={(e) => setSetSearch(e.target.value)}
                    placeholder="Tìm tên bộ đề, giáo viên..."
                    className="rounded-xl border border-slate-200 bg-slate-50/80 py-2 pl-8 pr-3 text-xs text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none"
                  />
                </div>
                <select
                  value={setPublishFilter}
                  onChange={(e) => {
                    setSetPublishFilter(e.target.value);
                    setSetsPage(1);
                  }}
                  className="rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2 text-xs text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none"
                >
                  <option value="">Tất cả trạng thái</option>
                  <option value="published">Đang mở</option>
                  <option value="draft">Đang ẩn</option>
                </select>
              </div>
            </div>

            {setsLoading && setsData.items.length === 0 ? (
              <div className="flex justify-center py-8 text-slate-500">
                <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
              </div>
            ) : (
              <>
                {/* DESKTOP SETS TABLE (md+) */}
                <div className="hidden md:block overflow-x-auto rounded-2xl border border-slate-200">
                  <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
                    <thead className="bg-slate-50 text-slate-500">
                      <tr>
                        <th className="px-4 py-2.5 font-semibold">Bộ đề</th>
                        <th className="px-4 py-2.5 font-semibold">Tác giả</th>
                        <th className="px-4 py-2.5 font-semibold">Số câu</th>
                        <th className="px-4 py-2.5 font-semibold">Trạng thái</th>
                        <th className="px-4 py-2.5 text-right font-semibold">Thao tác</th>
                      </tr>
                    </thead>
                    <tbody className={`divide-y divide-slate-100 bg-white ${setsLoading ? 'opacity-60' : ''}`}>
                      {setsData.items.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
                            Không có bộ đề nào phù hợp.
                          </td>
                        </tr>
                      ) : (
                        setsData.items.map((qs) => (
                          <tr key={qs.id} className="hover:bg-slate-50/80">
                            <td className="px-4 py-3">
                              <div className="font-bold text-slate-900">{qs.title}</div>
                              <div className="text-[11px] text-slate-500">
                                {getExamTypeName(qs.exam_type)} · {getLevelLabel(qs.level)}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-slate-700 font-medium">{qs.creator_name}</td>
                            <td className="px-4 py-3 text-slate-700">{qs.question_count || 0} câu</td>
                            <td className="px-4 py-3">
                              {qs.is_published ? (
                                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-emerald-700 font-semibold">
                                  <Eye className="h-3 w-3" /> Đang mở
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-slate-500 font-semibold">
                                  <EyeOff className="h-3 w-3" /> Đang ẩn
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <div className="inline-flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => handleTogglePublish(qs)}
                                  className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                                >
                                  {qs.is_published ? (
                                    <>
                                      <Lock className="h-3 w-3" /> Ẩn đề
                                    </>
                                  ) : (
                                    <>
                                      <Unlock className="h-3 w-3" /> Mở đề
                                    </>
                                  )}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setDeletingSet(qs)}
                                  className="rounded-xl border border-rose-200 bg-rose-50 p-1.5 text-rose-600 hover:bg-rose-100"
                                  title="Xóa bộ đề"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {/* MOBILE SETS CARDS (< md) */}
                <div className="space-y-2.5 md:hidden">
                  {setsData.items.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-xs text-slate-400">
                      Không có bộ đề nào phù hợp.
                    </div>
                  ) : (
                    setsData.items.map((qs) => (
                      <div
                        key={qs.id}
                        className="rounded-2xl border border-slate-200 bg-slate-50/75 p-3.5 space-y-2.5"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="font-bold text-slate-900">{qs.title}</div>
                            <div className="text-xs text-slate-500">
                              {qs.creator_name} · {qs.question_count || 0} câu
                            </div>
                          </div>
                          {qs.is_published ? (
                            <span className="shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                              Đang mở
                            </span>
                          ) : (
                            <span className="shrink-0 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-500">
                              Đang ẩn
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleTogglePublish(qs)}
                            className="inline-flex flex-1 items-center justify-center gap-1 rounded-xl border border-slate-200 bg-white py-2 text-xs font-semibold text-slate-700"
                          >
                            {qs.is_published ? (
                              <>
                                <Lock className="h-3.5 w-3.5" /> Ẩn đề
                              </>
                            ) : (
                              <>
                                <Unlock className="h-3.5 w-3.5" /> Mở đề
                              </>
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeletingSet(qs)}
                            className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-rose-600"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <Pagination
                  compact
                  page={setsPage}
                  pageSize={SETS_PAGE_SIZE}
                  totalCount={setsData.total}
                  onPageChange={setSetsPage}
                  disabled={setsLoading}
                  itemLabel="bộ đề"
                />
              </>
            )}
          </div>

          {/* Section 2: Practice & Exam Sessions Log */}
          <div className="section-card space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="flex items-center gap-2 text-base font-bold text-slate-900">
                <Activity className="h-5 w-5 text-emerald-600" />
                Nhật ký Luyện tập &amp; Thi thử ({sessionsData.total})
              </h3>
              <div className="flex flex-wrap gap-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={sessionSearch}
                    onChange={(e) => setSessionSearch(e.target.value)}
                    placeholder="Tìm học viên, tên bộ đề..."
                    className="rounded-xl border border-slate-200 bg-slate-50/80 py-2 pl-8 pr-3 text-xs text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none"
                  />
                </div>
                <select
                  value={sessionModeFilter}
                  onChange={(e) => {
                    setSessionModeFilter(e.target.value);
                    setSessionsPage(1);
                  }}
                  className="rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2 text-xs text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none"
                >
                  <option value="">Tất cả chế độ</option>
                  <option value="practice">Chỉ Luyện tập</option>
                  <option value="exam">Chỉ Thi thử</option>
                </select>
              </div>
            </div>

            {sessionsLoading && sessionsData.items.length === 0 ? (
              <div className="flex justify-center py-8 text-slate-500">
                <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
              </div>
            ) : (
              <>
                {/* DESKTOP SESSIONS TABLE (md+) */}
                <div className="hidden md:block overflow-x-auto rounded-2xl border border-slate-200">
                  <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
                    <thead className="bg-slate-50 text-slate-500">
                      <tr>
                        <th className="px-4 py-2.5 font-semibold">Chế độ</th>
                        <th className="px-4 py-2.5 font-semibold">Bộ đề Speaking</th>
                        <th className="px-4 py-2.5 font-semibold">Học viên</th>
                        <th className="px-4 py-2.5 font-semibold">Điểm</th>
                        <th className="px-4 py-2.5 font-semibold">Trạng thái</th>
                        <th className="px-4 py-2.5 font-semibold">Thời gian</th>
                        <th className="px-4 py-2.5 text-right font-semibold">Thao tác</th>
                      </tr>
                    </thead>
                    <tbody className={`divide-y divide-slate-100 bg-white ${sessionsLoading ? 'opacity-60' : ''}`}>
                      {sessionsData.items.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="px-4 py-6 text-center text-slate-400">
                            Chưa có lượt luyện tập hoặc thi thử nào khớp bộ lọc.
                          </td>
                        </tr>
                      ) : (
                        sessionsData.items.map((s) => (
                          <tr key={s.id} className="hover:bg-slate-50/80">
                            <td className="px-4 py-3">
                              <span
                                className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                                  s.mode === 'exam'
                                    ? 'border border-amber-200 bg-amber-50 text-amber-800'
                                    : 'border border-blue-200 bg-blue-50 text-blue-700'
                                }`}
                              >
                                {s.mode === 'exam' ? 'Thi thử' : 'Luyện tập'}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <div className="font-bold text-slate-900">
                                {s.question_set?.title || 'Bộ đề Speaking'}
                              </div>
                              <div className="text-[11px] text-slate-500">
                                {s.mode === 'exam' && s.exam_band
                                  ? s.exam_band
                                  : getExamTypeName(s.question_set?.exam_type)}
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <div className="font-medium text-slate-800">
                                {s.student?.full_name || 'Học viên'}
                              </div>
                              {s.student?.email && (
                                <div className="text-[11px] text-slate-400">{s.student.email}</div>
                              )}
                            </td>
                            <td className="px-4 py-3 font-extrabold text-emerald-600 tabular-nums">
                              {formatScoreValue(s.score_total)}
                            </td>
                            <td className="px-4 py-3">
                              {s.status === 'reviewed' ? (
                                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700">
                                  <CheckCircle2 className="h-3 w-3" /> GV đã duyệt
                                </span>
                              ) : (
                                <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-[11px] font-semibold text-slate-600">
                                  Hoàn thành
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-slate-500">
                              {new Date(s.completed_at || s.started_at).toLocaleString('vi-VN')}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <div className="inline-flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => setSelectedSessionId(s.id)}
                                  className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                                >
                                  Xem
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setDeletingSession(s)}
                                  className="rounded-xl border border-rose-200 bg-rose-50 p-1.5 text-rose-600 hover:bg-rose-100"
                                  title="Xóa lượt làm bài"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {/* MOBILE SESSIONS CARDS (< md) */}
                <div className="space-y-2.5 md:hidden">
                  {sessionsData.items.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-xs text-slate-400">
                      Chưa có lượt luyện tập hoặc thi thử nào khớp bộ lọc.
                    </div>
                  ) : (
                    sessionsData.items.map((s) => (
                      <div
                        key={s.id}
                        className="rounded-2xl border border-slate-200 bg-slate-50/75 p-3.5 space-y-2.5"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span
                                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                  s.mode === 'exam'
                                    ? 'border border-amber-200 bg-amber-50 text-amber-800'
                                    : 'border border-blue-200 bg-blue-50 text-blue-700'
                                }`}
                              >
                                {s.mode === 'exam' ? 'Thi thử' : 'Luyện tập'}
                              </span>
                              <span className="truncate text-xs font-bold text-slate-900">
                                {s.question_set?.title || 'Bộ đề Speaking'}
                              </span>
                            </div>
                            <div className="text-[11px] text-slate-500">
                              {s.student?.full_name || 'Học viên'} ·{' '}
                              {new Date(s.completed_at || s.started_at).toLocaleDateString('vi-VN')}
                            </div>
                          </div>
                          <span
                            className={`rounded-xl border px-2.5 py-1 text-xs font-extrabold tabular-nums ${scoreBadgeBgClass(s.score_total)}`}
                          >
                            {formatScoreValue(s.score_total)}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setSelectedSessionId(s.id)}
                            className="flex-1 rounded-xl border border-slate-200 bg-white py-1.5 text-xs font-semibold text-slate-700"
                          >
                            Xem chi tiết
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeletingSession(s)}
                            className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-1.5 text-rose-600"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <Pagination
                  compact
                  page={sessionsPage}
                  pageSize={SESSIONS_PAGE_SIZE}
                  totalCount={sessionsData.total}
                  onPageChange={setSessionsPage}
                  disabled={sessionsLoading}
                  itemLabel="bài làm"
                />
              </>
            )}
          </div>
        </div>
      )}

      {/* TAB 4: MERGED SCORING MONITORING (1-1 ASSESSMENTS + CLASSROOM EN/VI) */}
      {activeTab === 'monitoring' && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-2">
            <div className="inline-flex rounded-lg bg-slate-100 p-1">
              <button
                type="button"
                onClick={() => setMonitoringSubTab('assessments')}
                className={`rounded-md px-4 py-1.5 text-xs font-semibold transition-colors duration-150 ${
                  monitoringSubTab === 'assessments'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Hội thoại 1-1 ({overviewStats?.savedAssessmentCount ?? 0})
              </button>
              <button
                type="button"
                onClick={() => setMonitoringSubTab('classroom')}
                className={`rounded-md px-4 py-1.5 text-xs font-semibold transition-colors duration-150 ${
                  monitoringSubTab === 'classroom'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Phân tích tiết dạy EN/VI
              </button>
            </div>
            <span className="px-2 text-xs text-slate-500">
              Theo dõi chất lượng chấm điểm 1-1 và tỷ lệ ngôn ngữ giảng dạy trên toàn hệ thống
            </span>
          </div>

          {monitoringSubTab === 'assessments' ? (
            <div className="space-y-6">
              <PageHeader
                eyebrow="GIÁM SÁT CHẤM ĐIỂM"
                title="Quản lý Chấm Hội thoại 1-1"
                subtitle="Theo dõi toàn bộ phiên chấm hội thoại 1-1, chỉnh sửa ghi chú, công bố/ẩn và xóa kết quả chưa lưu."
                pill={<span>{assessmentsData.total} buổi chấm khớp lọc</span>}
                action={
                  (overviewStats?.draftAssessmentCount || 0) > 0 ? (
                    <button
                      type="button"
                      onClick={() => setCleanupDraftsOpen(true)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2 text-xs font-semibold text-amber-800 hover:bg-amber-100 transition-colors duration-150"
                    >
                      <Trash2 className="size-3.5 text-amber-700" />
                      Xóa {overviewStats?.draftAssessmentCount} kết quả chưa lưu
                    </button>
                  ) : undefined
                }
              />

          {/* 4 KPI Cards */}
          <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
            <div className="section-card card-interactive flex items-center gap-3.5 !p-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
                <CheckCircle2 className="h-5 w-5" />
              </div>
              <div>
                <div className="text-2xl font-extrabold text-emerald-600 tabular-nums">
                  {overviewStats?.savedAssessmentCount ?? 0}
                </div>
                <div className="text-xs font-medium text-slate-500">Đã lưu (Công bố)</div>
              </div>
            </div>

            <div className="section-card card-interactive flex items-center gap-3.5 !p-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-50 text-amber-600">
                <FileEdit className="h-5 w-5" />
              </div>
              <div>
                <div className="text-2xl font-extrabold text-amber-600 tabular-nums">
                  {overviewStats?.draftAssessmentCount ?? 0}
                </div>
                <div className="text-xs font-medium text-slate-500">Chưa lưu chính thức</div>
              </div>
            </div>

            <div className="section-card card-interactive flex items-center gap-3.5 !p-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
                <ClipboardCheck className="h-5 w-5" />
              </div>
              <div>
                <div className="text-2xl font-extrabold text-blue-600 tabular-nums">
                  {overviewStats?.avgAssessmentScore ?? '0.0'}
                </div>
                <div className="text-xs font-medium text-slate-500">Điểm TB Hội thoại 1-1</div>
              </div>
            </div>

            <div className="section-card card-interactive flex items-center gap-3.5 !p-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-sky-50 text-sky-600">
                <Search className="h-5 w-5" />
              </div>
              <div>
                <div className="text-2xl font-extrabold text-slate-900 tabular-nums">
                  {assessmentsData.total}
                </div>
                <div className="text-xs font-medium text-slate-500">Kết quả đang lọc</div>
              </div>
            </div>
          </div>

          {/* Filters */}
          <div className="section-card grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={assessSearch}
                onChange={(e) => setAssessSearch(e.target.value)}
                placeholder="Tìm học viên, giáo viên, tiêu đề..."
                className="w-full rounded-xl border border-slate-200 bg-slate-50/80 py-2.5 pl-9 pr-3 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none"
              />
            </div>

            <select
              value={assessTeacherFilter}
              onChange={(e) => {
                setAssessTeacherFilter(e.target.value);
                setAssessPage(1);
              }}
              className="rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2.5 text-sm text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none"
            >
              <option value="">Tất cả giáo viên</option>
              {teacherDirectory
                .filter((t) => t.role === 'teacher')
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.full_name}
                  </option>
                ))}
            </select>

            <select
              value={assessSavedFilter}
              onChange={(e) => {
                setAssessSavedFilter(e.target.value as '' | 'saved' | 'draft');
                setAssessPage(1);
              }}
              className="rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2.5 text-sm text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none"
            >
              <option value="">Mọi trạng thái</option>
              <option value="saved">Đã công bố (Đã lưu)</option>
              <option value="draft">Bản nháp (Chưa lưu)</option>
            </select>

            <select
              value={assessScoreFilter}
              onChange={(e) => {
                setAssessScoreFilter(
                  e.target.value as '' | 'excellent' | 'good' | 'fair' | 'needsWork',
                );
                setAssessPage(1);
              }}
              className="rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2.5 text-sm text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none"
            >
              <option value="">Mọi mức điểm</option>
              <option value="excellent">Xuất sắc (≥ 8.0)</option>
              <option value="good">Khá tốt (6.5 – 7.9)</option>
              <option value="fair">Trung bình (5.0 – 6.4)</option>
              <option value="needsWork">Cần cải thiện (&lt; 5.0)</option>
            </select>
          </div>

          {assessmentsLoading && assessmentsData.items.length === 0 ? (
            <div className="section-card flex items-center justify-center py-12 text-slate-500">
              <Loader2 className="mr-2 h-5 w-5 animate-spin text-blue-600" />
              <span className="text-sm">Đang tải danh sách buổi chấm hội thoại 1-1...</span>
            </div>
          ) : (
            <>
              {/* DESKTOP ASSESSMENTS TABLE (md+) */}
              <div className="section-card !p-0 overflow-hidden hidden md:block">
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
                    <thead className="bg-slate-50 text-slate-500">
                      <tr>
                        <th className="px-4 py-3 font-semibold">Buổi đánh giá</th>
                        <th className="px-4 py-3 font-semibold">Học viên</th>
                        <th className="px-4 py-3 font-semibold">Giáo viên</th>
                        <th className="px-4 py-3 font-semibold">Điểm số</th>
                        <th className="px-4 py-3 font-semibold">Trạng thái</th>
                        <th className="px-4 py-3 text-right font-semibold">Thao tác</th>
                      </tr>
                    </thead>
                    <tbody
                      className={`divide-y divide-slate-100 bg-white ${assessmentsLoading ? 'opacity-60' : ''}`}
                    >
                      {assessmentsData.items.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                            Không có buổi chấm hội thoại 1-1 nào phù hợp bộ lọc.
                          </td>
                        </tr>
                      ) : (
                        assessmentsData.items.map((a) => {
                          const title = a.result_json?.title || 'Chấm hội thoại 1-1';
                          return (
                            <tr key={a.id} className="hover:bg-slate-50/80">
                              <td className="px-4 py-3 max-w-[260px]">
                                <div className="truncate font-bold text-slate-900">{title}</div>
                                <div className="mt-0.5 text-[11px] text-slate-500">
                                  {new Date(a.created_at).toLocaleString('vi-VN')}
                                </div>
                                {a.teacher_note && (
                                  <div className="mt-1 inline-flex max-w-full items-center gap-1 truncate rounded-lg bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-800 border border-amber-200">
                                    <MessageSquareText className="h-3 w-3 shrink-0 text-amber-600" />
                                    <span className="truncate">{a.teacher_note}</span>
                                  </div>
                                )}
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2.5">
                                  <img
                                    src={getAvatarUrl(a.student?.full_name || 'HV', 64)}
                                    alt={a.student?.full_name || 'Học viên'}
                                    className="h-8 w-8 rounded-full border border-slate-200 shrink-0"
                                  />
                                  <div className="min-w-0">
                                    <div className="truncate font-semibold text-slate-900">
                                      {a.student?.full_name || 'Học viên'}
                                    </div>
                                    <div className="truncate text-[11px] text-slate-400">
                                      {a.student?.email || ''}
                                    </div>
                                  </div>
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                <div className="font-medium text-slate-800">
                                  {a.teacher?.full_name || 'Giáo viên'}
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2">
                                  <span
                                    className={`rounded-xl border px-2.5 py-1 text-xs font-extrabold tabular-nums ${scoreBadgeBgClass(a.score_total)}`}
                                  >
                                    {formatScoreValue(a.score_total)}
                                  </span>
                                  {a.score_accuracy != null && (
                                    <span className="text-[11px] text-slate-500 tabular-nums">
                                      PA: {Number(a.score_accuracy).toFixed(1)}
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                {a.saved ? (
                                  <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 font-semibold text-emerald-700">
                                    <Eye className="h-3 w-3" /> Đã công bố
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 font-semibold text-amber-700">
                                    <EyeOff className="h-3 w-3" /> Bản nháp
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-3 text-right">
                                <div className="inline-flex items-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => setSelectedAssessment(a)}
                                    className="rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                                  >
                                    Xem
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleOpenEditAssessment(a)}
                                    className="inline-flex items-center gap-1 rounded-xl border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-[11px] font-semibold text-blue-700 hover:bg-blue-100"
                                  >
                                    <Pencil className="h-3 w-3" />
                                    Sửa
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setDeletingAssessment(a)}
                                    className="rounded-xl border border-rose-200 bg-rose-50 p-1.5 text-rose-600 hover:bg-rose-100"
                                    title="Xóa buổi chấm"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* MOBILE ASSESSMENTS CARDS (< md) */}
              <div className="space-y-3 md:hidden">
                {assessmentsData.items.length === 0 ? (
                  <div className="section-card py-10 text-center text-sm text-slate-500">
                    Không có buổi chấm hội thoại 1-1 nào phù hợp bộ lọc.
                  </div>
                ) : (
                  assessmentsData.items.map((a) => (
                    <div key={a.id} className="section-card space-y-3 !p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-bold text-slate-900">
                            {a.result_json?.title || 'Chấm hội thoại 1-1'}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {new Date(a.created_at).toLocaleString('vi-VN')}
                          </div>
                        </div>
                        <span
                          className={`shrink-0 rounded-xl border px-2.5 py-1 text-xs font-extrabold tabular-nums ${scoreBadgeBgClass(a.score_total)}`}
                        >
                          {formatScoreValue(a.score_total)}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                        <span>
                          HV: <strong className="text-slate-900">{a.student?.full_name || 'N/A'}</strong>
                        </span>
                        <span>·</span>
                        <span>
                          GV: <strong className="text-blue-700">{a.teacher?.full_name || 'N/A'}</strong>
                        </span>
                        {a.saved ? (
                          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                            Đã công bố
                          </span>
                        ) : (
                          <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                            Bản nháp
                          </span>
                        )}
                      </div>

                      {a.teacher_note && (
                        <div className="rounded-xl border border-amber-200 bg-amber-50/80 px-2.5 py-1.5 text-xs text-amber-900">
                          {a.teacher_note}
                        </div>
                      )}

                      <div className="flex items-center gap-2 border-t border-slate-100 pt-2.5">
                        <button
                          type="button"
                          onClick={() => setSelectedAssessment(a)}
                          className="flex-1 rounded-xl border border-slate-200 bg-white py-2 text-xs font-semibold text-slate-700"
                        >
                          Xem chi tiết
                        </button>
                        <button
                          type="button"
                          onClick={() => handleOpenEditAssessment(a)}
                          className="inline-flex flex-1 items-center justify-center gap-1 rounded-xl border border-blue-200 bg-blue-50 py-2 text-xs font-semibold text-blue-700"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          Sửa
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeletingAssessment(a)}
                          className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-rose-600"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <Pagination
                page={assessPage}
                pageSize={ASSESSMENTS_PAGE_SIZE}
                totalCount={assessmentsData.total}
                onPageChange={setAssessPage}
                disabled={assessmentsLoading}
                itemLabel="buổi chấm"
              />
            </>
          )}
            </div>
          ) : classroomLoading && classroomTeachers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-slate-500">
              <Loader2 className="mb-3 h-8 w-8 animate-spin text-blue-600" />
              <p className="text-sm">Đang tải danh sách giáo viên...</p>
            </div>
          ) : (
            <ClassroomAnalysisView
              mode="admin"
              profiles={classroomTeachers}
              lockedProfile={currentUser}
              gpuUrl={gpuUrl}
            />
          )}
        </div>
      )}

      {/* TAB: CLASSES MANAGEMENT */}
      {activeTab === 'classes' && <AdminClassesView currentUser={currentUser} />}

      {/* MODAL: Update Scoring Service URL */}
      <Modal
        open={gpuModalOpen}
        onClose={() => setGpuModalOpen(false)}
        maxWidthClass="max-w-lg"
        title={
          <span className="flex items-center gap-2">
            <Link2 className="h-5 w-5 text-sky-600" />
            Cập nhật kết nối hệ thống chấm điểm
          </span>
        }
        subtitle="Nhập đường dẫn mới khi hệ thống chấm điểm được chuyển sang địa chỉ khác."
      >
        <form onSubmit={handleSaveGpuUrl} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-slate-600">
              Đường dẫn kết nối hệ thống chấm điểm
            </label>
            <input
              type="url"
              required
              value={gpuUrlDraft}
              onChange={(e) => setGpuUrlDraft(e.target.value)}
              placeholder="https://..."
              className="w-full rounded-xl border border-slate-200 bg-slate-50/80 px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setGpuModalOpen(false)}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={savingGpuUrl}
              className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-500 disabled:opacity-50"
            >
              {savingGpuUrl && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Lưu &amp; Kiểm tra
            </button>
          </div>
        </form>
      </Modal>

      {/* MODAL: Create User (Admin-only Center Provisioning) */}
      <Modal
        open={createUserOpen}
        onClose={() => setCreateUserOpen(false)}
        maxWidthClass="max-w-2xl"
        title={
          <span className="flex items-center gap-2">
            <UserPlus className="size-5 text-blue-600" />
            {createdCredential ? 'Cấp tài khoản thành công' : 'Cấp tài khoản mới'}
          </span>
        }
        subtitle={
          createdCredential
            ? 'Sao chép thông tin đăng nhập dưới đây để bàn giao cho người dùng.'
            : 'Chỉ Quản trị viên / Giáo vụ được cấp tài khoản. Việc xếp lớp thực hiện tại mục Quản lý Lớp học.'
        }
      >
        {createdCredential ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 space-y-2 text-xs">
              <div className="flex items-center gap-2 text-sm font-bold text-emerald-800">
                <CheckCircle2 className="size-4 text-emerald-600" />
                Phiếu bàn giao thông tin đăng nhập
              </div>
              <div className="grid gap-2 sm:grid-cols-2 pt-1 text-slate-700">
                <div>
                  <span className="text-slate-500">Họ tên:</span>{' '}
                  <strong className="text-slate-900">{createdCredential.fullName}</strong>
                </div>
                <div>
                  <span className="text-slate-500">Vai trò:</span>{' '}
                  <strong className="text-slate-900">
                    {createdCredential.role === 'student' ? 'Học viên' : 'Giáo viên'}
                  </strong>
                </div>
                {createdCredential.studentCode && (
                  <div>
                    <span className="text-slate-500">Mã học viên:</span>{' '}
                    <strong className="font-mono text-slate-900">{createdCredential.studentCode}</strong>
                  </div>
                )}
                <div>
                  <span className="text-slate-500">Email đăng nhập:</span>{' '}
                  <strong className="font-mono text-slate-900">{createdCredential.email}</strong>
                </div>
                <div className="sm:col-span-2">
                  <span className="text-slate-500">Mật khẩu ban đầu:</span>{' '}
                  <strong className="rounded border border-emerald-300 bg-white px-2 py-0.5 font-mono text-sm text-slate-900">
                    {createdCredential.password}
                  </strong>
                </div>
              </div>
              <p className="pt-1 text-[11px] text-emerald-800">
                Học viên / Giáo viên có thể đăng nhập ngay lập tức và tự đổi mật khẩu trong mục Hồ sơ cá nhân.
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={handleCopyCredentials}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                <Copy className="size-3.5" />
                Sao chép thông tin đăng nhập
              </button>
              <button
                type="button"
                onClick={() => openCreateUserModal(createdCredential.role)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-100"
              >
                <UserPlus className="size-3.5" />
                Cấp tài khoản khác
              </button>
              {createdCredential.role === 'student' && (
                <button
                  type="button"
                  onClick={() => {
                    setCreateUserOpen(false);
                    onNavigate('classes');
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800"
                >
                  <School className="size-3.5" />
                  Đi tới Quản lý Lớp học →
                </button>
              )}
            </div>
          </div>
        ) : (
          <form onSubmit={handleCreateUserSubmit} className="space-y-4">
            {/* Role selector */}
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setNewRole('student')}
                className={`flex items-center gap-2.5 rounded-lg border p-3 text-left transition-colors duration-150 ${
                  newRole === 'student'
                    ? 'border-blue-600 bg-blue-50 text-slate-900'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                }`}
              >
                <GraduationCap
                  className={`size-5 shrink-0 ${newRole === 'student' ? 'text-blue-600' : 'text-slate-400'}`}
                />
                <div>
                  <div className="text-sm font-semibold">Học viên</div>
                  <div className="text-[11px] text-slate-500">Kèm hồ sơ ghi danh</div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setNewRole('teacher')}
                className={`flex items-center gap-2.5 rounded-lg border p-3 text-left transition-colors duration-150 ${
                  newRole === 'teacher'
                    ? 'border-blue-600 bg-blue-50 text-slate-900'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                }`}
              >
                <Presentation
                  className={`size-5 shrink-0 ${newRole === 'teacher' ? 'text-blue-600' : 'text-slate-400'}`}
                />
                <div>
                  <div className="text-sm font-semibold">Giáo viên</div>
                  <div className="text-[11px] text-slate-500">Kích hoạt dạy ngay</div>
                </div>
              </button>
            </div>

            {/* Core account credentials */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  Họ và tên <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={newFullName}
                  onChange={(e) => setNewFullName(e.target.value)}
                  placeholder="Nguyễn Văn A"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  Số điện thoại
                </label>
                <input
                  type="tel"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  placeholder="0901234567"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  Email đăng nhập <span className="text-rose-500">*</span>
                </label>
                <input
                  type="email"
                  required
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="hocvien@trungtam.edu.vn"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                />
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-700">
                    Mật khẩu ban đầu <span className="text-rose-500">*</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => setNewPassword(generateReadablePassword())}
                    className="text-[11px] font-semibold text-blue-600 hover:text-blue-700"
                  >
                    Tạo ngẫu nhiên
                  </button>
                </div>
                <input
                  type="text"
                  required
                  minLength={6}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Tối thiểu 6 ký tự"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-mono text-slate-900 focus:border-blue-600 focus:outline-none"
                />
              </div>
            </div>

            {/* Student Enrollment Metadata */}
            {newRole === 'student' && (
              <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs font-bold text-slate-800">
                  Thông tin ghi danh học viên (không bắt buộc — có thể cập nhật sau)
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">
                      Mã học viên (để trống sẽ tự sinh)
                    </label>
                    <input
                      type="text"
                      value={newStudentCode}
                      onChange={(e) => setNewStudentCode(e.target.value)}
                      placeholder="VD: HV-2026-001"
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-mono text-slate-900 focus:border-blue-600 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">Ngày sinh</label>
                    <input
                      type="date"
                      value={newDob}
                      onChange={(e) => setNewDob(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">
                      Trình độ đầu vào
                    </label>
                    <select
                      value={newEntryLevel}
                      onChange={(e) => setNewEntryLevel(e.target.value as QuestionLevel | '')}
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                    >
                      <option value="">-- Chưa đánh giá --</option>
                      <option value="beginner">Cơ bản</option>
                      <option value="intermediate">Trung cấp</option>
                      <option value="advanced">Nâng cao</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">
                      Mục tiêu IELTS Band (1.0 – 9.0)
                    </label>
                    <input
                      type="number"
                      step="0.5"
                      min="1"
                      max="9"
                      value={newTargetBand}
                      onChange={(e) => setNewTargetBand(e.target.value)}
                      placeholder="VD: 6.5"
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm tabular-nums text-slate-900 focus:border-blue-600 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">
                      Người liên hệ / Phụ huynh
                    </label>
                    <input
                      type="text"
                      value={newGuardianName}
                      onChange={(e) => setNewGuardianName(e.target.value)}
                      placeholder="Họ tên phụ huynh / người liên hệ"
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">
                      SĐT liên hệ / Phụ huynh
                    </label>
                    <input
                      type="tel"
                      value={newGuardianPhone}
                      onChange={(e) => setNewGuardianPhone(e.target.value)}
                      placeholder="0909876543"
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                    />
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600">
                    Ghi chú ghi danh
                  </label>
                  <textarea
                    rows={2}
                    value={newEnrollmentNote}
                    onChange={(e) => setNewEnrollmentNote(e.target.value)}
                    placeholder="Ghi chú nhu cầu học, ca học mong muốn..."
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                  />
                </div>
                <p className="text-[11px] text-slate-500">
                  Sau khi tạo tài khoản, vào mục <strong className="text-slate-700">Quản lý Lớp học</strong> để xếp lớp cho học viên.
                </p>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setCreateUserOpen(false)}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Hủy
              </button>
              <button
                type="submit"
                disabled={creatingUser}
                className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {creatingUser && <Loader2 className="size-3.5 animate-spin" />}
                Tạo tài khoản
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* MODAL: Edit User */}
      <Modal
        open={Boolean(editingUser)}
        onClose={() => setEditingUser(null)}
        maxWidthClass="max-w-lg"
        title={
          <span className="flex items-center gap-2">
            <Pencil className="h-5 w-5 text-blue-600" />
            Cập nhật Tài khoản
          </span>
        }
        subtitle={editingUser ? `${editingUser.full_name} (${editingUser.email})` : undefined}
      >
        <form onSubmit={handleSaveUserEdit} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">Vai trò</label>
              <select
                value={editRole}
                disabled={editingUser?.id === currentUser.id}
                onChange={(e) => setEditRole(e.target.value as UserRole)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2 text-sm text-slate-900 disabled:opacity-60"
              >
                <option value="student">Học viên</option>
                <option value="teacher">Giáo viên</option>
                <option value="admin">Quản trị viên</option>
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">Trạng thái</label>
              <select
                value={editStatus}
                disabled={editingUser?.id === currentUser.id}
                onChange={(e) => setEditStatus(e.target.value as AccountStatus)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2 text-sm text-slate-900 disabled:opacity-60"
              >
                <option value="active">Đang hoạt động</option>
                <option value="pending">Chờ duyệt</option>
                <option value="suspended">Tạm khóa</option>
              </select>
            </div>
          </div>

          {editRole === 'student' && (
            <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 text-pretty">
              Việc xếp học viên vào lớp học được quản lý tập trung tại mục <strong className="text-slate-800">Quản lý Lớp học</strong>.
            </p>
          )}

          {/* Admin Password Reset for non-admin users */}
          {editingUser && editingUser.role !== 'admin' && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
                  <KeyRound className="size-3.5 text-blue-600" />
                  Đặt lại mật khẩu mới (khi người dùng quên)
                </span>
                <button
                  type="button"
                  onClick={() => setResetPasswordDraft(generateReadablePassword())}
                  className="text-[11px] font-semibold text-blue-600 hover:text-blue-700"
                >
                  Tạo ngẫu nhiên
                </button>
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={resetPasswordDraft}
                  onChange={(e) => setResetPasswordDraft(e.target.value)}
                  placeholder="Nhập mật khẩu mới (≥ 6 ký tự)"
                  className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-mono text-slate-900 focus:border-blue-600 focus:outline-none"
                />
                <button
                  type="button"
                  disabled={resettingPassword || resetPasswordDraft.length < 6}
                  onClick={handleResetUserPassword}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-45"
                >
                  {resettingPassword && <Loader2 className="size-3 animate-spin" />}
                  Đặt lại
                </button>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setEditingUser(null)}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={savingUser}
              className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-500 disabled:opacity-50"
            >
              {savingUser && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Lưu thay đổi
            </button>
          </div>
        </form>
      </Modal>

      {/* MODAL: Delete User Confirm */}
      <Modal
        open={Boolean(deletingUser)}
        onClose={() => setDeletingUser(null)}
        maxWidthClass="max-w-md"
        title="Xác nhận xóa tài khoản"
      >
        <div className="space-y-4 text-sm text-slate-600">
          <p>
            Bạn có chắc chắn muốn xóa tài khoản{' '}
            <strong className="text-slate-900">{deletingUser?.full_name}</strong> (
            <span className="font-mono text-xs text-slate-500">{deletingUser?.email}</span>)? Hành
            động này sẽ xóa dữ liệu liên quan và không thể hoàn tác.
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setDeletingUser(null)}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700"
            >
              Hủy
            </button>
            <button
              type="button"
              disabled={deletingUserBusy}
              onClick={handleConfirmDeleteUser}
              className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-500 disabled:opacity-50"
            >
              {deletingUserBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Xóa vĩnh viễn
            </button>
          </div>
        </div>
      </Modal>

      {/* MODAL: Delete Question Set Confirm */}
      <Modal
        open={Boolean(deletingSet)}
        onClose={() => setDeletingSet(null)}
        maxWidthClass="max-w-md"
        title="Xác nhận xóa bộ đề"
      >
        <div className="space-y-4 text-sm text-slate-600">
          <p>
            Xóa bộ đề <strong className="text-slate-900">{deletingSet?.title}</strong> cùng toàn bộ
            câu hỏi và lượt làm bài thuộc bộ đề này?
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setDeletingSet(null)}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700"
            >
              Hủy
            </button>
            <button
              type="button"
              disabled={deletingSetBusy}
              onClick={handleConfirmDeleteSet}
              className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-500 disabled:opacity-50"
            >
              {deletingSetBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Xác nhận xóa
            </button>
          </div>
        </div>
      </Modal>

      {/* MODAL: Delete Practice Session Confirm */}
      <Modal
        open={Boolean(deletingSession)}
        onClose={() => setDeletingSession(null)}
        maxWidthClass="max-w-md"
        title="Xác nhận xóa lượt làm bài"
      >
        <div className="space-y-4 text-sm text-slate-600">
          <p>
            Xóa bài làm{' '}
            <strong className="text-slate-900">
              {deletingSession?.question_set?.title || 'Bộ đề Speaking'}
            </strong>{' '}
            của học viên{' '}
            <strong className="text-slate-900">
              {deletingSession?.student?.full_name || 'Học viên'}
            </strong>
            ? Hành động này không thể hoàn tác.
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setDeletingSession(null)}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700"
            >
              Hủy
            </button>
            <button
              type="button"
              disabled={deletingSessionBusy}
              onClick={handleConfirmDeleteSession}
              className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-500 disabled:opacity-50"
            >
              {deletingSessionBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Xác nhận xóa
            </button>
          </div>
        </div>
      </Modal>

      {/* MODAL: Edit 1-1 Assessment */}
      <Modal
        open={Boolean(editingAssessment)}
        onClose={() => setEditingAssessment(null)}
        maxWidthClass="max-w-lg"
        title={
          <span className="flex items-center gap-2">
            <Pencil className="h-5 w-5 text-blue-600" />
            Chỉnh sửa Buổi chấm Hội thoại 1-1
          </span>
        }
        subtitle={
          editingAssessment
            ? `HV: ${editingAssessment.student?.full_name || 'N/A'} · GV: ${
                editingAssessment.teacher?.full_name || 'N/A'
              }`
            : undefined
        }
      >
        <form onSubmit={handleSaveAssessmentEdit} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">
              Tiêu đề buổi đánh giá
            </label>
            <input
              type="text"
              value={editAssessTitle}
              onChange={(e) => setEditAssessTitle(e.target.value)}
              placeholder="Ví dụ: Hội thoại 1-1 · Tuần 4..."
              className="w-full rounded-xl border border-slate-200 bg-slate-50/80 px-3.5 py-2 text-sm text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">
              Trạng thái hiển thị
            </label>
            <select
              value={editAssessSaved ? 'saved' : 'draft'}
              onChange={(e) => setEditAssessSaved(e.target.value === 'saved')}
              className="w-full rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none"
            >
              <option value="saved">Đã công bố (Hiển thị với Giáo viên &amp; Học viên)</option>
              <option value="draft">Bản nháp (Tạm ẩn khỏi Học viên)</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">
              Ghi chú quản lý / giáo viên
            </label>
            <textarea
              rows={3}
              value={editAssessNote}
              onChange={(e) => setEditAssessNote(e.target.value)}
              placeholder="Nhập ghi chú bổ sung cho buổi đánh giá..."
              className="w-full rounded-xl border border-slate-200 bg-slate-50/80 px-3.5 py-2 text-sm text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setEditingAssessment(null)}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={savingAssess}
              className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-500 disabled:opacity-50"
            >
              {savingAssess && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Lưu cập nhật
            </button>
          </div>
        </form>
      </Modal>

      {/* MODAL: Delete 1-1 Assessment Confirm */}
      <Modal
        open={Boolean(deletingAssessment)}
        onClose={() => setDeletingAssessment(null)}
        maxWidthClass="max-w-md"
        title="Xác nhận xóa buổi chấm 1-1"
      >
        <div className="space-y-4 text-sm text-slate-600">
          <p>
            Xóa vĩnh viễn buổi chấm{' '}
            <strong className="text-slate-900">
              {deletingAssessment?.result_json?.title || 'Chấm hội thoại 1-1'}
            </strong>{' '}
            của học viên{' '}
            <strong className="text-slate-900">
              {deletingAssessment?.student?.full_name || 'Học viên'}
            </strong>
            ?
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setDeletingAssessment(null)}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700"
            >
              Hủy
            </button>
            <button
              type="button"
              disabled={deletingAssessBusy}
              onClick={handleConfirmDeleteAssessment}
              className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-500 disabled:opacity-50"
            >
              {deletingAssessBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Xác nhận xóa
            </button>
          </div>
        </div>
      </Modal>

      {/* MODAL: Cleanup Unsaved 1-1 Assessments */}
      <Modal
        open={cleanupDraftsOpen}
        onClose={() => setCleanupDraftsOpen(false)}
        maxWidthClass="max-w-md"
        title="Xóa các kết quả chấm 1-1 chưa lưu"
      >
        <div className="space-y-4 text-sm text-slate-600">
          <p>
            Hệ thống phát hiện{' '}
            <strong className="text-amber-700 tabular-nums">
              {overviewStats?.draftAssessmentCount ?? 0} kết quả
            </strong>{' '}
            chưa được lưu chính thức (có thể do giáo viên hủy giữa chừng). Bạn có muốn xóa toàn bộ
            các kết quả chưa lưu này?
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setCleanupDraftsOpen(false)}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700"
            >
              Hủy
            </button>
            <button
              type="button"
              disabled={cleaningDraftsBusy}
              onClick={handleConfirmCleanupDrafts}
              className="inline-flex items-center gap-1.5 rounded-xl bg-amber-600 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-500 disabled:opacity-50"
            >
              {cleaningDraftsBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Xác nhận xóa
            </button>
          </div>
        </div>
      </Modal>

      <AssessmentDetailModal
        assessment={selectedAssessment}
        onClose={() => setSelectedAssessment(null)}
      />

      <PracticeDetailModal
        sessionId={selectedSessionId}
        canReview={false}
        onClose={() => setSelectedSessionId(null)}
      />

      <StudentRecordModal
        studentId={viewingStudentId}
        canEditEnrollment
        canReviewSubmissions
        onClose={() => setViewingStudentId(null)}
        onUpdated={() => {
          void loadUsersPage();
          void loadOverviewAndDirectory();
        }}
      />
    </div>
  );
}
