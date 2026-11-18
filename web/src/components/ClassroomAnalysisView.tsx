'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AudioWaveform,
  BarChart3,
  CheckCircle2,
  Clock,
  CloudUpload,
  FileSpreadsheet,
  History,
  Languages,
  Loader2,
  Save,
  Trash2,
} from 'lucide-react';
import { getAuthHeaders } from '@/lib/auth';
import {
  deleteClassroomAnalysis,
  fetchClassLessons,
  fetchClassroomAnalysesPage,
  fetchMyManagedClasses,
  saveClassroomAnalysis,
} from '@/lib/classes';
import {
  formatDurationReadable,
  formatFriendlyStep,
} from '@/lib/utils';
import {
  ClassroomTimelineStrip,
  PageHeader,
  RatioDonutChart,
} from './ui/AnalyticsCharts';
import { Pagination } from './ui/Pagination';
import { useToast } from './ToastProvider';
import type {
  ClassRecord,
  ClassroomAnalysisRecord,
  ClassroomAnalysisResult,
  LessonRecord,
  Profile,
} from '@/lib/types';

interface ClassroomAnalysisViewProps {
  mode: 'admin' | 'teacher_self';
  profiles?: Profile[];
  lockedProfile?: Profile | null;
  gpuUrl: string;
  initialClassId?: string;
  initialLessonId?: string;
  onNavigateProfile?: () => void;
}

