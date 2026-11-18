'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { APP_CONFIG, isSupabaseConfigured, supabase } from '@/lib/supabase';
import { getProfile, getPublicRuntimeConfig, signOut } from '@/lib/auth';
import { setRuntimeGpuUrl } from '@/lib/aiEval';
import { DashboardSidebar, getNavItemsForRole } from '@/components/DashboardSidebar';
import { InactiveAccountGate } from '@/components/InactiveAccountGate';
import { ProfileView } from '@/components/ProfileView';
import { AdminDashboard } from '@/components/admin/AdminDashboard';
import { TeacherDashboard } from '@/components/teacher/TeacherDashboard';
import { StudentDashboard } from '@/components/student/StudentDashboard';
import { useToast } from '@/components/ToastProvider';
import type { Profile } from '@/lib/types';

export default function DashboardPage() {
  const router = useRouter();
  const { showToast } = useToast();

  const [bootstrapping, setBootstrapping] = useState(true);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [gpuUrl, setGpuUrl] = useState<string>(APP_CONFIG.SPEAKAI_API_URL || '');
  const [activeTab, setActiveTab] = useState<string>('overview');
  const [pendingTeacherCount, setPendingTeacherCount] = useState<number>(0);
  const [practiceGuardActive, setPracticeGuardActive] = useState<boolean>(false);

  const loadBootstrap = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) {
      setBootstrapError('Hệ thống đang bảo trì kết nối dữ liệu. Vui lòng thử lại sau.');
      setBootstrapping(false);
      return;
    }

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.user) {
        router.replace('/');
        return;
      }

      const [prof, runtime] = await Promise.all([
        getProfile(session.user.id),
        getPublicRuntimeConfig().catch(() => null),
      ]);

      setProfile(prof);
      const resolvedUrl = (runtime?.api_url || APP_CONFIG.SPEAKAI_API_URL || '')
        .trim()
        .replace(/\/+$/, '');
      setGpuUrl(resolvedUrl);
      if (resolvedUrl) setRuntimeGpuUrl(resolvedUrl);
    } catch (err) {
      setBootstrapError(
        err instanceof Error ? err.message : 'Không thể tải hồ sơ tài khoản.',
      );
    } finally {
      setBootstrapping(false);
    }
  }, [router]);

  useEffect(() => {
    loadBootstrap();
  }, [loadBootstrap]);

  const handleNavigate = (tabId: string) => {
    if (tabId === activeTab) return;
    if (practiceGuardActive) {
      const ok = window.confirm(
        'Bạn đang trong phiên Luyện tập / Thi thử. Rời màn hình ngay bây giờ sẽ kết thúc phiên hiện tại (các câu chưa nộp sẽ không được lưu). Bạn vẫn muốn chuyển trang?',
      );
      if (!ok) return;
      setPracticeGuardActive(false);
    }
    setActiveTab(tabId);
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleRecheckStatus = async () => {
    if (!profile) return;
    try {
      const refreshed = await getProfile(profile.id);
      setProfile(refreshed);
      if (refreshed.status === 'active') {
        showToast('Tài khoản của bạn đã được kích hoạt!', 'success');
      } else {
        showToast('Tài khoản vẫn đang ở trạng thái chờ duyệt / khóa.', 'info');
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Lỗi kiểm tra trạng thái', 'danger');
    }
  };

  const handleLogout = async () => {
    if (practiceGuardActive) {
      const ok = window.confirm('Bạn đang trong bài thi/luyện tập. Chắc chắn muốn đăng xuất?');
      if (!ok) return;
    }
    try {
      await signOut();
    } catch {
      // ignore signOut errors
    }
    router.replace('/');
  };

  if (bootstrapping) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-slate-50 px-4">
        <div className="surface-card flex flex-col items-center gap-3 p-8 text-center">
          <Loader2 className="size-7 animate-spin text-blue-600" />
          <p className="text-sm font-medium text-slate-600 text-pretty">Đang khởi tạo không gian làm việc...</p>
        </div>
      </div>
    );
  }

  if (bootstrapError || !profile) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-slate-50 px-4">
        <div className="section-card max-w-md space-y-4 text-center p-8">
          <AlertTriangle className="mx-auto size-9 text-amber-600" />
          <h2 className="text-lg font-bold text-slate-900 text-balance">Không thể vào Dashboard</h2>
          <p className="text-sm text-slate-600 text-pretty">
            {bootstrapError || 'Phiên đăng nhập không hợp lệ hoặc thiếu hồ sơ người dùng.'}
          </p>
          <div className="flex justify-center gap-3 pt-2">
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-lg bg-slate-900 px-5 py-2.5 text-xs font-semibold text-white hover:bg-slate-800 transition-colors duration-150"
            >
              Về trang Đăng nhập
            </button>
          </div>
        </div>
      </div>
    );
  }

  const isActive = profile.status === 'active';
  const navItems = getNavItemsForRole(profile.role, isActive, pendingTeacherCount);

  return (
    <div className="min-h-dvh overflow-x-clip bg-slate-50">
      <DashboardSidebar
        profile={profile}
        navItems={navItems}
        activeTab={activeTab}
        onSelectTab={handleNavigate}
        onLogout={handleLogout}
      />

      <main className="min-h-dvh pb-24 lg:pb-10 lg:pl-64">
        <div
          key={`${profile.role}-${isActive ? '1' : '0'}-${activeTab}`}
          className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8 lg:py-7"
        >
          {!isActive ? (
            activeTab === 'profile' ? (
              <ProfileView
                profile={profile}
                gpuUrl={gpuUrl}
                onProfileUpdated={(updated) => setProfile(updated)}
              />
            ) : (
              <InactiveAccountGate
                profile={profile}
                onRecheckStatus={handleRecheckStatus}
                onOpenProfile={() => setActiveTab('profile')}
                onLogout={handleLogout}
              />
            )
          ) : activeTab === 'profile' ? (
            <ProfileView
              profile={profile}
              gpuUrl={gpuUrl}
              onProfileUpdated={(updated) => setProfile(updated)}
            />
          ) : profile.role === 'admin' ? (
            <AdminDashboard
              currentUser={profile}
              activeTab={activeTab}
              gpuUrl={gpuUrl}
              onGpuUrlChange={(nextUrl) => setGpuUrl(nextUrl)}
              onNavigate={handleNavigate}
              onPendingCountChange={setPendingTeacherCount}
            />
          ) : profile.role === 'teacher' ? (
            <TeacherDashboard
              currentUser={profile}
              activeTab={activeTab}
              gpuUrl={gpuUrl}
              onNavigate={handleNavigate}
            />
          ) : (
            <StudentDashboard
              currentUser={profile}
              activeTab={activeTab}
              gpuUrl={gpuUrl}
              onNavigate={handleNavigate}
              onPracticeGuardChange={setPracticeGuardActive}
            />
          )}
        </div>
      </main>
    </div>
  );
}
