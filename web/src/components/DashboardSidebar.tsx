'use client';

import React, { useState } from 'react';
import {
  Award,
  BookOpen,
  ClipboardCheck,
  FolderKanban,
  GraduationCap,
  Languages,
  LayoutDashboard,
  LogOut,
  Menu,
  Mic,
  MoreHorizontal,
  Presentation,
  ShieldCheck,
  UserCircle2,
  Users,
  X,
} from 'lucide-react';
import { getAvatarUrl } from '@/lib/utils';
import type { Profile, UserRole } from '@/lib/types';

export interface NavItem {
  id: string;
  label: string;
  mobileLabel?: string;
  icon:
    | 'overview'
    | 'users'
    | 'content'
    | 'classroom'
    | 'students'
    | 'questionsets'
    | 'assess'
    | 'practice'
    | 'results'
    | 'profile';
  badge?: string | number;
}

export function getNavItemsForRole(
  role: UserRole,
  isActive: boolean,
  pendingTeacherCount = 0,
): NavItem[] {
  if (!isActive) {
    return [
      { id: 'overview', label: 'Trạng thái tài khoản', mobileLabel: 'Trạng thái', icon: 'overview' },
      { id: 'profile', label: 'Hồ sơ cá nhân', mobileLabel: 'Hồ sơ', icon: 'profile' },
    ];
  }

  if (role === 'admin') {
    return [
      {
        id: 'overview',
        label: 'Tổng quan',
        mobileLabel: 'Tổng quan',
        icon: 'overview',
        badge: pendingTeacherCount > 0 ? pendingTeacherCount : undefined,
      },
      { id: 'users', label: 'Tài khoản & Lớp học', mobileLabel: 'Tài khoản', icon: 'users' },
      { id: 'content', label: 'Bộ đề & Luyện thi', mobileLabel: 'Bộ đề', icon: 'content' },
      { id: 'assessments', label: 'Hội thoại 1-1', mobileLabel: 'Hội thoại', icon: 'assess' },
      { id: 'classroom', label: 'Phân tích tiết dạy', mobileLabel: 'Tiết dạy', icon: 'classroom' },
      { id: 'profile', label: 'Hồ sơ cá nhân', mobileLabel: 'Hồ sơ', icon: 'profile' },
    ];
  }

  if (role === 'teacher') {
    return [
      { id: 'overview', label: 'Tổng quan', mobileLabel: 'Tổng quan', icon: 'overview' },
      { id: 'students', label: 'Học viên của tôi', mobileLabel: 'Học viên', icon: 'students' },
      { id: 'questionsets', label: 'Bộ đề Speaking', mobileLabel: 'Bộ đề', icon: 'questionsets' },
      { id: 'assess', label: 'Chấm & Đánh giá', mobileLabel: 'Chấm 1-1', icon: 'assess' },
      { id: 'classroom', label: 'Phân tích tiết dạy', mobileLabel: 'Tiết dạy', icon: 'classroom' },
      { id: 'profile', label: 'Hồ sơ cá nhân', mobileLabel: 'Hồ sơ', icon: 'profile' },
    ];
  }

  return [
    { id: 'overview', label: 'Tổng quan', mobileLabel: 'Tổng quan', icon: 'overview' },
    { id: 'practice', label: 'Luyện Speaking', mobileLabel: 'Luyện nói', icon: 'practice' },
    { id: 'results', label: 'Kết quả học tập', mobileLabel: 'Kết quả', icon: 'results' },
    { id: 'profile', label: 'Hồ sơ cá nhân', mobileLabel: 'Hồ sơ', icon: 'profile' },
  ];
}

