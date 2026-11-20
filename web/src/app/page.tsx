'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ArrowRight,
  Eye,
  EyeOff,
  Info,
  Loader2,
  Mic,
  ShieldAlert,
} from 'lucide-react';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { signIn } from '@/lib/auth';
import { translateAuthError } from '@/lib/utils';
import { LiveAudioVisualizer, ScoreRingGauge } from '@/components/ui/AnalyticsCharts';
import { useToast } from '@/components/ToastProvider';

export default function AuthLandingPage() {
  const router = useRouter();
  const { showToast } = useToast();

  const [checkingSession, setCheckingSession] = useState(true);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginPw, setShowLoginPw] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('speakai_llm_key');
      localStorage.removeItem('speakai_gemini_key');
    }

    if (!isSupabaseConfigured || !supabase) {
      setCheckingSession(false);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (cancelled) return;
        if (data?.session) {
          router.replace('/dashboard');
          return;
        }
      } catch (err) {
        console.warn('Session check warning:', err);
      } finally {
        if (!cancelled) setCheckingSession(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    if (!isSupabaseConfigured) {
      setLoginError('Hệ thống đang bảo trì kết nối. Vui lòng thử lại sau.');
      return;
    }
    setLoginLoading(true);
    try {
      await signIn({ email: loginEmail.trim(), password: loginPassword });
      showToast('Đăng nhập thành công!', 'success');
      router.replace('/dashboard');
    } catch (err) {
      const msg = translateAuthError(err instanceof Error ? err.message : 'Lỗi đăng nhập');
      setLoginError(msg);
    } finally {
      setLoginLoading(false);
    }
  };

  if (checkingSession) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-slate-50 px-4">
        <div className="surface-card flex flex-col items-center gap-3 p-8 text-center">
          <Loader2 className="size-7 animate-spin text-blue-600" />
          <p className="text-sm font-medium text-slate-600 text-pretty">Đang kiểm tra phiên đăng nhập...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-slate-50 px-4 py-10 sm:py-14">
      <div className="w-full max-w-6xl grid items-center gap-10 lg:grid-cols-12">
        {/* Left Editorial Column */}
        <div className="lg:col-span-6 space-y-6 text-center lg:text-left">
          <div className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700 shadow-sm">
            <span className="size-1.5 rounded-full bg-blue-600" />
            Hệ thống đào tạo &amp; đánh giá Speaking
          </div>

          <div className="flex items-center justify-center lg:justify-start gap-3">
            <div className="flex size-11 items-center justify-center rounded-xl bg-slate-900">
              <Mic className="size-5 text-white" />
            </div>
            <h1 className="text-3xl sm:text-4xl font-bold text-slate-900 text-balance">
              Speak<span className="text-blue-600">AI</span>
            </h1>
          </div>

          <p className="text-sm sm:text-base leading-relaxed text-slate-600 max-w-xl mx-auto lg:mx-0 text-pretty">
            Luyện nói, nhận chấm điểm chi tiết theo 4 tiêu chí IELTS Speaking (P · FC · LR · GRA)
            và quản lý lớp học tập trung. Hỗ trợ{' '}
            <strong className="font-semibold text-slate-900">IELTS / VSTEP / TOEIC</strong>, chấm hội thoại 1-1 tự động tách giọng và phân tích tỷ lệ EN / VI trong tiết dạy.
          </p>

          {/* Compact Voice Preview Card */}
          <div className="hidden sm:grid sm:grid-cols-12 gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm text-left">
            <div className="sm:col-span-7 flex flex-col items-center justify-center gap-3 rounded-lg bg-slate-50 p-4 border border-slate-200">
              <div className="flex items-center gap-4">
                <div className="flex size-12 items-center justify-center rounded-full bg-slate-900 text-[11px] font-bold text-white">
                  Ghi âm
                </div>
                <LiveAudioVisualizer active={false} mode="ready" barCount={9} height={44} />
              </div>
              <div className="w-full rounded-md border border-slate-200 bg-white px-3 py-1.5 text-center text-xs font-medium text-slate-600">
                Sẵn sàng ghi âm &amp; chấm phát âm theo từng từ
              </div>
            </div>

            <div className="sm:col-span-5 flex flex-col items-center justify-center rounded-lg bg-slate-50 p-4 border border-slate-200">
              <div className="mb-1 text-xs font-semibold text-slate-500">
                IELTS Band
              </div>
              <ScoreRingGauge score={8.0} max={9} size={96} strokeWidth={10} />
              <span className="mt-2 rounded-md bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 text-[11px] font-medium text-emerald-700">
                Very Good User
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 text-left text-xs sm:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-white p-3.5">
              <div className="font-semibold text-slate-900">Học viên</div>
              <div className="mt-1 text-slate-500 text-pretty">
                Làm bài tập lớp, tự luyện Speaking và theo dõi lịch sử tiến bộ.
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-3.5">
              <div className="font-semibold text-slate-900">Giáo viên</div>
              <div className="mt-1 text-slate-500 text-pretty">
                Duyệt bài tập, chấm hội thoại 1-1 và phân tích tiết dạy EN/VI.
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-3.5">
              <div className="font-semibold text-slate-900">Giáo vụ &amp; Quản trị</div>
              <div className="mt-1 text-slate-500 text-pretty">
                Cấp tài khoản, xếp lớp học viên &amp; quản lý hồ sơ ghi danh.
              </div>
            </div>
          </div>
        </div>

        {/* Right Login-Only Card */}
        <div className="lg:col-span-6">
          <div className="surface-card p-6 sm:p-8 shadow-sm space-y-5">
            <div className="space-y-1 border-b border-slate-100 pb-4">
              <h2 className="text-xl font-bold text-slate-900 text-balance">
                Đăng nhập hệ thống
              </h2>
              <p className="text-xs text-slate-500 text-pretty">
                Sử dụng tài khoản do Trung tâm cấp để truy cập lớp học và bài luyện Speaking.
              </p>
            </div>

            {!isSupabaseConfigured && (
              <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3.5 text-xs text-amber-800">
                <ShieldAlert className="mt-0.5 size-5 shrink-0 text-amber-600" />
                <div>
                  <div className="font-semibold text-amber-900">Hệ thống đang bảo trì kết nối</div>
                  <p className="mt-1 leading-relaxed text-pretty">
                    Kết nối dữ liệu hiện đang tạm gián đoạn. Vui lòng quay lại sau ít phút.
                  </p>
                </div>
              </div>
            )}

            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                  Email tài khoản
                </label>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  placeholder="name@example.com"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15 transition-colors duration-150"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                  Mật khẩu
                </label>
                <div className="relative">
                  <input
                    type={showLoginPw ? 'text' : 'password'}
                    required
                    autoComplete="current-password"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    placeholder="Nhập mật khẩu"
                    className="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 pr-11 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15 transition-colors duration-150"
                  />
                  <button
                    type="button"
                    onClick={() => setShowLoginPw((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                    aria-label="Hiện/ẩn mật khẩu"
                  >
                    {showLoginPw ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </div>

              {loginError && (
                <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-rose-600" />
                  <span>{loginError}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={loginLoading || !isSupabaseConfigured}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 transition-colors duration-150"
              >
                {loginLoading ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Đang đăng nhập...
                  </>
                ) : (
                  <>
                    <span>Đăng nhập</span>
                    <ArrowRight className="size-4" />
                  </>
                )}
              </button>
            </form>

            <div className="flex items-start gap-2.5 rounded-lg border border-slate-200 bg-slate-50 p-3.5 text-xs text-slate-600">
              <Info className="mt-0.5 size-4 shrink-0 text-blue-600" />
              <p className="leading-relaxed text-pretty">
                Hệ thống không hỗ trợ tự đăng ký trực tuyến. Tài khoản <strong className="text-slate-800">Học viên</strong> và <strong className="text-slate-800">Giáo viên</strong> được Giáo vụ Trung tâm tạo và bàn giao trực tiếp. Nếu bạn chưa có tài khoản hoặc quên mật khẩu, vui lòng liên hệ Quản trị viên / Giáo vụ.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
