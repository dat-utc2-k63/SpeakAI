'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  Edit3,
  Loader2,
  Plus,
  Search,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react';
import {
  addClassMembersBulk,
  createClass,
  deleteClass,
  fetchActiveProfilesForRoster,
  fetchClassesPage,
  fetchClassMembers,
  generateClassCode,
  removeClassMember,
  updateClass,
  updateClassMember,
} from '@/lib/classes';
import { getExamTypeName } from '@/lib/utils';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/AnalyticsCharts';
import { Pagination } from '@/components/ui/Pagination';
import { ClassWorkspaceView } from '@/components/teacher/ClassWorkspaceView';
import { useToast } from '@/components/ToastProvider';
import type {
  ClassMemberRecord,
  ClassMemberRole,
  ClassRecord,
  ClassStatus,
  ExamType,
  Profile,
} from '@/lib/types';

interface AdminClassesViewProps {
  currentUser: Profile;
}

const PAGE_SIZE = 10;

export function AdminClassesView({ currentUser }: AdminClassesViewProps) {
  const { showToast } = useToast();

  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);
  const [classes, setClasses] = useState<ClassRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [courseFilter, setCourseFilter] = useState<'' | ExamType>('');
  const [statusFilter, setStatusFilter] = useState<'' | ClassStatus>('');
  const [loading, setLoading] = useState(true);

  // Create / Edit Class modal
  const [formOpen, setFormOpen] = useState(false);
  const [editingClass, setEditingClass] = useState<ClassRecord | null>(null);
  const [fName, setFName] = useState('');
  const [fCode, setFCode] = useState('');
  const [fCourseType, setFCourseType] = useState<ExamType>('ielts');
  const [fTargetBand, setFTargetBand] = useState('6.5');
  const [fSchedule, setFSchedule] = useState('');
  const [fStatus, setFStatus] = useState<ClassStatus>('active');
  const [fStartDate, setFStartDate] = useState('');
  const [fEndDate, setFEndDate] = useState('');
  const [fDescription, setFDescription] = useState('');
  const [savingForm, setSavingForm] = useState(false);

  // Roster Modal
  const [rosterClass, setRosterClass] = useState<ClassRecord | null>(null);
  const [rosterMembers, setRosterMembers] = useState<ClassMemberRecord[]>([]);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [allTeachers, setAllTeachers] = useState<Profile[]>([]);
  const [allStudents, setAllStudents] = useState<Profile[]>([]);
  const [assignedStudentIds, setAssignedStudentIds] = useState<Set<string>>(new Set());
  const [addTeacherId, setAddTeacherId] = useState('');
  const [addTeacherRole, setAddTeacherRole] = useState<'lead_teacher' | 'assistant'>('lead_teacher');
  const [selectedNewStudentIds, setSelectedNewStudentIds] = useState<Set<string>>(new Set());
  const [studentSearch, setStudentSearch] = useState('');
  const [onlyUnassignedStudents, setOnlyUnassignedStudents] = useState(false);
  const [rosterSaving, setRosterSaving] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => window.clearTimeout(t);
  }, [search]);

  const loadClasses = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchClassesPage({
        page,
        pageSize: PAGE_SIZE,
        search: debouncedSearch,
        courseType: courseFilter,
        status: statusFilter,
      });
      setClasses(res.items);
      setTotal(res.total);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Không thể tải danh sách lớp học', 'danger');
    } finally {
      setLoading(false);
    }
  }, [courseFilter, debouncedSearch, page, showToast, statusFilter]);

  useEffect(() => {
    loadClasses();
  }, [loadClasses]);

  const openCreateModal = () => {
    setEditingClass(null);
    setFName('');
    setFCode(generateClassCode('ielts'));
    setFCourseType('ielts');
    setFTargetBand('6.5');
    setFSchedule('');
    setFStatus('active');
    setFStartDate('');
    setFEndDate('');
    setFDescription('');
    setFormOpen(true);
  };

  const openEditModal = (cls: ClassRecord) => {
    setEditingClass(cls);
    setFName(cls.name);
    setFCode(cls.code);
    setFCourseType(cls.course_type);
    setFTargetBand(cls.target_band != null ? String(cls.target_band) : '');
    setFSchedule(cls.schedule_text || '');
    setFStatus(cls.status);
    setFStartDate(cls.start_date || '');
    setFEndDate(cls.end_date || '');
    setFDescription(cls.description || '');
    setFormOpen(true);
  };

  const handleSaveClass = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fName.trim() || !fCode.trim()) return;
    setSavingForm(true);
    try {
      const payload = {
        name: fName.trim(),
        code: fCode.trim().toUpperCase(),
        course_type: fCourseType,
        target_band: fTargetBand ? Number(fTargetBand) : null,
        schedule_text: fSchedule.trim() || null,
        status: fStatus,
        start_date: fStartDate || null,
        end_date: fEndDate || null,
        description: fDescription.trim() || null,
      };
      if (editingClass) {
        await updateClass(editingClass.id, payload);
        showToast('Đã cập nhật thông tin lớp học.', 'success');
      } else {
        await createClass({ ...payload, created_by: currentUser.id });
        showToast('Đã tạo lớp học mới!', 'success');
      }
      setFormOpen(false);
      await loadClasses();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Lỗi lưu lớp học', 'danger');
    } finally {
      setSavingForm(false);
    }
  };

  const handleDeleteClass = async (cls: ClassRecord) => {
    if (!window.confirm(`Xóa lớp "${cls.name}" (${cls.code})? Hành động này không thể hoàn tác.`)) return;
    try {
      await deleteClass(cls.id);
      showToast('Đã xóa lớp học.', 'info');
      await loadClasses();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Lỗi xóa lớp học', 'danger');
    }
  };

  const openRosterModal = async (cls: ClassRecord) => {
    setRosterClass(cls);
    setRosterLoading(true);
    setAddTeacherId('');
    setSelectedNewStudentIds(new Set());
    setStudentSearch('');
    try {
      const [members, profilesBundle] = await Promise.all([
        fetchClassMembers(cls.id),
        fetchActiveProfilesForRoster(),
      ]);
      setRosterMembers(members);
      setAllTeachers(profilesBundle.teachers);
      setAllStudents(profilesBundle.students);
      setAssignedStudentIds(profilesBundle.assignedStudentIds);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Lỗi tải danh sách thành viên', 'danger');
    } finally {
      setRosterLoading(false);
    }
  };

  const refreshRoster = async () => {
    if (!rosterClass) return;
    const [members, profilesBundle] = await Promise.all([
      fetchClassMembers(rosterClass.id),
      fetchActiveProfilesForRoster(),
    ]);
    setRosterMembers(members);
    setAssignedStudentIds(profilesBundle.assignedStudentIds);
    void loadClasses();
  };

  const handleAddTeacher = async () => {
    if (!rosterClass || !addTeacherId) return;
    setRosterSaving(true);
    try {
      await addClassMembersBulk(rosterClass.id, [addTeacherId], addTeacherRole);
      setAddTeacherId('');
      showToast('Đã phân công giáo viên vào lớp.', 'success');
      await refreshRoster();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Lỗi thêm giáo viên', 'danger');
    } finally {
      setRosterSaving(false);
    }
  };

  const handleAddStudents = async () => {
    if (!rosterClass || selectedNewStudentIds.size === 0) return;
    setRosterSaving(true);
    try {
      await addClassMembersBulk(rosterClass.id, Array.from(selectedNewStudentIds), 'student');
      setSelectedNewStudentIds(new Set());
      showToast(`Đã thêm ${selectedNewStudentIds.size} học viên vào lớp.`, 'success');
      await refreshRoster();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Lỗi thêm học viên', 'danger');
    } finally {
      setRosterSaving(false);
    }
  };

  const handleChangeMemberRole = async (memberId: string, nextRole: ClassMemberRole) => {
    try {
      await updateClassMember(memberId, { member_role: nextRole });
      showToast('Đã cập nhật vai trò trong lớp.', 'success');
      await refreshRoster();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Lỗi cập nhật vai trò', 'danger');
    }
  };

  const handleRemoveMember = async (memberId: string) => {
    try {
      await removeClassMember(memberId);
      showToast('Đã gỡ thành viên khỏi lớp.', 'info');
      await refreshRoster();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Lỗi gỡ thành viên', 'danger');
    }
  };

  const existingMemberIds = useMemo(
    () => new Set(rosterMembers.map((m) => m.user_id)),
    [rosterMembers],
  );

  const candidateStudents = useMemo(() => {
    const q = studentSearch.trim().toLowerCase();
    return allStudents.filter((s) => {
      if (existingMemberIds.has(s.id)) return false;
      if (onlyUnassignedStudents && assignedStudentIds.has(s.id)) return false;
      if (q && !s.full_name.toLowerCase().includes(q) && !s.email.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [allStudents, assignedStudentIds, existingMemberIds, onlyUnassignedStudents, studentSearch]);

  if (selectedClassId) {
    return (
      <ClassWorkspaceView
        classId={selectedClassId}
        currentUser={currentUser}
        onBack={() => {
          setSelectedClassId(null);
          void loadClasses();
        }}
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="QUẢN TRỊ ĐÀO TẠO"
        title="Quản lý Lớp học & Phân công"
        subtitle="Tạo lớp, phân công Giáo viên chính / Trợ giảng, xếp học viên vào nhiều lớp và theo dõi chất lượng giảng dạy từng lớp."
        pill={<span className="tabular-nums">{total} lớp học</span>}
        action={
          <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 transition-colors duration-150"
          >
            <Plus className="size-4" />
            Tạo lớp mới
          </button>
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
            placeholder="Tìm theo tên lớp, mã lớp hoặc lịch học..."
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-600 focus:outline-none"
          />
        </div>
        <select
          value={courseFilter}
          onChange={(e) => {
            setCourseFilter(e.target.value as '' | ExamType);
            setPage(1);
          }}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
        >
          <option value="">Tất cả khóa học</option>
          <option value="ielts">IELTS Speaking</option>
          <option value="vstep">VSTEP Speaking</option>
          <option value="toeic">TOEIC Speaking</option>
          <option value="general">Luyện tập chung</option>
        </select>
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value as '' | ClassStatus);
            setPage(1);
          }}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
        >
          <option value="">Tất cả trạng thái</option>
          <option value="active">Đang hoạt động</option>
          <option value="completed">Đã hoàn thành</option>
          <option value="archived">Đã lưu trữ</option>
        </select>
      </div>

      {/* Class QA List */}
      {loading && classes.length === 0 ? (
        <div className="section-card flex items-center justify-center py-14 text-slate-500">
          <Loader2 className="mr-2 size-5 animate-spin text-blue-600" />
          <span className="text-sm">Đang tải danh sách lớp học...</span>
        </div>
      ) : classes.length === 0 ? (
        <div className="section-card py-14 text-center space-y-3">
          <p className="text-sm text-slate-600">Chưa có lớp học nào khớp bộ lọc hiện tại.</p>
          <button
            type="button"
            onClick={openCreateModal}
            className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800"
          >
            Tạo lớp học đầu tiên
          </button>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-semibold">Lớp học</th>
                  <th className="px-4 py-3 font-semibold">Giáo viên / Trợ giảng</th>
                  <th className="px-4 py-3 font-semibold text-center">Sĩ số</th>
                  <th className="px-4 py-3 font-semibold text-center">Band TB</th>
                  <th className="px-4 py-3 font-semibold text-center">EN % TB</th>
                  <th className="px-4 py-3 font-semibold text-center">Chờ duyệt</th>
                  <th className="px-4 py-3 font-semibold text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {classes.map((cls) => (
                  <tr key={cls.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-semibold text-slate-900">{cls.name}</span>
                        <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-600">
                          {cls.code}
                        </span>
                      </div>
                      <div className="mt-0.5 text-[11px] text-slate-500">
                        {getExamTypeName(cls.course_type)}
                        {cls.target_band != null ? ` · Mục tiêu ${Number(cls.target_band).toFixed(1)}` : ''}
                        {cls.schedule_text ? ` · ${cls.schedule_text}` : ''}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {cls.teacher_names && cls.teacher_names.length > 0 ? (
                        cls.teacher_names.join(', ')
                      ) : (
                        <span className="text-amber-700 font-medium">Chưa phân công</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center font-semibold text-slate-900 tabular-nums">
                      {cls.student_count ?? 0}
                    </td>
                    <td className="px-4 py-3 text-center font-bold text-emerald-700 tabular-nums">
                      {cls.avg_band != null ? cls.avg_band.toFixed(1) : '--'}
                    </td>
                    <td className="px-4 py-3 text-center font-semibold text-blue-600 tabular-nums">
                      {cls.avg_en_percent != null ? `${cls.avg_en_percent.toFixed(0)}%` : '--'}
                    </td>
                    <td className="px-4 py-3 text-center tabular-nums">
                      {(cls.pending_review_count || 0) > 0 ? (
                        <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 font-semibold text-amber-800">
                          {cls.pending_review_count}
                        </span>
                      ) : (
                        <span className="text-slate-400">0</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => openRosterModal(cls)}
                          className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1.5 font-semibold text-blue-700 hover:bg-blue-100 transition-colors duration-150"
                        >
                          <Users className="size-3.5" />
                          Xếp lớp
                        </button>
                        <button
                          type="button"
                          onClick={() => setSelectedClassId(cls.id)}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-semibold text-slate-700 hover:bg-slate-50 transition-colors duration-150"
                        >
                          Mở lớp
                          <ArrowRight className="size-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => openEditModal(cls)}
                          aria-label={`Chỉnh sửa lớp ${cls.name}`}
                          className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-50"
                        >
                          <Edit3 className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteClass(cls)}
                          aria-label={`Xóa lớp ${cls.name}`}
                          className="rounded-lg border border-rose-200 bg-rose-50 p-1.5 text-rose-600 hover:bg-rose-100"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pagination
            compact
            page={page}
            pageSize={PAGE_SIZE}
            totalCount={total}
            onPageChange={setPage}
            disabled={loading}
            itemLabel="lớp học"
          />
        </>
      )}

      {/* MODAL: CREATE / EDIT CLASS */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        maxWidthClass="max-w-lg"
        title={editingClass ? `Chỉnh sửa lớp ${editingClass.code}` : 'Tạo Lớp học mới'}
      >
        <form onSubmit={handleSaveClass} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-semibold text-slate-700">
                Tên lớp học <span className="text-rose-600">*</span>
              </label>
              <input
                type="text"
                required
                value={fName}
                onChange={(e) => setFName(e.target.value)}
                placeholder="VD: IELTS Speaking 6.5 - Tối 2/4/6"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-600 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">
                Mã lớp <span className="text-rose-600">*</span>
              </label>
              <input
                type="text"
                required
                value={fCode}
                onChange={(e) => setFCode(e.target.value.toUpperCase())}
                placeholder="IELTS-K05"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm uppercase focus:border-blue-600 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">Chương trình</label>
              <select
                value={fCourseType}
                onChange={(e) => setFCourseType(e.target.value as ExamType)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-600 focus:outline-none"
              >
                <option value="ielts">IELTS Speaking</option>
                <option value="vstep">VSTEP Speaking</option>
                <option value="toeic">TOEIC Speaking</option>
                <option value="general">Giao tiếp chung</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">
                Mục tiêu Band
              </label>
              <input
                type="number"
                step="0.5"
                min={1}
                max={9}
                value={fTargetBand}
                onChange={(e) => setFTargetBand(e.target.value)}
                placeholder="6.5"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm tabular-nums focus:border-blue-600 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">Trạng thái</label>
              <select
                value={fStatus}
                onChange={(e) => setFStatus(e.target.value as ClassStatus)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-600 focus:outline-none"
              >
                <option value="active">Đang hoạt động</option>
                <option value="completed">Đã hoàn thành</option>
                <option value="archived">Lưu trữ</option>
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">Lịch học</label>
            <input
              type="text"
              value={fSchedule}
              onChange={(e) => setFSchedule(e.target.value)}
              placeholder="VD: Thứ 2 - 4 - 6 · 19:30 - 21:00"
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-600 focus:outline-none"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">Ngày khai giảng</label>
              <input
                type="date"
                value={fStartDate}
                onChange={(e) => setFStartDate(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-600 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">Ngày kết thúc dự kiến</label>
              <input
                type="date"
                value={fEndDate}
                onChange={(e) => setFEndDate(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-600 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">Mô tả / Ghi chú</label>
            <textarea
              rows={2}
              value={fDescription}
              onChange={(e) => setFDescription(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-600 focus:outline-none"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setFormOpen(false)}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={savingForm}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {savingForm && <Loader2 className="size-3.5 animate-spin" />}
              {editingClass ? 'Lưu thay đổi' : 'Tạo lớp học'}
            </button>
          </div>
        </form>
      </Modal>

      {/* MODAL: MANAGE CLASS ROSTER */}
      <Modal
        open={Boolean(rosterClass)}
        onClose={() => setRosterClass(null)}
        maxWidthClass="max-w-4xl"
        title={rosterClass ? `Phân công & Xếp lớp: ${rosterClass.name}` : 'Xếp lớp'}
        subtitle={rosterClass ? `Mã lớp ${rosterClass.code}` : undefined}
      >
        {rosterLoading ? (
          <div className="flex items-center justify-center py-12 text-slate-500">
            <Loader2 className="mr-2 size-5 animate-spin text-blue-600" />
            Đang tải thành viên...
          </div>
        ) : (
          <div className="space-y-6">
            {/* Section 1: Teachers & Assistants */}
            <div className="space-y-3">
              <h4 className="text-xs font-semibold uppercase text-slate-600">
                1. Giáo viên chính &amp; Trợ giảng
              </h4>
              <div className="flex flex-wrap gap-2">
                <select
                  value={addTeacherId}
                  onChange={(e) => setAddTeacherId(e.target.value)}
                  className="flex-1 min-w-[200px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs focus:border-blue-600 focus:outline-none"
                >
                  <option value="">-- Chọn giáo viên đang hoạt động --</option>
                  {allTeachers
                    .filter((t) => !existingMemberIds.has(t.id))
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.full_name} ({t.email})
                      </option>
                    ))}
                </select>
                <select
                  value={addTeacherRole}
                  onChange={(e) =>
                    setAddTeacherRole(e.target.value as 'lead_teacher' | 'assistant')
                  }
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs focus:border-blue-600 focus:outline-none"
                >
                  <option value="lead_teacher">Giáo viên chính</option>
                  <option value="assistant">Trợ giảng</option>
                </select>
                <button
                  type="button"
                  disabled={!addTeacherId || rosterSaving}
                  onClick={handleAddTeacher}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-45"
                >
                  <UserPlus className="size-3.5" />
                  Thêm GV
                </button>
              </div>

              <div className="space-y-1.5">
                {rosterMembers
                  .filter((m) => m.member_role !== 'student')
                  .map((m) => (
                    <div
                      key={m.id}
                      className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs"
                    >
                      <div className="min-w-0">
                        <span className="font-semibold text-slate-900">{m.profile?.full_name}</span>
                        <span className="ml-2 text-slate-500">{m.profile?.email}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <select
                          value={m.member_role}
                          onChange={(e) =>
                            handleChangeMemberRole(m.id, e.target.value as ClassMemberRole)
                          }
                          aria-label="Vai trò giáo viên trong lớp"
                          className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs"
                        >
                          <option value="lead_teacher">GV chính</option>
                          <option value="assistant">Trợ giảng</option>
                        </select>
                        <button
                          type="button"
                          onClick={() => handleRemoveMember(m.id)}
                          aria-label="Gỡ giáo viên khỏi lớp"
                          className="rounded-md border border-rose-200 bg-rose-50 p-1 text-rose-600 hover:bg-rose-100"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
              </div>
            </div>

            {/* Section 2: Students */}
            <div className="grid gap-4 lg:grid-cols-2 border-t border-slate-200 pt-4">
              <div className="space-y-2.5">
                <h4 className="text-xs font-semibold uppercase text-slate-600">
                  2. Học viên trong lớp (
                  {rosterMembers.filter((m) => m.member_role === 'student').length})
                </h4>
                <div className="max-h-64 overflow-y-auto space-y-1.5 pr-1">
                  {rosterMembers.filter((m) => m.member_role === 'student').length === 0 ? (
                    <p className="rounded-lg border border-dashed border-slate-200 p-4 text-center text-xs text-slate-500">
                      Chưa có học viên nào trong lớp.
                    </p>
                  ) : (
                    rosterMembers
                      .filter((m) => m.member_role === 'student')
                      .map((m) => (
                        <div
                          key={m.id}
                          className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs"
                        >
                          <div className="min-w-0">
                            <div className="truncate font-semibold text-slate-900">
                              {m.profile?.full_name}
                            </div>
                            <div className="truncate text-[11px] text-slate-500">
                              {m.profile?.email}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleRemoveMember(m.id)}
                            aria-label={`Gỡ ${m.profile?.full_name} khỏi lớp`}
                            className="rounded-md border border-rose-200 bg-rose-50 p-1 text-rose-600 hover:bg-rose-100 shrink-0"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                      ))
                  )}
                </div>
              </div>

              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-xs font-semibold uppercase text-slate-600">
                    Thêm Học viên vào lớp
                  </h4>
                  <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={onlyUnassignedStudents}
                      onChange={(e) => setOnlyUnassignedStudents(e.target.checked)}
                      className="rounded accent-blue-600"
                    />
                    Chỉ chưa có lớp
                  </label>
                </div>

                <input
                  type="text"
                  value={studentSearch}
                  onChange={(e) => setStudentSearch(e.target.value)}
                  placeholder="Tìm tên hoặc email học viên..."
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs focus:border-blue-600 focus:outline-none"
                />

                <div className="max-h-52 overflow-y-auto space-y-1 pr-1">
                  {candidateStudents.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-slate-200 p-4 text-center text-xs text-slate-500">
                      Không có học viên phù hợp để thêm.
                    </p>
                  ) : (
                    candidateStudents.map((s) => {
                      const checked = selectedNewStudentIds.has(s.id);
                      return (
                        <label
                          key={s.id}
                          className={`flex cursor-pointer items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs transition-colors duration-150 ${
                            checked
                              ? 'border-blue-500 bg-blue-50'
                              : 'border-slate-200 bg-white hover:bg-slate-50'
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() =>
                                setSelectedNewStudentIds((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(s.id)) next.delete(s.id);
                                  else next.add(s.id);
                                  return next;
                                })
                              }
                              className="rounded accent-blue-600"
                            />
                            <div className="min-w-0">
                              <div className="truncate font-medium text-slate-900">{s.full_name}</div>
                              <div className="truncate text-[10px] text-slate-500">{s.email}</div>
                            </div>
                          </div>
                          {!assignedStudentIds.has(s.id) && (
                            <span className="rounded bg-amber-50 border border-amber-200 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 shrink-0">
                              Chưa có lớp
                            </span>
                          )}
                        </label>
                      );
                    })
                  )}
                </div>

                <button
                  type="button"
                  disabled={selectedNewStudentIds.size === 0 || rosterSaving}
                  onClick={handleAddStudents}
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-45"
                >
                  <CheckCircle2 className="size-3.5" />
                  Thêm {selectedNewStudentIds.size} học viên đã chọn
                </button>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
