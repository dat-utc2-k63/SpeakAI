'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  Award,
  Calendar,
  CheckCircle2,
  ClipboardCheck,
  Edit3,
  GraduationCap,
  Loader2,
  Mic,
  Phone,
  Save,
  School,
  User,
  X,
} from 'lucide-react';
import { adminUpdateStudentEnrollment } from '@/lib/auth';
import { fetchStudentFullRecord, type StudentFullRecord } from '@/lib/studentRecord';
import {
  formatScoreValue,
  getAvatarUrl,
  getExamTypeName,
  getLevelLabel,
  hasVoiceEnrolled,
  scoreBadgeBgClass,
} from '@/lib/utils';
import { Modal } from '@/components/ui/Modal';
import { PracticeDetailModal } from '@/components/PracticeDetailModal';
import { AssessmentCard, AssessmentDetailModal } from '@/components/AssessmentDetailModal';
import { useToast } from '@/components/ToastProvider';
import type { Assessment, QuestionLevel } from '@/lib/types';

interface StudentRecordModalProps {
  studentId: string | null;
  canEditEnrollment?: boolean;
  canReviewSubmissions?: boolean;
  onClose: () => void;
  onUpdated?: () => void;
}

function getMembershipStatusBadge(status: string) {
  if (status === 'completed') {
    return (
      <span className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
        Đã hoàn thành
      </span>
    );
  }
  if (status === 'dropped') {
    return (
      <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
        Đã ngừng học
      </span>
    );
  }
  return (
    <span className="rounded-md border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700">
      Đang học
    </span>
  );
}