function renderNavIcon(icon: NavItem['icon'], cls = 'h-4 w-4 shrink-0') {
  switch (icon) {
    case 'overview':
      return <LayoutDashboard className={cls} />;
    case 'users':
      return <Users className={cls} />;
    case 'content':
      return <FolderKanban className={cls} />;
    case 'classroom':
      return <Languages className={cls} />;
    case 'students':
      return <GraduationCap className={cls} />;
    case 'questionsets':
      return <BookOpen className={cls} />;
    case 'assess':
      return <ClipboardCheck className={cls} />;
    case 'practice':
      return <Mic className={cls} />;
    case 'results':
      return <Award className={cls} />;
    case 'profile':
    default:
      return <UserCircle2 className={cls} />;
  }
}

function getRoleBadge(role: UserRole) {
  if (role === 'admin') {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-700">
        <ShieldCheck className="size-3" />
        Quản trị viên
      </span>
    );
  }
  if (role === 'teacher') {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700">
        <Presentation className="size-3" />
        Giáo viên
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
      <GraduationCap className="size-3" />
      Học viên
    </span>
  );
}

interface DashboardSidebarProps {
  profile: Profile;
  navItems: NavItem[];
  activeTab: string;
  onSelectTab: (tabId: string) => void;
  onLogout: () => void;
}

