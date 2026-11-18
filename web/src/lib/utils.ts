import type { Profile } from './types';

export function hasVoiceEnrolled(user?: Partial<Profile> | null): boolean {
  if (!user) return false;
  if (user.voice_enrolled === true) return true;
  if (user.voice_embeddings) {
    if (Array.isArray(user.voice_embeddings) && user.voice_embeddings.length > 0) return true;
    if (typeof user.voice_embeddings === 'string' && user.voice_embeddings.trim().length > 10) return true;
  }
  if (user.voice_sample_url && typeof user.voice_sample_url === 'string' && user.voice_sample_url.trim() !== '') {
    return true;
  }
  return false;
}

export function parseVoiceEmbeddings(user?: Partial<Profile> | null): number[] | number[][] | null {
  if (!user || !user.voice_embeddings) return null;
  let emb = user.voice_embeddings;
  if (typeof emb === 'string') {
    try {
      emb = JSON.parse(emb);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(emb) || emb.length === 0) return null;
  return emb as number[] | number[][];
}

export function translateAuthError(msg?: string | null): string {
  if (!msg) return 'Đã xảy ra lỗi. Vui lòng thử lại.';
  const m = msg.toLowerCase();
  if (m.includes('invalid login credentials')) return 'Email hoặc mật khẩu không chính xác.';
  if (m.includes('user already registered')) return 'Email này đã được đăng ký.';
  if (m.includes('password should be at least')) return 'Mật khẩu phải có ít nhất 6 ký tự.';
  if (m.includes('email not confirmed')) return 'Vui lòng xác thực email trong hộp thư trước khi đăng nhập.';
  if (m.includes('unable to validate email') || m.includes('invalid email')) return 'Địa chỉ email không hợp lệ.';
  if (m.includes('rate limit') || m.includes('too many requests') || m.includes('security purposes')) {
    return 'Bạn thao tác quá nhanh, vui lòng đợi ít phút rồi thử lại.';
  }
  return msg;
}

export function getIeltsBandLabel(score?: number | null): {
  band: string;
  level: string;
  badgeClass: string;
} {
  const s = Number(score) || 0;
  if (s >= 8.5) {
    return {
      band: 'IELTS 8.5 - 9.0',
      level: 'C2 Xuất sắc',
      badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    };
  }
  if (s >= 7.5) {
    return {
      band: 'IELTS 7.5 - 8.0',
      level: 'C1 Rất tốt',
      badgeClass: 'bg-blue-50 text-blue-700 border-blue-200',
    };
  }
  if (s >= 6.5) {
    return {
      band: 'IELTS 6.5 - 7.0',
      level: 'B2 Khá',
      badgeClass: 'bg-sky-50 text-sky-700 border-sky-200',
    };
  }
  if (s >= 5.0) {
    return {
      band: 'IELTS 5.0 - 6.0',
      level: 'B1 Trung bình',
      badgeClass: 'bg-amber-50 text-amber-700 border-amber-200',
    };
  }
  if (s >= 3.5) {
    return {
      band: 'IELTS 3.5 - 4.5',
      level: 'A2 Giới hạn',
      badgeClass: 'bg-rose-50 text-rose-700 border-rose-200',
    };
  }
  return {
    band: 'IELTS 1.0 - 3.0',
    level: 'A1 Cần cải thiện',
    badgeClass: 'bg-rose-50 text-rose-700 border-rose-200',
  };
}

export function getExamTypeName(examType = 'general'): string {
  const map: Record<string, string> = {
    toeic: 'TOEIC Speaking',
    vstep: 'VSTEP Speaking',
    ielts: 'IELTS Speaking',
    general: 'Luyện tập chung',
  };
  return map[(examType || 'general').toLowerCase()] || 'Luyện tập chung';
}

export function getAvatarUrl(name?: string | null, size = 128): string {
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(name || 'User')}&background=0F172A&color=fff&size=${size}`;
}

export function formatScoreValue(val?: number | null): string {
  if (val == null || Number.isNaN(Number(val))) return '--';
  return Number(val).toFixed(1);
}

export function scoreTextColorClass(val?: number | null): string {
  const n = Number(val) || 0;
  if (n >= 8) return 'text-emerald-600';
  if (n >= 6) return 'text-sky-600';
  if (n >= 4) return 'text-amber-600';
  return 'text-rose-600';
}

export function scoreBadgeBgClass(val?: number | null): string {
  const n = Number(val) || 0;
  if (n >= 8) return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (n >= 6) return 'bg-amber-50 text-amber-700 border-amber-200';
  return 'bg-rose-50 text-rose-700 border-rose-200';
}

export function formatDurationReadable(sec?: number | null): string {
  const s = Math.max(0, Number(sec) || 0);
  if (s < 60) return `${s.toFixed(1)}s`;
  const mins = Math.floor(s / 60);
  const rem = Math.round(s % 60);
  const hrs = Math.floor(mins / 60);
  const m = mins % 60;
  if (hrs > 0) return `${hrs}g ${String(m).padStart(2, '0')}p ${String(rem).padStart(2, '0')}s`;
  return `${mins}p ${String(rem).padStart(2, '0')}s`;
}

export function getLevelLabel(level?: string | null): string {
  const map: Record<string, string> = {
    beginner: 'Cơ bản',
    intermediate: 'Trung cấp',
    advanced: 'Nâng cao',
  };
  const key = (level || '').trim().toLowerCase();
  return map[key] || level || 'Chưa phân loại';
}

export function formatFriendlyStep(step?: string | null): string {
  if (!step) return 'Đang xử lý...';
  const s = step.toLowerCase();
  if (s.includes('hàng đợi') || s.includes('khởi tạo')) return 'Đang chờ xử lý...';
  if (s.includes('chuẩn hóa')) return 'Đang chuẩn bị bản ghi âm...';
  if (s.includes('embedding') || s.includes('tách') || s.includes('diarization')) {
    return 'Đang nhận diện giọng nói...';
  }
  if (s.includes('mô hình') || s.includes('speechocean') || s.includes('mdd') || s.includes('2 models')) {
    return 'Đang chấm điểm phát âm...';
  }
  if (s.includes('whisper') || s.includes('en/vi') || s.includes('ngôn ngữ')) {
    return 'Đang phân tích nội dung và ngôn ngữ...';
  }
  if (s.includes('single speaker') || s.includes('vad') || s.includes('giọng nói')) {
    return 'Đang phân tích giọng nói...';
  }
  if (s.includes('tổng hợp') || s.includes('lưu') || s.includes('hoàn tất')) {
    return 'Đang tổng hợp kết quả...';
  }
  return step.replace(/\([^)]*\)/g, '').trim() || 'Đang xử lý...';
}

export function formatTimestamp(sec?: number | null): string {
  const s = Math.max(0, Number(sec) || 0);
  const mins = Math.floor(s / 60);
  const rem = s - mins * 60;
  const hrs = Math.floor(mins / 60);
  const m = mins % 60;
  const wholeSec = Math.floor(rem);
  if (hrs > 0) {
    return `${String(hrs).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(wholeSec).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(wholeSec).padStart(2, '0')}`;
}