export function StudentRecordModal({
  studentId,
  canEditEnrollment = false,
  canReviewSubmissions = false,
  onClose,
  onUpdated,
}: StudentRecordModalProps) {
  const { showToast } = useToast();
  const [loading, setLoading] = useState(false);
  const [record, setRecord] = useState<StudentFullRecord | null>(null);
  const [tab, setTab] = useState<'enrollment' | 'history'>('enrollment');

  // Inline edit state (Admin only)
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editFullName, setEditFullName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editStudentCode, setEditStudentCode] = useState('');
  const [editDob, setEditDob] = useState('');
  const [editEntryLevel, setEditEntryLevel] = useState<QuestionLevel | ''>('');
  const [editTargetBand, setEditTargetBand] = useState('');
  const [editGuardianName, setEditGuardianName] = useState('');
  const [editGuardianPhone, setEditGuardianPhone] = useState('');
  const [editNote, setEditNote] = useState('');

  // Drill-down detail modals
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [selectedAssessment, setSelectedAssessment] = useState<Assessment | null>(null);

  const loadRecord = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const data = await fetchStudentFullRecord(id);
      setRecord(data);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Không thể tải hồ sơ học viên', 'danger');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    if (!studentId) {
      setRecord(null);
      setEditing(false);
      setTab('enrollment');
      return;
    }
    void loadRecord(studentId);
  }, [studentId, loadRecord]);

  const startEdit = () => {
    if (!record) return;
    const p = record.profile;
    setEditFullName(p.full_name || '');
    setEditPhone(p.phone || '');
    setEditStudentCode(p.student_code || '');
    setEditDob(p.date_of_birth || '');
    setEditEntryLevel((p.entry_level as QuestionLevel) || '');
    setEditTargetBand(p.target_band != null ? String(p.target_band) : '');
    setEditGuardianName(p.guardian_name || '');
    setEditGuardianPhone(p.guardian_phone || '');
    setEditNote(p.enrollment_note || '');
    setEditing(true);
  };

  const handleSaveEnrollment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!record || !editFullName.trim()) {
      showToast('Họ tên học viên không được để trống.', 'danger');
      return;
    }
    let parsedBand: number | null = null;
    if (editTargetBand.trim() !== '') {
      const n = Number(editTargetBand);
      if (Number.isNaN(n) || n < 1.0 || n > 9.0) {
        showToast('Mục tiêu Band IELTS phải từ 1.0 đến 9.0.', 'danger');
        return;
      }
      parsedBand = Math.round(n * 2) / 2;
    }

    setSaving(true);
    try {
      await adminUpdateStudentEnrollment(record.profile.id, {
        full_name: editFullName.trim(),
        phone: editPhone.trim() || null,
        student_code: editStudentCode.trim() || null,
        date_of_birth: editDob.trim() || null,
        entry_level: editEntryLevel || null,
        target_band: parsedBand,
        guardian_name: editGuardianName.trim() || null,
        guardian_phone: editGuardianPhone.trim() || null,
        enrollment_note: editNote.trim() || null,
      });
      showToast('Đã cập nhật thông tin ghi danh học viên!', 'success');
      setEditing(false);
      await loadRecord(record.profile.id);
      onUpdated?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Lỗi cập nhật thông tin ghi danh';
      showToast(
        msg.toLowerCase().includes('column') && msg.toLowerCase().includes('does not exist')
          ? 'Hệ thống dữ liệu ghi danh đang cần cập nhật. Vui lòng liên hệ kỹ thuật viên.'
          : msg,
        'danger',
      );
    } finally {
      setSaving(false);
    }
  };

  const prof = record?.profile;
  const voiceOk = hasVoiceEnrolled(prof);

  return (
    <>
      <Modal
        open={Boolean(studentId)}
        onClose={onClose}
        maxWidthClass="max-w-4xl"
        title={
          <span className="flex items-center gap-2">
            <GraduationCap className="size-5 text-blue-600" />
            Hồ sơ Học viên{prof ? ` · ${prof.full_name}` : ''}
          </span>
        }
        subtitle={
          prof
            ? `${prof.student_code ? `Mã HV: ${prof.student_code} · ` : ''}${prof.email}`
            : undefined
        }
      >
        {loading && !record ? (
          <div className="flex flex-col items-center justify-center py-14 text-slate-500">
            <Loader2 className="mb-2 size-7 animate-spin text-blue-600" />
            <span className="text-sm">Đang tải hồ sơ học viên...</span>
          </div>
        ) : !record || !prof ? (
          <div className="py-10 text-center text-sm text-slate-500">
            Không tìm thấy thông tin học viên.
          </div>
        ) : (
          <div className="space-y-5">
            {/* Header Summary Bar */}
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center gap-3.5 min-w-0">
                <img
                  src={getAvatarUrl(prof.full_name, 96)}
                  alt={prof.full_name}
                  className="size-12 rounded-full border border-slate-200 object-cover shrink-0"
                />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-base font-bold text-slate-900">{prof.full_name}</span>
                    {prof.student_code && (
                      <span className="rounded border border-slate-200 bg-white px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-700">
                        {prof.student_code}
                      </span>
                    )}
                    <span
                      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold ${
                        voiceOk
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          : 'border-slate-200 bg-white text-slate-500'
                      }`}
                    >
                      <Mic className="size-3" />
                      {voiceOk ? 'Đã có mẫu giọng' : 'Chưa có mẫu giọng'}
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500">
                    {prof.email}
                    {prof.phone ? ` · ${prof.phone}` : ''}
                  </div>
                </div>
              </div>

              <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1">
                <button
                  type="button"
                  onClick={() => setTab('enrollment')}
                  className={`rounded-md px-3.5 py-1.5 text-xs font-semibold transition-colors duration-150 ${
                    tab === 'enrollment'
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Thông tin ghi danh
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditing(false);
                    setTab('history');
                  }}
                  className={`rounded-md px-3.5 py-1.5 text-xs font-semibold transition-colors duration-150 ${
                    tab === 'history'
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Lịch sử học tập ({record.totalCompletedCount})
                </button>
              </div>
            </div>

            {tab === 'enrollment' ? (
              editing && canEditEnrollment ? (
                <form onSubmit={handleSaveEnrollment} className="space-y-4">
                  <div className="grid gap-3.5 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-700">
                        Họ và tên <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        value={editFullName}
                        onChange={(e) => setEditFullName(e.target.value)}
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-700">
                        Mã học viên
                      </label>
                      <input
                        type="text"
                        value={editStudentCode}
                        onChange={(e) => setEditStudentCode(e.target.value)}
                        placeholder="VD: HV-2026-001"
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-mono text-slate-900 focus:border-blue-600 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-700">
                        Số điện thoại
                      </label>
                      <input
                        type="tel"
                        value={editPhone}
                        onChange={(e) => setEditPhone(e.target.value)}
                        placeholder="0901234567"
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-700">
                        Ngày sinh
                      </label>
                      <input
                        type="date"
                        value={editDob}
                        onChange={(e) => setEditDob(e.target.value)}
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-700">
                        Trình độ đầu vào
                      </label>
                      <select
                        value={editEntryLevel}
                        onChange={(e) => setEditEntryLevel(e.target.value as QuestionLevel | '')}
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                      >
                        <option value="">-- Chưa đánh giá --</option>
                        <option value="beginner">Cơ bản</option>
                        <option value="intermediate">Trung cấp</option>
                        <option value="advanced">Nâng cao</option>
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-700">
                        Mục tiêu IELTS Band (1.0 – 9.0)
                      </label>
                      <input
                        type="number"
                        step="0.5"
                        min="1"
                        max="9"
                        value={editTargetBand}
                        onChange={(e) => setEditTargetBand(e.target.value)}
                        placeholder="VD: 6.5"
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm tabular-nums text-slate-900 focus:border-blue-600 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-700">
                        Người liên hệ / Phụ huynh
                      </label>
                      <input
                        type="text"
                        value={editGuardianName}
                        onChange={(e) => setEditGuardianName(e.target.value)}
                        placeholder="Họ tên người liên hệ"
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-700">
                        SĐT liên hệ / Phụ huynh
                      </label>
                      <input
                        type="tel"
                        value={editGuardianPhone}
                        onChange={(e) => setEditGuardianPhone(e.target.value)}
                        placeholder="0909876543"
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700">
                      Ghi chú ghi danh &amp; lộ trình
                    </label>
                    <textarea
                      rows={3}
                      value={editNote}
                      onChange={(e) => setEditNote(e.target.value)}
                      placeholder="Ghi chú nhu cầu học, lịch học mong muốn hoặc lưu ý của giáo vụ..."
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                    />
                  </div>

                  <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
                    <button
                      type="button"
                      onClick={() => setEditing(false)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      <X className="size-3.5" />
                      Hủy
                    </button>
                    <button
                      type="submit"
                      disabled={saving}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                    >
                      {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
                      Lưu thông tin ghi danh
                    </button>
                  </div>
                </form>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-bold text-slate-900">Chi tiết hồ sơ ghi danh</h4>
                    {canEditEnrollment && (
                      <button
                        type="button"
                        onClick={startEdit}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors duration-150"
                      >
                        <Edit3 className="size-3.5" />
                        Chỉnh sửa ghi danh
                      </button>
                    )}
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 text-xs">
                    <div className="rounded-xl border border-slate-200 bg-white p-3">
                      <div className="text-slate-500">Mã học viên</div>
                      <div className="mt-1 font-mono font-semibold text-slate-900">
                        {prof.student_code || 'Chưa cấp mã'}
                      </div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-white p-3">
                      <div className="flex items-center gap-1 text-slate-500">
                        <Calendar className="size-3.5" /> Ngày ghi danh
                      </div>
                      <div className="mt-1 font-semibold text-slate-900 tabular-nums">
                        {new Date(prof.enrolled_at || prof.created_at).toLocaleDateString('vi-VN')}
                      </div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-white p-3">
                      <div className="text-slate-500">Ngày sinh</div>
                      <div className="mt-1 font-semibold text-slate-900 tabular-nums">
                        {prof.date_of_birth
                          ? new Date(prof.date_of_birth).toLocaleDateString('vi-VN')
                          : 'Chưa cập nhật'}
                      </div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-white p-3">
                      <div className="text-slate-500">Trình độ đầu vào</div>
                      <div className="mt-1 font-semibold text-slate-900">
                        {prof.entry_level ? getLevelLabel(prof.entry_level) : 'Chưa đánh giá'}
                      </div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-white p-3">
                      <div className="text-slate-500">Mục tiêu IELTS Band</div>
                      <div className="mt-1 font-semibold text-blue-700 tabular-nums">
                        {prof.target_band != null ? `Band ${Number(prof.target_band).toFixed(1)}` : 'Chưa đặt mục tiêu'}
                      </div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-white p-3">
                      <div className="flex items-center gap-1 text-slate-500">
                        <Phone className="size-3.5" /> Liên hệ / Phụ huynh
                      </div>
                      <div className="mt-1 font-semibold text-slate-900">
                        {prof.guardian_name || prof.guardian_phone ? (
                          <>
                            {prof.guardian_name || 'Người liên hệ'}
                            {prof.guardian_phone ? ` · ${prof.guardian_phone}` : ''}
                          </>
                        ) : (
                          'Chưa cập nhật'
                        )}
                      </div>
                    </div>
                  </div>

                  {prof.enrollment_note && (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-xs">
                      <div className="mb-1 flex items-center gap-1.5 font-semibold text-slate-700">
                        <User className="size-3.5 text-blue-600" />
                        Ghi chú ghi danh
                      </div>
                      <p className="leading-relaxed text-slate-700 whitespace-pre-line text-pretty">
                        {prof.enrollment_note}
                      </p>
                    </div>
                  )}

                  {/* Quick Enrolled Classes Snapshot */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
                      <School className="size-4 text-blue-600" />
                      Lịch sử xếp lớp ({record.classHistory.length})
                    </div>
                    {record.classHistory.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-xs text-slate-500">
                        Học viên chưa được xếp vào lớp học nào. Việc xếp lớp thực hiện tại mục <strong>Quản lý Lớp học</strong>.
                      </div>
                    ) : (
                      <div className="grid gap-2.5 sm:grid-cols-2">
                        {record.classHistory.map((item) => (
                          <div
                            key={item.membershipId}
                            className="rounded-xl border border-slate-200 bg-white p-3 text-xs space-y-1"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-semibold text-slate-900 truncate">
                                {item.classInfo.name}
                              </span>
                              {getMembershipStatusBadge(item.membershipStatus)}
                            </div>
                            <div className="text-slate-500">
                              <span className="font-mono">{item.classInfo.code}</span> ·{' '}
                              {getExamTypeName(item.classInfo.course_type)}
                            </div>
                            <div className="text-slate-500">
                              GV:{' '}
                              <span className="font-medium text-slate-700">
                                {item.teachers.length > 0
                                  ? item.teachers.map((t) => t.full_name).join(', ')
                                  : 'Đang cập nhật'}
                              </span>{' '}
                              · Vào lớp: <span className="tabular-nums">{new Date(item.joinedAt).toLocaleDateString('vi-VN')}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )
            ) : (
              <div className="space-y-5">
                {/* 4 Learning KPIs */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="rounded-xl border border-slate-200 bg-white p-3">
                    <div className="text-[11px] font-medium text-slate-500">Lớp đã / đang học</div>
                    <div className="mt-1 text-xl font-bold text-slate-900 tabular-nums">
                      {record.classHistory.length}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-3">
                    <div className="text-[11px] font-medium text-slate-500">Tỷ lệ chuyên cần</div>
                    <div className="mt-1 text-xl font-bold text-emerald-600 tabular-nums">
                      {record.attendance.rate != null ? `${record.attendance.rate}%` : '--'}
                    </div>
                    {record.attendance.total > 0 && (
                      <div className="text-[10px] text-slate-500 tabular-nums">
                        {record.attendance.present + record.attendance.late}/{record.attendance.total} buổi
                      </div>
                    )}
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-3">
                    <div className="text-[11px] font-medium text-slate-500">Bài đã hoàn thành</div>
                    <div className="mt-1 text-xl font-bold text-slate-900 tabular-nums">
                      {record.totalCompletedCount}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-3">
                    <div className="text-[11px] font-medium text-slate-500">Band IELTS TB</div>
                    <div className="mt-1 text-xl font-bold text-blue-600 tabular-nums">
                      {record.avgBand != null ? record.avgBand.toFixed(1) : '--'}
                    </div>
                  </div>
                </div>

                {/* Practice & Exam Sessions */}
                <div className="space-y-2.5">
                  <h4 className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
                    <ClipboardCheck className="size-4 text-blue-600" />
                    Lịch sử Luyện tập &amp; Thi thử ({record.practiceSessions.length})
                  </h4>
                  {record.practiceSessions.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-5 text-center text-xs text-slate-500">
                      Học viên chưa hoàn thành bài luyện tập hoặc thi thử nào.
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                      {record.practiceSessions.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => setSelectedSessionId(s.id)}
                          className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left hover:border-blue-300 transition-colors duration-150"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="truncate text-xs font-bold text-slate-900">
                                {s.question_set?.title || 'Bộ đề Speaking'}
                              </span>
                              <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                                {s.mode === 'exam' ? 'Thi thử' : 'Luyện tập'}
                              </span>
                              {s.status === 'reviewed' && (
                                <span className="inline-flex items-center gap-0.5 rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                                  <CheckCircle2 className="size-2.5" /> Đã duyệt
                                </span>
                              )}
                            </div>
                            <div className="mt-0.5 text-[11px] text-slate-500 tabular-nums">
                              {new Date(s.completed_at || s.started_at).toLocaleString('vi-VN')}
                              {s.class_info?.name ? ` · ${s.class_info.name}` : ''}
                            </div>
                          </div>
                          <span
                            className={`rounded-lg border px-2.5 py-1 text-xs font-bold tabular-nums ${scoreBadgeBgClass(s.score_total)}`}
                          >
                            {formatScoreValue(s.score_total)}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* 1-on-1 Assessments */}
                <div className="space-y-2.5">
                  <h4 className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
                    <Award className="size-4 text-emerald-600" />
                    Lịch sử Chấm Hội thoại 1-1 ({record.assessments.length})
                  </h4>
                  {record.assessments.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-5 text-center text-xs text-slate-500">
                      Học viên chưa có buổi chấm hội thoại 1-1 nào.
                    </div>
                  ) : (
                    <div className="grid gap-2.5 md:grid-cols-2">
                      {record.assessments.map((a) => (
                        <AssessmentCard key={a.id} assessment={a} onSelect={setSelectedAssessment} />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>

      <PracticeDetailModal
        sessionId={selectedSessionId}
        canReview={canReviewSubmissions}
        onClose={() => setSelectedSessionId(null)}
        onReviewed={() => {
          if (studentId) void loadRecord(studentId);
          onUpdated?.();
        }}
      />

      <AssessmentDetailModal
        assessment={selectedAssessment}
        onClose={() => setSelectedAssessment(null)}
      />
    </>
  );
}
