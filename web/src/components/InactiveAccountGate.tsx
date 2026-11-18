'use client';

import React, { useState } from 'react';
import { Clock3, Loader2, LockKeyhole, LogOut, RefreshCw, UserCircle2 } from 'lucide-react';
import type { Profile } from '@/lib/types';

interface InactiveAccountGateProps {
  profile: Profile;
  onRecheckStatus: () => Promise<void>;
  onOpenProfile: () => void;
  onLogout: () => void;
}

export function InactiveAccountGate({
  profile,
  onRecheckStatus,
  onOpenProfile,
  onLogout,
}: InactiveAccountGateProps) {
  const [checking, setChecking] = useState(false);
  const isSuspended = profile.status === 'suspended';

  const handleRecheck = async () => {
    setChecking(true);
    try {
      await onRecheckStatus();
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="section-card mx-auto mt-8 max-w-2xl text-center space-y-5 p-6 sm:p-8">
      <div
        className={`mx-auto flex size-14 items-center justify-center rounded-xl border ${
          isSuspended
            ? 'border-rose-200 bg-rose-50 text-rose-600'
            : 'border-amber-200 bg-amber-50 text-amber-600'
        }`}
      >
        {isSuspended ? <LockKeyhole className="size-7" /> : <Clock3 className="size-7" />}
      </div>

      <div className="space-y-2">
        <h2 className="text-xl sm:text-2xl font-bold text-slate-900 text-balance">
          {isSuspended
            ? 'Tài khoản đang bị tạm khóa'
            : 'Tài khoản Giáo viên đang chờ phê duyệt'}
        </h2>
        <p className="mx-auto max-w-lg text-sm leading-relaxed text-slate-600 text-pretty">
          {isSuspended
            ? 'Tài khoản của bạn hiện bị khóa quyền truy cập hệ thống. Vui lòng liên hệ Quản trị viên để được hỗ trợ.'
            : `Xin chào ${profile.full_name}, yêu cầu đăng ký vai trò Giáo viên của bạn đã được ghi nhận. Sau khi Quản trị viên phê duyệt, bạn có thể truy cập đầy đủ công cụ quản lý lớp học, bộ đề và chấm điểm.`}
        </p>
      </div>

      <div className="mx-auto max-w-md rounded-xl border border-slate-200 bg-slate-50 p-4 text-left text-xs text-slate-600 space-y-1.5">
        <div className="flex justify-between">
          <span className="text-slate-500">Họ tên:</span>
          <span className="font-semibold text-slate-900">{profile.full_name}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500">Email:</span>
          <span className="font-mono text-slate-700">{profile.email}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500">Trạng thái:</span>
          <span className={isSuspended ? 'font-bold text-rose-600' : 'font-bold text-amber-600'}>
            {isSuspended ? 'Tạm khóa' : 'Chờ duyệt'}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
        <button
          type="button"
          disabled={checking}
          onClick={handleRecheck}
          className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50 transition-colors duration-150"
        >
          {checking ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          Kiểm tra lại trạng thái
        </button>

        <button
          type="button"
          onClick={onOpenProfile}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors duration-150"
        >
          <UserCircle2 className="size-4" />
          Hồ sơ cá nhân
        </button>

        <button
          type="button"
          onClick={onLogout}
          className="inline-flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-medium text-rose-700 hover:bg-rose-100 transition-colors duration-150"
        >
          <LogOut className="size-4" />
          Đăng xuất
        </button>
      </div>
    </div>
  );
}
