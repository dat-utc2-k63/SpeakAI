'use client';

import React, { useMemo, useRef, useState } from 'react';
import {
  AudioWaveform,
  BarChart3,
  Clock,
  CloudUpload,
  FileSpreadsheet,
  Languages,
  Loader2,
  Search,
  Trash2,
} from 'lucide-react';
import { getAuthHeaders } from '@/lib/auth';
import {
  formatDurationReadable,
  formatFriendlyStep,
  formatTimestamp,
} from '@/lib/utils';
import {
  ClassroomTimelineStrip,
  PageHeader,
  RatioDonutChart,
} from './ui/AnalyticsCharts';
import { useToast } from './ToastProvider';
import type { ClassroomAnalysisResult, Profile } from '@/lib/types';

interface ClassroomAnalysisViewProps {
  mode: 'admin' | 'teacher_self';
  profiles?: Profile[];
  lockedProfile?: Profile | null;
  gpuUrl: string;
  onNavigateProfile?: () => void;
}

function csvCell(value: unknown): string {
  const str = String(value ?? '').replace(/"/g, '""');
  return `"${str}"`;
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
  gpuUrl,
}: ClassroomAnalysisViewProps) {
  const { showToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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

  const [langFilter, setLangFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

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
          showToast('Phân tích Language Timeline tiết học hoàn tất!', 'success');
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
        'Tiếng Anh - Thời lượng (giây)',
        'Tiếng Việt - Thời lượng (giây)',
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
        result.duration?.en_speech_sec ?? 0,
        result.duration?.vi_speech_sec ?? 0,
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
        const isVi = seg.language === 'vi' || (seg.language !== 'en' && Number(seg.vi_percent || 0) >= 50);
        return [
          Number(seg.index) + 1,
          seg.start_sec,
          seg.end_sec,
          seg.duration_sec,
          isVi ? 'VI (Tiếng Việt)' : 'EN (Tiếng Anh)',
          seg.word_count ?? seg.total_words ?? 0,
          seg.transcript,
        ];
      }),
    ];

    const csvBody = '\uFEFF' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    triggerFileDownload(
      `classroom-language-timeline-${stamp}.csv`,
      csvBody,
      'text/csv;charset=utf-8',
    );
    showToast('Đã tải xuống báo cáo Excel (.csv)!', 'success');
  };

  const filteredSegments = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return timelineSegments.filter((seg) => {
      const isVi = seg.language === 'vi' || (seg.language !== 'en' && Number(seg.vi_percent || 0) >= 50);
      if (langFilter === 'vi' && !isVi) return false;
      if (langFilter === 'en' && isVi) return false;
      if (q && !String(seg.transcript || '').toLowerCase().includes(q)) return false;
      return true;
    });
  }, [timelineSegments, langFilter, searchQuery]);

  const canRun = Boolean(audioFile && !running);
  const enPct = Number(result?.overall?.en_percent || 0);
  const viPct = Number(result?.overall?.vi_percent || 0);
  const enWords = Number(result?.overall?.en_words || 0);
  const viWords = Number(result?.overall?.vi_words || 0);
  const totalWords = Number(result?.overall?.total_words || enWords + viWords);
  const enSec = Number(result?.duration?.en_speech_sec ?? 0);
  const viSec = Number(result?.duration?.vi_speech_sec ?? 0);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="PHÂN TÍCH NGÔN NGỮ TIẾT HỌC"
        title="Language Timeline Tiếng Anh / Tiếng Việt (EN / VI)"
        subtitle="Phiên âm tự động bằng Whisper Word Timestamps + phân loại song ngữ bằng Lingua (EN/VI) và gom nhóm theo thời gian — không cần tách giọng hay đăng ký mẫu giọng."
        pill={<span>Whisper + Lingua EN/VI</span>}
      />

      <div className="section-card space-y-5">
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
                Kéo thả hoặc nhấn chọn file âm thanh buổi học
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Hỗ trợ WAV, MP3, M4A, WEBM (khuyên dùng dưới 300MB)
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
                Quy trình xử lý trực tiếp
              </div>
              <ol className="list-decimal pl-4 space-y-1">
                <li>Whisper Large-v3-Turbo trích xuất transcript + word timestamps</li>
                <li>Lingua phân loại từng từ / cụm từ EN / VI</li>
                <li>Gom nhóm liên tục theo thời gian thành Language Timeline</li>
                <li>Tổng hợp tỷ lệ EN % | VI % toàn tiết học</li>
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
                  Kết quả Language Timeline Tiết học
                </h3>
                <p className="text-xs text-slate-500">
                  File: <strong className="text-slate-900">{metaInfo?.fileName}</strong>
                  {metaInfo?.processingSec != null && (
                    <> · Thời gian xử lý: {metaInfo.processingSec.toFixed(1)}s</>
                  )}
                </p>
              </div>
              <button
                type="button"
                onClick={handleExportCsv}
                className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 transition-colors duration-150"
              >
                <FileSpreadsheet className="size-4" />
                Tải báo cáo Excel (.csv)
              </button>
            </div>

            {/* Hero Ratio Summary: EN % | VI % */}
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
              </div>
              <div className="flex h-3.5 w-full overflow-hidden rounded-full bg-slate-200">
                <div
                  className="bg-blue-600"
                  style={{ width: `${enPct}%` }}
                />
                <div
                  className="bg-amber-500"
                  style={{ width: `${viPct}%` }}
                />
              </div>
              <div className="flex flex-wrap items-center justify-between text-xs text-slate-500">
                <span>Tổng số từ nhận diện: <strong className="text-slate-800 tabular-nums">{totalWords}</strong> từ ({timelineSegments.length} khối ngôn ngữ)</span>
                <span className="tabular-nums">
                  Theo thời lượng nói: <strong className="text-blue-700">EN {Number(result.overall?.en_time_percent ?? enPct).toFixed(1)}%</strong> ·{' '}
                  <strong className="text-amber-700">VI {Number(result.overall?.vi_time_percent ?? viPct).toFixed(1)}%</strong>
                </span>
              </div>
            </div>

            {/* 2 Donut Charts + Duration Breakdown */}
            <div className="grid gap-4 lg:grid-cols-3">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
                <div className="text-xs font-semibold uppercase text-slate-700">
                  Tỷ lệ EN / VI theo số từ
                </div>
                <RatioDonutChart
                  size={122}
                  strokeWidth={14}
                  centerValue={`${enPct.toFixed(0)}%`}
                  centerLabel="EN"
                  segments={[
                    { label: 'Tiếng Anh (EN)', value: enWords, color: '#2563EB' },
                    { label: 'Tiếng Việt (VI)', value: viWords, color: '#F59E0B' },
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
                    <div className="text-slate-500">Tổng file</div>
                    <div className="font-bold text-slate-900">
                      {formatDurationReadable(result.duration?.total_audio_sec || 0)}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-2.5">
                    <div className="text-slate-500">Khoảng lặng</div>
                    <div className="font-bold text-slate-700">
                      {formatDurationReadable(result.duration?.silence_sec || 0)}
                    </div>
                  </div>
                  <div className="rounded-xl border border-sky-100 bg-sky-50/60 p-2.5">
                    <div className="text-sky-700">Nói Tiếng Anh</div>
                    <div className="font-bold text-sky-700">{formatDurationReadable(enSec)}</div>
                  </div>
                  <div className="rounded-xl border border-amber-100 bg-amber-50/60 p-2.5">
                    <div className="text-amber-700">Nói Tiếng Việt</div>
                    <div className="font-bold text-amber-700">{formatDurationReadable(viSec)}</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Interactive Language Timeline Strip */}
            <ClassroomTimelineStrip
              segments={timelineSegments}
              totalAudioSec={Number(result.duration?.total_audio_sec || 0)}
            />
          </div>

          <div className="section-card space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm font-bold text-slate-900">
                Chi tiết Language Timeline ({filteredSegments.length}/{timelineSegments.length} khối)
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Tìm nội dung..."
                    className="rounded-xl border border-slate-200 bg-slate-50/80 py-2 pl-8 pr-3 text-xs text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none"
                  />
                </div>
                <select
                  value={langFilter}
                  onChange={(e) => setLangFilter(e.target.value)}
                  className="rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2 text-xs text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none"
                >
                  <option value="">Tất cả ngôn ngữ (EN &amp; VI)</option>
                  <option value="en">Chỉ Tiếng Anh (EN)</option>
                  <option value="vi">Chỉ Tiếng Việt (VI)</option>
                </select>
              </div>
            </div>

            {/* DESKTOP TABLE (md+) */}
            <div className="hidden md:block overflow-x-auto rounded-2xl border border-slate-200">
              <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="px-3.5 py-2.5 font-semibold">#</th>
                    <th className="px-3.5 py-2.5 font-semibold">Thời gian</th>
                    <th className="px-3.5 py-2.5 font-semibold">Ngôn ngữ</th>
                    <th className="px-3.5 py-2.5 font-semibold">Số từ</th>
                    <th className="px-3.5 py-2.5 font-semibold">Nội dung nói</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {filteredSegments.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                        Không có đoạn thoại nào khớp bộ lọc hiện tại.
                      </td>
                    </tr>
                  ) : (
                    filteredSegments.map((seg) => {
                      const isVi =
                        seg.language === 'vi' ||
                        (seg.language !== 'en' && Number(seg.vi_percent || 0) >= 50);
                      return (
                        <tr key={seg.index} className="hover:bg-slate-50/75">
                          <td className="px-3.5 py-2.5 text-slate-500 font-medium">
                            {Number(seg.index) + 1}
                          </td>
                          <td className="px-3.5 py-2.5 whitespace-nowrap">
                            <div className="font-mono text-slate-800">
                              {formatTimestamp(seg.start_sec)} – {formatTimestamp(seg.end_sec)}
                            </div>
                            <div className="text-[11px] text-slate-400">
                              {Number(seg.duration_sec || 0).toFixed(1)}s
                            </div>
                          </td>
                          <td className="px-3.5 py-2.5 whitespace-nowrap">
                            {isVi ? (
                              <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 font-bold text-amber-700">
                                VI · Tiếng Việt
                              </span>
                            ) : (
                              <span className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-2.5 py-0.5 font-bold text-sky-700">
                                EN · Tiếng Anh
                              </span>
                            )}
                          </td>
                          <td className="px-3.5 py-2.5 font-semibold text-slate-700 tabular-nums">
                            {seg.word_count ?? seg.total_words ?? 0}
                          </td>
                          <td className="px-3.5 py-2.5 text-slate-800 leading-relaxed">
                            {seg.transcript}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* MOBILE SEGMENT CARDS (< md) */}
            <div className="space-y-2.5 md:hidden">
              {filteredSegments.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-xs text-slate-400">
                  Không có đoạn thoại nào khớp bộ lọc hiện tại.
                </div>
              ) : (
                filteredSegments.map((seg) => {
                  const isVi =
                    seg.language === 'vi' ||
                    (seg.language !== 'en' && Number(seg.vi_percent || 0) >= 50);
                  return (
                    <div
                      key={seg.index}
                      className="rounded-2xl border border-slate-200 bg-slate-50/60 p-3.5 space-y-2"
                    >
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-mono text-[11px] font-semibold text-slate-500">
                          #{Number(seg.index) + 1} · {formatTimestamp(seg.start_sec)} –{' '}
                          {formatTimestamp(seg.end_sec)} ({Number(seg.duration_sec || 0).toFixed(1)}s)
                        </span>
                        {isVi ? (
                          <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-700">
                            VI
                          </span>
                        ) : (
                          <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-bold text-sky-700">
                            EN
                          </span>
                        )}
                      </div>
                      <p className="text-sm leading-relaxed text-slate-800">{seg.transcript}</p>
                      <div className="text-[11px] text-slate-500">{seg.word_count ?? seg.total_words ?? 0} từ</div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