function csvCell(value: unknown): string {
  const str = String(value ?? '').replace(/"/g, '""');
  return `"${str}"`;
}

function resolveSegmentLang(seg: {
  language?: string;
  vi_percent?: number;
}): 'en' | 'vi' | 'unknown' {
  if (seg.language === 'unknown') return 'unknown';
  if (seg.language === 'vi') return 'vi';
  if (seg.language === 'en') return 'en';
  return Number(seg.vi_percent || 0) >= 50 ? 'vi' : 'en';
}

function triggerFileDownload(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ClassroomAnalysisView({
  mode,
  lockedProfile,
  gpuUrl,
  initialClassId = '',
  initialLessonId = '',
}: ClassroomAnalysisViewProps) {
  const { showToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [subTab, setSubTab] = useState<'analyze' | 'history'>('analyze');

  // Optional Class / Lesson linking
  const [classes, setClasses] = useState<ClassRecord[]>([]);
  const [selectedClassId, setSelectedClassId] = useState(initialClassId);
  const [lessons, setLessons] = useState<LessonRecord[]>([]);
  const [selectedLessonId, setSelectedLessonId] = useState(initialLessonId);

  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioObjectUrl, setAudioObjectUrl] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const [running, setRunning] = useState(false);
  const [loadingStep, setLoadingStep] = useState('');
  const [result, setResult] = useState<ClassroomAnalysisResult | null>(null);
  const [metaInfo, setMetaInfo] = useState<{
    fileName: string;
    processingSec?: number | null;
  } | null>(null);
  const [savingToDb, setSavingToDb] = useState(false);
  const [savedRecordId, setSavedRecordId] = useState<string | null>(null);

  // Saved history
  const [historyItems, setHistoryItems] = useState<ClassroomAnalysisRecord[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyClassFilter, setHistoryClassFilter] = useState('');
  const [historyLoading, setHistoryLoading] = useState(false);

  useEffect(() => {
    const uid = lockedProfile?.id || '';
    if (!uid && mode !== 'admin') return;
    fetchMyManagedClasses(uid, mode === 'admin' ? 'admin' : 'teacher')
      .then((list) => setClasses(list))
      .catch(() => setClasses([]));
  }, [lockedProfile?.id, mode]);

  useEffect(() => {
    if (!selectedClassId) {
      setLessons([]);
      setSelectedLessonId('');
      return;
    }
    fetchClassLessons(selectedClassId)
      .then((list) => setLessons(list))
      .catch(() => setLessons([]));
  }, [selectedClassId]);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await fetchClassroomAnalysesPage({
        page: historyPage,
        pageSize: 8,
        classId: historyClassFilter,
      });
      setHistoryItems(res.items);
      setHistoryTotal(res.total);
    } catch {
      // ignore if migration not yet applied
    } finally {
      setHistoryLoading(false);
    }
  }, [historyClassFilter, historyPage]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const handleSaveAnalysis = async () => {
    if (!result || !metaInfo) return;
    const teacherId = lockedProfile?.id;
    if (!teacherId) {
      showToast('Không xác định được tài khoản để lưu kết quả.', 'danger');
      return;
    }
    setSavingToDb(true);
    try {
      const saved = await saveClassroomAnalysis({
        class_id: selectedClassId || null,
        lesson_id: selectedLessonId || null,
        teacher_id: teacherId,
        file_name: metaInfo.fileName,
        result,
      });
      setSavedRecordId(saved.id);
      showToast('Đã lưu kết quả phân tích EN/VI vào lịch sử!', 'success');
      void loadHistory();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Lỗi lưu kết quả phân tích', 'danger');
    } finally {
      setSavingToDb(false);
    }
  };

  const handleDeleteHistory = async (id: string) => {
    try {
      await deleteClassroomAnalysis(id);
      showToast('Đã xóa bản ghi phân tích tiết dạy.', 'info');
      void loadHistory();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Lỗi xóa bản ghi', 'danger');
    }
  };

  const handleViewSavedRecord = (rec: ClassroomAnalysisRecord) => {
    if (!rec.result_json) return;
    setResult(rec.result_json);
    setMetaInfo({ fileName: rec.file_name, processingSec: null });
    setSavedRecordId(rec.id);
    if (rec.class_id) setSelectedClassId(rec.class_id);
    if (rec.lesson_id) setSelectedLessonId(rec.lesson_id);
    setSubTab('analyze');
  };

  const handleSelectFile = (file?: File | null) => {
    if (!file) return;
    if (audioObjectUrl) URL.revokeObjectURL(audioObjectUrl);
    setAudioFile(file);
    setAudioObjectUrl(URL.createObjectURL(file));
  };

  const handleClearFile = () => {
    if (audioObjectUrl) URL.revokeObjectURL(audioObjectUrl);
    setAudioFile(null);
    setAudioObjectUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleRunAnalysis = async () => {
    if (!gpuUrl.trim()) {
      showToast('Hệ thống phân tích hiện chưa sẵn sàng. Vui lòng thử lại sau.', 'danger');
      return;
    }
    if (!audioFile) {
      showToast('Vui lòng chọn file âm thanh tiết dạy!', 'danger');
      return;
    }

    setRunning(true);
    setResult(null);
    setSavedRecordId(null);
    setLoadingStep('Đang tải bản ghi âm lên để phân tích...');

    try {
      const formData = new FormData();
      formData.append('audio', audioFile);

      const cleanApi = gpuUrl.trim().replace(/\/+$/, '');
      const authHeaders = await getAuthHeaders();
      const startRes = await fetch(`${cleanApi}/classroom_analyze_start`, {
        method: 'POST',
        headers: authHeaders,
        body: formData,
      });

      const startJson = (await startRes.json().catch(() => ({}))) as {
        success?: boolean;
        task_id?: string;
        error?: string;
        detail?: string;
      };
      if (!startRes.ok || !startJson.success || !startJson.task_id) {
        throw new Error(
          startJson.error || startJson.detail || `Lỗi khởi tạo tác vụ (${startRes.status})`,
        );
      }

      const taskId = startJson.task_id;
      while (true) {
        await new Promise((r) => setTimeout(r, 2000));
        const pollRes = await fetch(`${cleanApi}/classroom_status/${taskId}`, {
          headers: await getAuthHeaders(),
        });
        const pollJson = (await pollRes.json().catch(() => ({}))) as {
          success?: boolean;
          error?: string;
          detail?: string;
          data?: {
            status?: string;
            step?: string;
            result?: ClassroomAnalysisResult;
            processing_time_sec?: number;
            error?: string;
          };
        };
        if (!pollRes.ok || !pollJson.success) {
          throw new Error(
            pollJson.error || pollJson.detail || `Lỗi kiểm tra tiến độ (${pollRes.status})`,
          );
        }

        const task = pollJson.data || {};
        if (task.step) setLoadingStep(formatFriendlyStep(task.step));
        if (task.status === 'completed' && task.result) {
          setResult(task.result);
          setMetaInfo({
            fileName: audioFile.name,
            processingSec: task.processing_time_sec,
          });
          showToast('Phân tích tiết học hoàn tất!', 'success');
          break;
        }
        if (task.status === 'error') {
          throw new Error(task.error || 'Không thể hoàn thành phân tích bản ghi âm. Vui lòng thử lại.');
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Lỗi phân tích tiết học';
      showToast(msg, 'danger');
    } finally {
      setRunning(false);
    }
  };

  const timelineSegments = useMemo(
    () => result?.timeline || [],
    [result],
  );

  const handleExportCsv = () => {
    if (!result) return;
    const rows: unknown[][] = [
      [
        'Mục',
        'Tên file',
        'Tổng thời lượng (giây)',
        'Thời lượng nói (giây)',
        'Thời lượng im lặng (giây)',
        'Tiếng Anh - Từ (%)',
        'Tiếng Việt - Từ (%)',
        'Không xác định - Từ (%)',
        'Tiếng Anh - Thời lượng (giây)',
        'Tiếng Việt - Thời lượng (giây)',
        'Không xác định - Thời lượng (giây)',
        'Tổng số từ',
      ],
      [
        'TỔNG QUAN',
        metaInfo?.fileName || '',
        result.duration?.total_audio_sec ?? 0,
        result.duration?.total_speech_sec ?? 0,
        result.duration?.silence_sec ?? 0,
        result.overall?.en_percent ?? 0,
        result.overall?.vi_percent ?? 0,
        result.overall?.unknown_percent ?? 0,
        result.duration?.en_speech_sec ?? 0,
        result.duration?.vi_speech_sec ?? 0,
        result.duration?.unknown_speech_sec ?? 0,
        result.overall?.total_words ?? 0,
      ],
      [],
      [
        'STT',
        'Bắt đầu (giây)',
        'Kết thúc (giây)',
        'Thời lượng (giây)',
        'Ngôn ngữ',
        'Số từ',
        'Nội dung nói',
      ],
      ...timelineSegments.map((seg) => {
        const segLang = resolveSegmentLang(seg);
        const langLabel =
          segLang === 'unknown'
            ? 'Không xác định'
            : segLang === 'vi'
              ? 'VI (Tiếng Việt)'
              : 'EN (Tiếng Anh)';
        return [
          Number(seg.index) + 1,
          seg.start_sec,
          seg.end_sec,
          seg.duration_sec,
          langLabel,
          seg.word_count ?? seg.total_words ?? 0,
          seg.transcript,
        ];
      }),
    ];

    const csvBody = '\uFEFF' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    triggerFileDownload(
      `bao-cao-ngon-ngu-tiet-hoc-${stamp}.csv`,
      csvBody,
      'text/csv;charset=utf-8',
    );
    showToast('Đã tải xuống báo cáo Excel!', 'success');
  };

  const canRun = Boolean(audioFile && !running);
  const activeAudioUrl =
    audioObjectUrl && audioFile && metaInfo?.fileName === audioFile.name
      ? audioObjectUrl
      : null;
  const enPct = Number(result?.overall?.en_percent || 0);
  const viPct = Number(result?.overall?.vi_percent || 0);
  const unknownPct = Number(result?.overall?.unknown_percent || 0);
  const enWords = Number(result?.overall?.en_words || 0);
  const viWords = Number(result?.overall?.vi_words || 0);
  const unknownWords = Number(result?.overall?.unknown_words || 0);
  const totalWords = Number(result?.overall?.total_words || enWords + viWords + unknownWords);
  const enSec = Number(result?.duration?.en_speech_sec ?? 0);
  const viSec = Number(result?.duration?.vi_speech_sec ?? 0);
  const unknownSec = Number(result?.duration?.unknown_speech_sec ?? 0);
  const unknownTimePct = Number(result?.overall?.unknown_time_percent ?? 0);
  const hasUnknown = unknownWords > 0 || unknownPct > 0 || unknownSec > 0;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="PHÂN TÍCH NGÔN NGỮ TIẾT HỌC"
        title="Phân tích tỷ lệ Tiếng Anh / Tiếng Việt (EN / VI)"
        subtitle="Tự động nghe hiểu bản ghi âm tiết học, tách từng đoạn Tiếng Anh / Tiếng Việt theo thời gian và lưu lịch sử chất lượng tiết dạy theo lớp."
        action={
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => setSubTab('analyze')}
              className={`rounded-md px-3.5 py-1.5 text-xs font-semibold transition-colors duration-150 ${
                subTab === 'analyze'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Phân tích mới
            </button>
            <button
              type="button"
              onClick={() => setSubTab('history')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-xs font-semibold transition-colors duration-150 ${
                subTab === 'history'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <History className="size-3.5" />
              Lịch sử đã lưu ({historyTotal})
            </button>
          </div>
        }
      />

      {subTab === 'history' ? (
        <div className="space-y-4">
          <div className="section-card flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm font-semibold text-slate-900">
              Lịch sử phân tích EN / VI theo lớp ({historyTotal})
            </div>
            {classes.length > 0 && (
              <select
                value={historyClassFilter}
                onChange={(e) => {
                  setHistoryClassFilter(e.target.value);
                  setHistoryPage(1);
                }}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 focus:border-blue-600 focus:outline-none"
              >
                <option value="">Tất cả lớp học</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.code})
                  </option>
                ))}
              </select>
            )}
          </div>

          {historyLoading && historyItems.length === 0 ? (
            <div className="section-card flex items-center justify-center py-12 text-slate-500">
              <Loader2 className="mr-2 size-5 animate-spin text-blue-600" />
              <span className="text-sm">Đang tải lịch sử phân tích...</span>
            </div>
          ) : historyItems.length === 0 ? (
            <div className="section-card py-12 text-center space-y-3">
              <p className="text-sm text-slate-500">
                Chưa có bản ghi phân tích tiết dạy EN/VI nào được lưu.
              </p>
              <button
                type="button"
                onClick={() => setSubTab('analyze')}
                className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 transition-colors duration-150"
              >
                Chạy phân tích tiết dạy ngay
              </button>
            </div>
          ) : (
            <>
              <div className="grid gap-3 md:grid-cols-2">
                {historyItems.map((rec) => (
                  <div
                    key={rec.id}
                    className="section-card card-interactive flex flex-col justify-between gap-3 !p-4"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-slate-900">
                          {rec.file_name}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                          {rec.class_info?.name && (
                            <span className="rounded-md border border-blue-200 bg-blue-50 px-2 py-0.5 font-medium text-blue-700">
                              {rec.class_info.name}
                            </span>
                          )}
                          {rec.lesson?.title && (
                            <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 font-medium text-slate-700">
                              Buổi {rec.lesson.lesson_no}: {rec.lesson.title}
                            </span>
                          )}
                          <span className="tabular-nums">
                            {new Date(rec.created_at).toLocaleDateString('vi-VN')}
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDeleteHistory(rec.id)}
                        aria-label="Xóa bản ghi phân tích"
                        className="rounded-lg border border-rose-200 bg-rose-50 p-1.5 text-rose-600 hover:bg-rose-100 transition-colors duration-150"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>

                    {(() => {
                      const recUnknownPct = Number(rec.result_json?.overall?.unknown_percent || 0);
                      return (
                        <div className="space-y-1.5">
                          <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-semibold tabular-nums">
                            <span className="text-blue-600">EN: {Number(rec.en_percent).toFixed(1)}%</span>
                            {recUnknownPct > 0 && (
                              <span className="text-slate-500">
                                Không xác định: {recUnknownPct.toFixed(1)}%
                              </span>
                            )}
                            <span className="text-amber-600">VI: {Number(rec.vi_percent).toFixed(1)}%</span>
                          </div>
                          <div className="flex h-2 w-full overflow-hidden rounded-full bg-slate-200">
                            <div className="bg-blue-600" style={{ width: `${rec.en_percent}%` }} />
                            <div className="bg-amber-500" style={{ width: `${rec.vi_percent}%` }} />
                            {recUnknownPct > 0 && (
                              <div className="bg-slate-400" style={{ width: `${recUnknownPct}%` }} />
                            )}
                          </div>
                        </div>
                      );
                    })()}

                    <div className="flex items-center justify-between text-xs text-slate-500 pt-1 border-t border-slate-100">
                      <span className="tabular-nums">
                        {rec.total_words || 0} từ · {formatDurationReadable(rec.total_audio_sec || 0)}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleViewSavedRecord(rec)}
                        className="font-semibold text-blue-600 hover:text-blue-700"
                      >
                        Xem chi tiết →
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <Pagination
                compact
                page={historyPage}
                pageSize={8}
                totalCount={historyTotal}
                onPageChange={setHistoryPage}
                disabled={historyLoading}
                itemLabel="tiết dạy"
              />
            </>
          )}
        </div>
      ) : (
      <>
      <div className="section-card space-y-5">
        {classes.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2 border-b border-slate-200 pb-4">
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase text-slate-600">
                Gắn vào Lớp học (tùy chọn)
              </label>
              <select
                value={selectedClassId}
                onChange={(e) => {
                  setSelectedClassId(e.target.value);
                  setSelectedLessonId('');
                }}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
              >
                <option value="">-- Không gắn lớp (Phân tích nhanh) --</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.code})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase text-slate-600">
                Gắn vào Buổi học (tùy chọn)
              </label>
              <select
                value={selectedLessonId}
                onChange={(e) => setSelectedLessonId(e.target.value)}
                disabled={!selectedClassId || lessons.length === 0}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none disabled:bg-slate-50 disabled:text-slate-400"
              >
                <option value="">
                  {!selectedClassId
                    ? '-- Chọn lớp trước --'
                    : lessons.length === 0
                      ? '-- Lớp chưa có buổi học --'
                      : '-- Không gắn buổi cụ thể --'}
                </option>
                {lessons.map((l) => (
                  <option key={l.id} value={l.id}>
                    Buổi {l.lesson_no}: {l.title}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
        <div className="grid gap-5 lg:grid-cols-12 items-start">
          <div className="lg:col-span-8">
            <label className="mb-2 block text-xs font-semibold uppercase text-slate-600">
              Chọn file ghi âm tiết dạy
            </label>
            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                handleSelectFile(e.dataTransfer.files?.[0]);
              }}
              className={`upload-dropzone ${dragOver ? 'dragover' : ''}`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*"
                className="hidden"
                onChange={(e) => handleSelectFile(e.target.files?.[0])}
              />
              <CloudUpload className="mx-auto mb-2 h-9 w-9 text-blue-600" />
              <p className="text-sm font-bold text-slate-900">
                Kéo thả hoặc nhấn chọn tệp ghi âm buổi học
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Hỗ trợ các tệp ghi âm phổ biến (khuyên dùng dưới 300MB)
              </p>
            </div>

            {audioFile && audioObjectUrl && (
              <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50/85 p-3.5 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-bold text-slate-900">{audioFile.name}</div>
                    <div className="text-xs text-slate-500">
                      {(audioFile.size / 1024 / 1024).toFixed(1)} MB
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleClearFile}
                    className="rounded-xl border border-rose-200 bg-rose-50 p-2 text-rose-600 hover:bg-rose-100 transition"
                    title="Gỡ file"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <audio controls src={audioObjectUrl} className="h-9 w-full" />
              </div>
            )}
          </div>

          <div className="lg:col-span-4 space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-slate-50/75 p-4 space-y-2 text-xs text-slate-600">
              <div className="flex items-center gap-1.5 font-bold text-slate-800">
                <Languages className="h-4 w-4 text-blue-600" />
                Quy trình phân tích tự động
              </div>
              <ol className="list-decimal pl-4 space-y-1">
                <li>Khử nhiễu nền và chỉ giữ lại đoạn có giọng nói (loại bỏ nhạc, tạp âm, khoảng lặng)</li>
                <li>Chuyển giọng nói thành văn bản chính xác theo từng mốc thời gian</li>
                <li>Phân loại rõ Tiếng Anh, Tiếng Việt hoặc Không xác định nếu chưa đủ rõ ràng</li>
                <li>Tổng hợp biểu đồ tỷ lệ và diễn biến ngôn ngữ toàn buổi học</li>
              </ol>
            </div>

            <button
              type="button"
              disabled={!canRun}
              onClick={handleRunAnalysis}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-45 transition-colors duration-150"
            >
              {running ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Đang phân tích tiết dạy...
                </>
              ) : (
                <>
                  <AudioWaveform className="h-4 w-4" />
                  Chạy Phân tích EN / VI Tiết học
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {running && (
        <div className="section-card flex items-center gap-4 border-blue-200 bg-blue-50/75">
          <Loader2 className="h-6 w-6 shrink-0 animate-spin text-blue-600" />
          <div>
            <div className="text-sm font-bold text-slate-900">Đang phân tích bản ghi âm tiết dạy...</div>
            <div className="text-xs text-slate-600">{loadingStep}</div>
          </div>
        </div>
      )}

      {result && (
        <div className="space-y-6">
          <div className="section-card space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
              <div>
                <h3 className="flex items-center gap-2 text-base font-semibold text-slate-900">
                  <BarChart3 className="size-5 text-blue-600" />
                  Kết quả phân tích ngôn ngữ tiết học
                </h3>
                <p className="text-xs text-slate-500">
                  Bản ghi âm: <strong className="text-slate-900">{metaInfo?.fileName}</strong>
                  {metaInfo?.processingSec != null && (
                    <> · Thời gian xử lý: {metaInfo.processingSec.toFixed(1)}s</>
                  )}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {lockedProfile?.id && (
                  <button
                    type="button"
                    disabled={savingToDb || Boolean(savedRecordId)}
                    onClick={handleSaveAnalysis}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition-colors duration-150 ${
                      savedRecordId
                        ? 'border border-emerald-200 bg-emerald-50 text-emerald-700'
                        : 'bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50'
                    }`}
                  >
                    {savingToDb ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : savedRecordId ? (
                      <CheckCircle2 className="size-3.5" />
                    ) : (
                      <Save className="size-3.5" />
                    )}
                    {savedRecordId ? 'Đã lưu lịch sử' : 'Lưu vào Lịch sử tiết dạy'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleExportCsv}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 transition-colors duration-150"
                >
                  <FileSpreadsheet className="size-4" />
                  Tải báo cáo Excel
                </button>
              </div>
            </div>

            {/* Hero Ratio Summary: EN % | VI % | Không xác định % */}
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-baseline gap-2">
                  <span className="text-xs font-semibold uppercase text-blue-700">Tiếng Anh (EN)</span>
                  <span className="text-2xl font-bold text-blue-600 tabular-nums">
                    {enPct.toFixed(1)}%
                  </span>
                  <span className="text-xs text-slate-500 tabular-nums">
                    ({enWords} từ · {formatDurationReadable(enSec)})
                  </span>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-xs font-semibold uppercase text-amber-700">Tiếng Việt (VI)</span>
                  <span className="text-2xl font-bold text-amber-600 tabular-nums">
                    {viPct.toFixed(1)}%
                  </span>
                  <span className="text-xs text-slate-500 tabular-nums">
                    ({viWords} từ · {formatDurationReadable(viSec)})
                  </span>
                </div>
                {hasUnknown && (
                  <div className="flex items-baseline gap-2">
                    <span className="text-xs font-semibold uppercase text-slate-600">Không xác định</span>
                    <span className="text-2xl font-bold text-slate-600 tabular-nums">
                      {unknownPct.toFixed(1)}%
                    </span>
                    <span className="text-xs text-slate-500 tabular-nums">
                      ({unknownWords} từ · {formatDurationReadable(unknownSec)})
                    </span>
                  </div>
                )}
              </div>
              <div className="flex h-3.5 w-full overflow-hidden rounded-full bg-slate-200">
                <div className="bg-blue-600" style={{ width: `${enPct}%` }} />
                <div className="bg-amber-500" style={{ width: `${viPct}%` }} />
                {hasUnknown && (
                  <div className="bg-slate-400" style={{ width: `${unknownPct}%` }} />
                )}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                <span>
                  Tổng số từ nhận diện:{' '}
                  <strong className="text-slate-800 tabular-nums">{totalWords}</strong> từ (
                  {timelineSegments.length} khối ngôn ngữ)
                </span>
                <span className="tabular-nums">
                  Theo thời lượng nói:{' '}
                  <strong className="text-blue-700">
                    EN {Number(result.overall?.en_time_percent ?? enPct).toFixed(1)}%
                  </strong>{' '}
                  ·{' '}
                  <strong className="text-amber-700">
                    VI {Number(result.overall?.vi_time_percent ?? viPct).toFixed(1)}%
                  </strong>
                  {hasUnknown && (
                    <>
                      {' '}
                      ·{' '}
                      <strong className="text-slate-600">
                        Không xác định {unknownTimePct.toFixed(1)}%
                      </strong>
                    </>
                  )}
                </span>
              </div>
            </div>

            {/* 2 Donut Charts + Duration Breakdown */}
            <div className="grid gap-4 lg:grid-cols-3">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
                <div className="text-xs font-semibold uppercase text-slate-700">
                  Tỷ lệ ngôn ngữ theo số từ
                </div>
                <RatioDonutChart
                  size={122}
                  strokeWidth={14}
                  centerValue={`${enPct.toFixed(0)}%`}
                  centerLabel="EN"
                  segments={[
                    { label: 'Tiếng Anh (EN)', value: enWords, color: '#2563EB' },
                    { label: 'Tiếng Việt (VI)', value: viWords, color: '#F59E0B' },
                    ...(unknownWords > 0
                      ? [{ label: 'Không xác định', value: unknownWords, color: '#94A3B8' }]
                      : []),
                  ]}
                />
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
                <div className="text-xs font-semibold uppercase text-slate-700">
                  Phân bố thời lượng tiết học
                </div>
                <RatioDonutChart
                  size={122}
                  strokeWidth={14}
                  centerValue={`${Number(result.duration?.speech_ratio_percent || 0).toFixed(0)}%`}
                  centerLabel="Có lời"
                  segments={[
                    { label: 'Nói Tiếng Anh', value: enSec, color: '#2563EB' },
                    { label: 'Nói Tiếng Việt', value: viSec, color: '#F59E0B' },
                    ...(unknownSec > 0
                      ? [{ label: 'Không xác định', value: unknownSec, color: '#94A3B8' }]
                      : []),
                    { label: 'Khoảng lặng', value: Number(result.duration?.silence_sec || 0), color: '#CBD5E1' },
                  ]}
                />
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 flex flex-col justify-between">
                <div className="mb-2 flex items-center justify-between text-xs font-semibold uppercase text-slate-600">
                  <span className="flex items-center gap-1.5">
                    <Clock className="size-3.5 text-blue-600" />
                    Thời lượng ghi âm
                  </span>
                  <span className="rounded-md border border-blue-200 bg-blue-50 px-2 py-0.5 text-blue-700 tabular-nums">
                    {Number(result.duration?.speech_ratio_percent || 0).toFixed(1)}% nói
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-center text-xs">
                  <div className="rounded-xl border border-slate-200 bg-white p-2.5">
                    <div className="text-slate-500">Tổng thời lượng</div>
                    <div className="font-bold text-slate-900 tabular-nums">
                      {formatDurationReadable(result.duration?.total_audio_sec || 0)}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-2.5">
                    <div className="text-slate-500">Khoảng lặng</div>
                    <div className="font-bold text-slate-700 tabular-nums">
                      {formatDurationReadable(result.duration?.silence_sec || 0)}
                    </div>
                  </div>
                  <div className="rounded-xl border border-sky-100 bg-sky-50/60 p-2.5">
                    <div className="text-sky-700">Nói Tiếng Anh</div>
                    <div className="font-bold text-sky-700 tabular-nums">{formatDurationReadable(enSec)}</div>
                  </div>
                  <div className="rounded-xl border border-amber-100 bg-amber-50/60 p-2.5">
                    <div className="text-amber-700">Nói Tiếng Việt</div>
                    <div className="font-bold text-amber-700 tabular-nums">{formatDurationReadable(viSec)}</div>
                  </div>
                  {unknownSec > 0 && (
                    <div className="col-span-2 rounded-xl border border-slate-200 bg-slate-100/80 px-2.5 py-2 flex items-center justify-between">
                      <span className="text-slate-600">Không xác định</span>
                      <span className="font-bold text-slate-700 tabular-nums">
                        {formatDurationReadable(unknownSec)}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Interactive Language Timeline Strip (click any block to listen) */}
            <ClassroomTimelineStrip
              segments={timelineSegments}
              totalAudioSec={Number(result.duration?.total_audio_sec || 0)}
              audioUrl={activeAudioUrl}
            />
          </div>
        </div>
      )}
      </>
      )}
    </div>
  );
}
