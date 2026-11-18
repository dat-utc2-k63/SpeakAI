'use client';

import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Award,
  Calendar,
  CheckCircle2,
  Eye,
  EyeOff,
  GraduationCap,
  KeyRound,
  Loader2,
  Mic,
  Phone,
  Save,
  School,
} from 'lucide-react';
import { changeMyPassword, updateProfile } from '@/lib/auth';
import { fetchStudentFullRecord, type StudentFullRecord } from '@/lib/studentRecord';
import { saveVoiceEmbeddings } from '@/lib/voice';
import { getAvatarUrl, getExamTypeName, getLevelLabel, hasVoiceEnrolled } from '@/lib/utils';
import { PageHeader } from './ui/AnalyticsCharts';
import { VoiceEnrollModal } from './VoiceEnrollModal';
import { useToast } from './ToastProvider';
import type { Profile } from '@/lib/types';

interface ProfileViewProps {
  profile: Profile;
  gpuUrl: string;
  onProfileUpdated: (updated: Profile) => void;
}

export function ProfileView({ profile, gpuUrl, onProfileUpdated }: ProfileViewProps) {
  const { showToast } = useToast();
  const [fullName, setFullName] = useState(profile.full_name || '');
  const [phone, setPhone] = useState(profile.phone || '');
  const [saving, setSaving] = useState(false);
  const [voiceModalOpen, setVoiceModalOpen] = useState(false);
  const [studentRecord, setStudentRecord] = useState<StudentFullRecord | null>(null);
  const [loadingRecord, setLoadingRecord] = useState(false);

  // Change password state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);

  useEffect(() => {
    setFullName(profile.full_name || '');
    setPhone(profile.phone || '');
  }, [profile]);

  useEffect(() => {
    if (profile.role !== 'student') return;
    let cancelled = false;
    setLoadingRecord(true);
    fetchStudentFullRecord(profile.id)
      .then((rec) => {
        if (!cancelled) setStudentRecord(rec);
      })
      .catch(() => {
        if (!cancelled) setStudentRecord(null);
      })
      .finally(() => {
        if (!cancelled) setLoadingRecord(false);
      });
    return () => {
      cancelled = true;
    };
  }, [profile.id, profile.role]);

  const voiceReady = hasVoiceEnrolled(profile);
  const isAdmin = profile.role === 'admin';
  const studentProf = studentRecord?.profile || profile;

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim()) {
      showToast('Họ tên không được để trống.', 'danger');
      return;
    }
    setSaving(true);
    try {
      const updated = await updateProfile(profile.id, {
        full_name: fullName.trim(),
        phone: phone.trim() || null,
      });
      onProfileUpdated(updated);
      showToast('Đã cập nhật thông tin cá nhân!', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Lỗi cập nhật hồ sơ', 'danger');
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPassword) {
      showToast('Vui lòng nhập mật khẩu hiện tại.', 'danger');
      return;
    }
    if (newPassword.length < 6) {
      showToast('Mật khẩu mới phải có ít nhất 6 ký tự.', 'danger');
      return;
    }
    if (newPassword !== confirmPassword) {
      showToast('Mật khẩu nhập lại không khớp.', 'danger');
      return;
    }
    if (newPassword === currentPassword) {
      showToast('Mật khẩu mới phải khác mật khẩu hiện tại.', 'danger');
      return;
    }

    setChangingPassword(true);
    try {
      await changeMyPassword(profile.email, currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setShowCurrentPw(false);
      setShowNewPw(false);
      setShowConfirmPw(false);
      showToast('Đã đổi mật khẩu thành công!', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Không thể đổi mật khẩu lúc này.', 'danger');
    } finally {
      setChangingPassword(false);
    }
  };

  const handleVoiceSaved = async ({
    embeddings,
    voiceUrl,
  }: {
    embeddings: number[];
    voiceUrl: string | null;
  }) => {
    await saveVoiceEmbeddings(profile.id, embeddings, voiceUrl);
    onProfileUpdated({
      ...profile,
      voice_enrolled: true,
      voice_embeddings: embeddings,
      voice_sample_url: voiceUrl || profile.voice_sample_url,
    });
    showToast('Đã lưu mẫu giọng nói mới thành công!', 'success');
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="HỒ SƠ CÁ NHÂN"
        title={
          isAdmin
            ? 'Thông tin tài khoản & Bảo mật'
            : profile.role === 'student'
              ? 'Hồ sơ Học viên, Ghi danh & Bảo mật'
              : 'Thông tin tài khoản, Bảo mật & Giọng nói'
        }
        subtitle={
          isAdmin
            ? 'Cập nhật thông tin cá nhân và đổi mật khẩu đăng nhập.'
            : profile.role === 'student'
              ? 'Xem thông tin ghi danh tại trung tâm, lịch sử lớp học, đổi mật khẩu và quản lý mẫu giọng nói.'
              : 'Quản lý thông tin cá nhân, mật khẩu đăng nhập và mẫu giọng nói.'
        }
        pill={
          <span>
            {profile.role === 'admin'
              ? 'Quản trị viên'
              : profile.role === 'teacher'
                ? 'Giáo viên'
                : studentProf.student_code
                  ? `Học viên · ${studentProf.student_code}`
                  : 'Học viên'}
          </span>
        }
      />

      <div className={isAdmin ? 'max-w-3xl space-y-6' : 'grid gap-6 lg:grid-cols-12 items-start'}>
        {/* Left Column: Account Info + Student Enrollment & History + Change Password */}
        <div className={isAdmin ? 'space-y-6' : 'lg:col-span-7 space-y-6'}>
          <form onSubmit={handleSaveProfile} className="section-card space-y-5">
            <div className="flex items-center gap-4 border-b border-slate-100 pb-4">
              <img
                src={getAvatarUrl(profile.full_name, 128)}
                alt={profile.full_name}
                className="size-16 rounded-2xl border border-slate-200 object-cover"
              />
              <div className="min-w-0">
                <h3 className="truncate text-lg font-bold text-slate-900">{profile.full_name}</h3>
                <p className="truncate text-xs text-slate-500">{profile.email}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <span className="inline-block rounded-md border border-blue-200 bg-blue-50 px-2.5 py-0.5 text-[11px] font-semibold text-blue-700">
                    {profile.role === 'admin'
                      ? 'Quản trị viên'
                      : profile.role === 'teacher'
                        ? 'Giáo viên'
                        : 'Học viên'}
                  </span>
                  {profile.role === 'student' && studentProf.student_code && (
                    <span className="inline-block rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-700">
                      {studentProf.student_code}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                  Họ và tên <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                  Số điện thoại
                </label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="Chưa cập nhật"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                />
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50 transition-colors duration-150"
              >
                {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                Lưu thay đổi
              </button>
            </div>
          </form>

          {/* Student Enrollment Info & Learning History Summary */}
          {profile.role === 'student' && (
            <div className="section-card space-y-5">
              <div className="border-b border-slate-100 pb-3">
                <h3 className="flex items-center gap-2 text-base font-bold text-slate-900">
                  <GraduationCap className="size-5 text-blue-600" />
                  Thông tin Ghi danh &amp; Lịch sử Học tập
                </h3>
                <p className="mt-0.5 text-xs text-slate-500 text-pretty">
                  Thông tin ghi danh do Giáo vụ Trung tâm quản lý. Nếu cần điều chỉnh, vui lòng liên hệ trung tâm.
                </p>
              </div>

              {loadingRecord && !studentRecord ? (
                <div className="flex items-center gap-2 py-4 text-xs text-slate-500">
                  <Loader2 className="size-4 animate-spin text-blue-600" />
                  <span>Đang tải hồ sơ ghi danh và lịch sử học tập...</span>
                </div>
              ) : (
                <>
                  {/* Enrollment Metadata Grid */}
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 text-xs">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <div className="text-slate-500">Mã học viên</div>
                      <div className="mt-0.5 font-mono font-semibold text-slate-900">
                        {studentProf.student_code || 'Đang cập nhật'}
                      </div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <div className="flex items-center gap-1 text-slate-500">
                        <Calendar className="size-3.5" /> Ngày ghi danh
                      </div>
                      <div className="mt-0.5 font-semibold text-slate-900 tabular-nums">
                        {new Date(studentProf.enrolled_at || studentProf.created_at).toLocaleDateString('vi-VN')}
                      </div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <div className="text-slate-500">Ngày sinh</div>
                      <div className="mt-0.5 font-semibold text-slate-900 tabular-nums">
                        {studentProf.date_of_birth
                          ? new Date(studentProf.date_of_birth).toLocaleDateString('vi-VN')
                          : 'Chưa cập nhật'}
                      </div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <div className="text-slate-500">Trình độ đầu vào</div>
                      <div className="mt-0.5 font-semibold text-slate-900">
                        {studentProf.entry_level ? getLevelLabel(studentProf.entry_level) : 'Chưa đánh giá'}
                      </div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <div className="text-slate-500">Mục tiêu IELTS Band</div>
                      <div className="mt-0.5 font-semibold text-blue-700 tabular-nums">
                        {studentProf.target_band != null
                          ? `Band ${Number(studentProf.target_band).toFixed(1)}`
                          : 'Chưa đặt mục tiêu'}
                      </div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <div className="flex items-center gap-1 text-slate-500">
                        <Phone className="size-3.5" /> Liên hệ / Phụ huynh
                      </div>
                      <div className="mt-0.5 font-semibold text-slate-900 truncate">
                        {studentProf.guardian_name || studentProf.guardian_phone
                          ? `${studentProf.guardian_name || 'Người liên hệ'}${
                              studentProf.guardian_phone ? ` · ${studentProf.guardian_phone}` : ''
                            }`
                          : 'Chưa cập nhật'}
                      </div>
                    </div>
                  </div>

                  {studentProf.enrollment_note && (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                      <span className="font-semibold text-slate-800">Ghi chú ghi danh: </span>
                      <span className="text-pretty">{studentProf.enrollment_note}</span>
                    </div>
                  )}

                  {/* Learning History Summary KPIs */}
                  {studentRecord && (
                    <div className="grid grid-cols-3 gap-2.5 text-center text-xs">
                      <div className="rounded-xl border border-slate-200 bg-white p-3">
                        <div className="text-slate-500">Chuyên cần</div>
                        <div className="mt-1 text-base font-bold text-emerald-600 tabular-nums">
                          {studentRecord.attendance.rate != null
                            ? `${studentRecord.attendance.rate}%`
                            : '--'}
                        </div>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-white p-3">
                        <div className="text-slate-500">Bài hoàn thành</div>
                        <div className="mt-1 text-base font-bold text-slate-900 tabular-nums">
                          {studentRecord.totalCompletedCount}
                        </div>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-white p-3">
                        <div className="flex items-center justify-center gap-1 text-slate-500">
                          <Award className="size-3.5 text-blue-600" /> Band TB
                        </div>
                        <div className="mt-1 text-base font-bold text-blue-600 tabular-nums">
                          {studentRecord.avgBand != null ? studentRecord.avgBand.toFixed(1) : '--'}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Class History */}
                  <div className="space-y-2 text-xs">
                    <div className="flex items-center gap-1.5 font-semibold text-slate-800">
                      <School className="size-4 text-blue-600" />
                      Lịch sử lớp học ({studentRecord?.classHistory.length ?? 0})
                    </div>
                    {studentRecord && studentRecord.classHistory.length > 0 ? (
                      <div className="space-y-2">
                        {studentRecord.classHistory.map((item) => (
                          <div
                            key={item.membershipId}
                            className="rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 space-y-1"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="font-semibold text-slate-900">{item.classInfo.name}</span>
                              <div className="flex items-center gap-1.5">
                                <span className="rounded border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[10px] text-slate-600">
                                  {item.classInfo.code}
                                </span>
                                <span
                                  className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${
                                    item.membershipStatus === 'completed'
                                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                      : item.membershipStatus === 'dropped'
                                        ? 'border-amber-200 bg-amber-50 text-amber-700'
                                        : 'border-blue-200 bg-blue-50 text-blue-700'
                                  }`}
                                >
                                  {item.membershipStatus === 'completed'
                                    ? 'Hoàn thành'
                                    : item.membershipStatus === 'dropped'
                                      ? 'Đã ngừng học'
                                      : 'Đang học'}
                                </span>
                              </div>
                            </div>
                            <div className="text-slate-500">
                              {getExamTypeName(item.classInfo.course_type)} · GV:{' '}
                              <span className="font-medium text-slate-700">
                                {item.teachers.length > 0
                                  ? item.teachers.map((t) => t.full_name).join(', ')
                                  : 'Đang cập nhật'}
                              </span>{' '}
                              · Ngày vào lớp:{' '}
                              <span className="tabular-nums">
                                {new Date(item.joinedAt).toLocaleDateString('vi-VN')}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-3.5 text-slate-500 text-pretty">
                        Bạn chưa được xếp vào lớp học nào. Vui lòng liên hệ Giáo vụ Trung tâm để được xếp lớp.
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Change Password Card */}
          <form onSubmit={handleChangePassword} className="section-card space-y-4">
            <div className="border-b border-slate-100 pb-3">
              <h3 className="flex items-center gap-2 text-base font-bold text-slate-900">
                <KeyRound className="size-4 text-blue-600" />
                Đổi mật khẩu
              </h3>
              <p className="mt-0.5 text-xs text-slate-500 text-pretty">
                Nhập mật khẩu hiện tại để xác thực trước khi đặt mật khẩu mới (tối thiểu 6 ký tự).
              </p>
            </div>

            <div className="space-y-3.5">
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                  Mật khẩu hiện tại <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <input
                    type={showCurrentPw ? 'text' : 'password'}
                    required
                    autoComplete="current-password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="Nhập mật khẩu đang dùng"
                    className="w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-3.5 pr-10 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrentPw((v) => !v)}
                    aria-label={showCurrentPw ? 'Ẩn mật khẩu hiện tại' : 'Hiện mật khẩu hiện tại'}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 hover:text-slate-700"
                  >
                    {showCurrentPw ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </div>

              <div className="grid gap-3.5 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                    Mật khẩu mới <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type={showNewPw ? 'text' : 'password'}
                      required
                      minLength={6}
                      autoComplete="new-password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Tối thiểu 6 ký tự"
                      className="w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-3.5 pr-10 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPw((v) => !v)}
                      aria-label={showNewPw ? 'Ẩn mật khẩu mới' : 'Hiện mật khẩu mới'}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 hover:text-slate-700"
                    >
                      {showNewPw ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                    Nhập lại mật khẩu mới <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type={showConfirmPw ? 'text' : 'password'}
                      required
                      minLength={6}
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Nhập lại mật khẩu mới"
                      className="w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-3.5 pr-10 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPw((v) => !v)}
                      aria-label={showConfirmPw ? 'Ẩn mật khẩu xác nhận' : 'Hiện mật khẩu xác nhận'}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 hover:text-slate-700"
                    >
                      {showConfirmPw ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-1">
              <button
                type="submit"
                disabled={changingPassword}
                className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50 transition-colors duration-150"
              >
                {changingPassword ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <KeyRound className="size-4" />
                )}
                Cập nhật mật khẩu
              </button>
            </div>
          </form>
        </div>

        {/* Right Column: Voice Enrollment Card (Teacher & Student only) */}
        {!isAdmin && (
          <div className="section-card lg:col-span-5 flex flex-col justify-between space-y-4">
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="flex items-center gap-2 text-base font-bold text-slate-900">
                  <Mic className="size-5 text-blue-600" />
                  Mẫu Giọng Nói Cá Nhân
                </h3>
                <span
                  className={`rounded-md px-2.5 py-0.5 text-xs font-semibold ${
                    voiceReady
                      ? 'border border-emerald-200 bg-emerald-50 text-emerald-700'
                      : 'border border-amber-200 bg-amber-50 text-amber-700'
                  }`}
                >
                  {voiceReady ? 'Đã kích hoạt' : 'Chưa đăng ký'}
                </span>
              </div>

              {voiceReady ? (
                <div className="flex items-start gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-xs text-emerald-800">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                  <span className="text-pretty">
                    Giọng nói của bạn đã được lưu để hệ thống tự động nhận diện và tách giọng chính xác khi Chấm hội thoại 1-1.
                  </span>
                </div>
              ) : (
                <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-xs text-amber-800">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
                  <span className="text-pretty">
                    {profile.role === 'teacher'
                      ? 'Bạn cần đăng ký mẫu giọng nói trước khi sử dụng tính năng Chấm hội thoại 1-1 để tách giọng Giáo viên – Học viên.'
                      : 'Hãy đăng ký mẫu giọng nói để hệ thống nhận diện chính xác giọng của bạn khi Giáo viên chấm hội thoại 1-1.'}
                  </span>
                </div>
              )}

              {profile.voice_sample_url && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="mb-1.5 text-[11px] font-semibold text-slate-500">
                    Bản thu âm mẫu hiện tại:
                  </div>
                  <audio controls src={profile.voice_sample_url} className="h-9 w-full" />
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => setVoiceModalOpen(true)}
              className={`inline-flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors duration-150 ${
                voiceReady
                  ? 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                  : 'bg-slate-900 text-white hover:bg-slate-800'
              }`}
            >
              <Mic className="size-4" />
              {voiceReady ? 'Cập nhật lại Mẫu Giọng Nói' : 'Đăng ký Mẫu Giọng Ngay'}
            </button>
          </div>
        )}
      </div>

      {!isAdmin && (
        <VoiceEnrollModal
          open={voiceModalOpen}
          gpuUrl={gpuUrl}
          userId={profile.id}
          onClose={() => setVoiceModalOpen(false)}
          onSaved={handleVoiceSaved}
        />
      )}
    </div>
  );
}