export function DashboardSidebar({
  profile,
  navItems,
  activeTab,
  onSelectTab,
  onLogout,
}: DashboardSidebarProps) {
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);

  const handleSelect = (id: string) => {
    setMobileSheetOpen(false);
    onSelectTab(id);
  };

  // Bottom bar fits 4 direct slots; extra items go in "Thêm" sheet
  const needsMoreSheet = navItems.length > 4;
  const bottomPrimaryItems = needsMoreSheet ? navItems.slice(0, 4) : navItems;
  const secondaryItems = needsMoreSheet ? navItems.slice(4) : [];
  const isMoreActive = secondaryItems.some((item) => item.id === activeTab);

  const sidebarContent = (
    <div className="flex h-full flex-col justify-between p-4">
      <div className="space-y-5">
        {/* Brand */}
        <div className="flex items-center justify-between px-1 pt-1">
          <div className="flex items-center gap-2.5">
            <div className="flex size-9 items-center justify-center rounded-lg bg-slate-900">
              <Mic className="size-4 text-white" />
            </div>
            <div>
              <div className="text-base font-bold leading-none text-slate-900">
                Speak<span className="text-blue-600">AI</span>
              </div>
              <div className="mt-1 text-[11px] text-slate-500">
                Đánh giá Speaking
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setMobileSheetOpen(false)}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors duration-150 lg:hidden"
            aria-label="Đóng menu"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* User summary card */}
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="flex items-center gap-2.5">
            <img
              src={getAvatarUrl(profile.full_name, 96)}
              alt={profile.full_name}
              className="size-9 rounded-full border border-slate-200 object-cover"
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-slate-900">{profile.full_name}</div>
              <div className="truncate text-[11px] text-slate-500">{profile.email}</div>
            </div>
          </div>
          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
            {getRoleBadge(profile.role)}
            {profile.status !== 'active' && (
              <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                {profile.status === 'pending' ? 'Chờ duyệt' : 'Đã khóa'}
              </span>
            )}
          </div>
        </div>

        {/* Navigation */}
        <nav className="space-y-1" aria-label="Điều hướng chính">
          {navItems.map((item) => {
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSelect(item.id)}
                className={`flex w-full items-center justify-between gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors duration-150 ${
                  active
                    ? 'bg-blue-50 font-semibold text-blue-700'
                    : 'font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <span className="flex items-center gap-2.5 truncate">
                  {renderNavIcon(item.icon, `size-4 shrink-0 ${active ? 'text-blue-600' : 'text-slate-400'}`)}
                  <span className="truncate">{item.label}</span>
                </span>
                {item.badge != null && (
                  <span
                    className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${
                      active
                        ? 'bg-blue-600 text-white'
                        : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Footer Logout */}
      <div className="border-t border-slate-200 pt-3">
        <button
          type="button"
          onClick={onLogout}
          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-rose-50 hover:text-rose-700 transition-colors duration-150"
        >
          <LogOut className="size-4" />
          <span>Đăng xuất</span>
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* ── MOBILE TOP STICKY BAR (< lg) ───────────────────────── */}
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2.5 lg:hidden">
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            type="button"
            onClick={() => setMobileSheetOpen(true)}
            className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition-colors duration-150"
            aria-label="Mở menu điều hướng"
          >
            <Menu className="size-4" />
          </button>
          <div className="flex items-center gap-2 min-w-0">
            <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-slate-900">
              <Mic className="size-3.5 text-white" />
            </div>
            <span className="text-base font-bold text-slate-900">
              Speak<span className="text-blue-600">AI</span>
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {getRoleBadge(profile.role)}
          <button
            type="button"
            onClick={() => handleSelect('profile')}
            className="rounded-full border border-slate-200"
            aria-label="Hồ sơ cá nhân"
          >
            <img
              src={getAvatarUrl(profile.full_name, 72)}
              alt={profile.full_name}
              className="size-8 rounded-full object-cover"
            />
          </button>
        </div>
      </header>

      {/* ── MOBILE DRAWER MENU (< lg) ───────────────────────────── */}
      {mobileSheetOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/40 lg:hidden"
          onClick={() => setMobileSheetOpen(false)}
        />
      )}

      <aside
        aria-hidden={!mobileSheetOpen}
        className={`fixed inset-y-0 left-0 z-40 w-64 border-r border-slate-200 bg-white shadow-xl transition-transform duration-200 ease-out lg:hidden ${
          mobileSheetOpen ? 'translate-x-0 pointer-events-auto' : '-translate-x-full pointer-events-none'
        }`}
      >
        {sidebarContent}
      </aside>

      {/* ── MOBILE BOTTOM NAVIGATION DOCK (< lg) ───────────────── */}
      <nav
        aria-label="Điều hướng chính trên di động"
        className="fixed bottom-0 inset-x-0 z-30 border-t border-slate-200 bg-white px-2 pt-1.5 pb-[max(0.45rem,env(safe-area-inset-bottom))] lg:hidden"
      >
        <div className="mx-auto flex max-w-md items-center justify-around gap-1">
          {bottomPrimaryItems.map((item) => {
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSelect(item.id)}
                className={`relative flex flex-1 flex-col items-center justify-center gap-1 rounded-lg py-1.5 px-1 transition-colors duration-150 ${
                  active ? 'text-blue-600' : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <div
                  className={`flex h-7 w-10 items-center justify-center rounded-md ${
                    active ? 'bg-blue-50 text-blue-600' : 'bg-transparent'
                  }`}
                >
                  {renderNavIcon(item.icon, 'size-4')}
                </div>
                <span className={`truncate max-w-full text-[10px] leading-none ${active ? 'font-semibold' : 'font-medium'}`}>
                  {item.mobileLabel || item.label}
                </span>
                {item.badge != null && (
                  <span className="absolute top-1 right-2.5 size-2 rounded-full bg-amber-500 ring-2 ring-white" />
                )}
              </button>
            );
          })}

          {needsMoreSheet && (
            <button
              type="button"
              onClick={() => setMobileSheetOpen(true)}
              className={`relative flex flex-1 flex-col items-center justify-center gap-1 rounded-lg py-1.5 px-1 transition-colors duration-150 ${
                isMoreActive ? 'text-blue-600' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <div
                className={`flex h-7 w-10 items-center justify-center rounded-md ${
                  isMoreActive ? 'bg-blue-50 text-blue-600' : 'bg-transparent'
                }`}
              >
                <MoreHorizontal className="size-4" />
              </div>
              <span className={`text-[10px] leading-none ${isMoreActive ? 'font-semibold' : 'font-medium'}`}>
                Thêm
              </span>
            </button>
          )}
        </div>
      </nav>

      {/* ── DESKTOP DOCKED SIDEBAR (lg+) ────────────────────────── */}
      <aside className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:z-20 lg:flex lg:w-64 lg:flex-col border-r border-slate-200 bg-white">
        {sidebarContent}
      </aside>
    </>
  );
}
