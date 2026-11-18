'use client';

import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  GraduationCap,
  Loader2,
  Mic,
  Save,
} from 'lucide-react';
import { getMyTeacherInfo, updateProfile } from '@/lib/auth';
import { saveVoiceEmbeddings } from '@/lib/voice';
import { getAvatarUrl, hasVoiceEnrolled } from '@/lib/utils';
import { PageHeader } from './ui/AnalyticsCharts';
import { VoiceEnrollModal } from './VoiceEnrollModal';
import { useToast } from './ToastProvider';
import type { Profile, TeacherBasicInfo } from '@/lib/types';

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
  const [teacherInfo, setTeacherInfo] = useState<TeacherBasicInfo | null>(null);

  useEffect(() => {
    setFullName(profile.full_name || '');
    setPhone(profile.phone || '');
  }, [profile]);

  useEffect(() => {
    if (profile.role !== 'student') return;
    getMyTeacherInfo()
      .then(setTeacherInfo)
      .catch(() => {});
  }, [profile.role, profile.teacher_id]);

  const voiceReady = hasVoiceEnrolled(profile);
  const isAdmin = profile.role === 'admin';

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
        title="Thông tin tài khoản & Giọng nói"
        subtitle={
          isAdmin
            ? 'Cập nhật thông tin tài khoản của bạn.'
            : 'Quản lý thông tin tài khoản và mẫu giọng nói cá nhân.'
        }
        pill={
          <span>
            {profile.role === 'admin'
              ? 'Quản trị viên'
              : profile.role === 'teacher'
                ? 'Giáo viên'
                : 'Học viên'}
          </span>
        }
      />

      <div className={isAdmin ? 'max-w-3xl' : 'grid gap-6 lg:grid-cols-12'}>
        {/* Info Form */}
        <form
          onSubmit={handleSaveProfile}
          className={`section-card space-y-5 ${isAdmin ? '' : 'lg:col-span-7'}`}
        >
          <div className="flex items-center gap-4 border-b border-slate-100 pb-4">
            <img
              src={getAvatarUrl(profile.full_name, 128)}
              alt={profile.full_name}
              className="h-16 w-16 rounded-2xl border border-blue-100 object-cover shadow-sm"
            />
            <div className="min-w-0">
              <h3 className="truncate text-lg font-bold text-slate-900">{profile.full_name}</h3>
              <p className="truncate text-xs text-slate-500">{profile.email}</p>
              <span className="mt-1.5 inline-block rounded-full border border-blue-200 bg-blue-50 px-2.5 py-0.5 text-[11px] font-semibold uppercase text-blue-700">
                {profile.role === 'admin'
                  ? 'Quản trị viên'
                  : profile.role === 'teacher'
                    ? 'Giáo viên'
                    : 'Học viên'}
              </span>
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
                className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2.5 text-sm text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none"
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
                className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2.5 text-sm text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none"
              />
            </div>
          </div>

          {profile.role === 'student' && (
            <div className="rounded-2xl border border-sky-100 bg-sky-50/70 p-4 text-xs">
              <div className="mb-1 flex items-center gap-1.5 font-semibold text-sky-700">
                <GraduationCap className="h-4 w-4" />
                Giáo viên phụ trách lớp
              </div>
              {teacherInfo ? (
                <div className="text-slate-700">
                  <strong className="text-slate-900">{teacherInfo.full_name}</strong> · {teacherInfo.email}
                </div>
              ) : (
                <div className="text-slate-500">Chưa được phân công giáo viên phụ trách.</div>
              )}
            </div>
          )}

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50 transition-colors duration-150"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Lưu thay đổi
            </button>
          </div>
        </form>

        {/* Voice Enrollment Card (Teacher & Student only) */}
        {!isAdmin && (
          <div className="section-card lg:col-span-5 flex flex-col justify-between space-y-4">
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="flex items-center gap-2 text-base font-bold text-slate-900">
                  <Mic className="h-5 w-5 text-blue-600" />
                  Mẫu Giọng Nói Cá Nhân
                </h3>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                    voiceReady
                      ? 'border border-emerald-200 bg-emerald-50 text-emerald-700'
                      : 'border border-amber-200 bg-amber-50 text-amber-700'
                  }`}
                >
                  {voiceReady ? 'Đã kích hoạt' : 'Chưa đăng ký'}
                </span>
              </div>

              {voiceReady ? (
                <div className="flex items-start gap-2.5 rounded-2xl border border-emerald-200 bg-emerald-50/75 p-3.5 text-xs text-emerald-800">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  <span>
                    Giọng nói của bạn đã được lưu để hệ thống tự động nhận diện trong hội thoại 1-1 và phân tích tiết dạy.
                  </span>
                </div>
              ) : (
                <div className="flex items-start gap-2.5 rounded-2xl border border-amber-200 bg-amber-50/85 p-3.5 text-xs text-amber-800">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                  <span>
                    {profile.role === 'teacher'
                      ? 'Bạn cần đăng ký mẫu giọng nói trước khi chạy Chấm hội thoại 1-1 hoặc Phân tích tiết dạy.'
                      : 'Hãy đăng ký mẫu giọng nói để hệ thống nhận diện chính xác giọng của bạn khi chấm hội thoại.'}
                  </span>
                </div>
              )}

              {profile.voice_sample_url && (
                <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3">
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
              <Mic className="h-4 w-4" />
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
