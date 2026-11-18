'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  CloudUpload,
  FileAudio,
  Loader2,
  Mic,
  RotateCcw,
  Square,
  Trash2,
  Volume2,
} from 'lucide-react';
import { Modal } from './ui/Modal';
import { LiveAudioVisualizer } from './ui/AnalyticsCharts';
import {
  ENROLLMENT_SENTENCES,
  computeMeanNormalizedEmbedding,
  cosineSimilarity,
  fetchEmbeddingFromBackend,
  uploadVoiceSample,
} from '@/lib/voice';
import { useToast } from './ToastProvider';

interface VoiceEnrollModalProps {
  open: boolean;
  gpuUrl: string;
  userId?: string | null;
  allowSkip?: boolean;
  onSkip?: () => void;
  onClose: () => void;
  onSaved: (payload: { embeddings: number[]; voiceUrl: string | null }) => Promise<void> | void;
}

interface SentenceRecordState {
  recording: boolean;
  processing: boolean;
  blob?: Blob;
  audioUrl?: string;
  embedding?: number[];
  similarityPct?: number | null;
  error?: string | null;
}

interface UploadedVoiceFile {
  file: File;
  objectUrl: string;
}

export function VoiceEnrollModal({
  open,
  gpuUrl,
  userId,
  allowSkip = false,
  onSkip,
  onClose,
  onSaved,
}: VoiceEnrollModalProps) {
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState<'record' | 'upload'>('record');
  const [sentences, setSentences] = useState<SentenceRecordState[]>(() =>
    ENROLLMENT_SENTENCES.map(() => ({ recording: false, processing: false })),
  );
  const [activeStream, setActiveStream] = useState<{ idx: number; stream: MediaStream } | null>(null);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedVoiceFile[]>([]);
  const [uploadedEmbeddings, setUploadedEmbeddings] = useState<number[][]>([]);
  const [uploadStatus, setUploadStatus] = useState<{
    state: 'idle' | 'checking' | 'ready' | 'error';
    message?: string;
  }>({ state: 'idle' });
  const [dragOver, setDragOver] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const recordersRef = useRef<Record<number, { recorder: MediaRecorder; stream: MediaStream }>>({});
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const sentencesRef = useRef(sentences);
  sentencesRef.current = sentences;

  const stopAllStreams = useCallback(() => {
    for (const key of Object.keys(recordersRef.current)) {
      const idx = Number(key);
      const entry = recordersRef.current[idx];
      if (entry?.recorder && entry.recorder.state === 'recording') {
        try {
          entry.recorder.stop();
        } catch {
          // ignore
        }
      }
      if (entry?.stream) {
        try {
          entry.stream.getTracks().forEach((t) => t.stop());
        } catch {
          // ignore
        }
      }
      delete recordersRef.current[idx];
    }
    setActiveStream(null);
  }, []);

  const resetAll = useCallback(() => {
    stopAllStreams();
    setSentences((prev) => {
      prev.forEach((s) => {
        if (s.audioUrl) URL.revokeObjectURL(s.audioUrl);
      });
      return ENROLLMENT_SENTENCES.map(() => ({ recording: false, processing: false }));
    });
    setUploadedFiles((prev) => {
      prev.forEach((u) => URL.revokeObjectURL(u.objectUrl));
      return [];
    });
    setUploadedEmbeddings([]);
    setUploadStatus({ state: 'idle' });
    setModalError(null);
    setSaving(false);
    setActiveTab('record');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [stopAllStreams]);

  useEffect(() => {
    if (!open) {
      stopAllStreams();
    } else {
      resetAll();
    }
  }, [open, resetAll, stopAllStreams]);

  useEffect(() => {
    return () => {
      stopAllStreams();
    };
  }, [stopAllStreams]);

  const handleToggleRecord = async (idx: number) => {
    setModalError(null);
    if (!gpuUrl.trim()) {
      setModalError('Tính năng nhận diện giọng nói hiện chưa sẵn sàng. Bạn có thể bỏ qua bước này và cập nhật sau trong Hồ sơ.');
      return;
    }

    const existing = recordersRef.current[idx];
    if (existing && existing.recorder.state === 'recording') {
      existing.recorder.stop();
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          noiseSuppression: true,
          echoCancellation: true,
          autoGainControl: true,
        },
      });

      setActiveStream({ idx, stream });
      const recorder = new MediaRecorder(stream);
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        delete recordersRef.current[idx];
        setActiveStream((curr) => (curr?.idx === idx ? null : curr));

        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        setSentences((prev) =>
          prev.map((item, i) =>
            i === idx ? { ...item, recording: false, processing: true, error: null } : item,
          ),
        );

        try {
          const emb = await fetchEmbeddingFromBackend(blob, gpuUrl);
          const prevEmbeddings = sentencesRef.current
            .map((item, i) => (i !== idx ? item.embedding : undefined))
            .filter((v): v is number[] => Array.isArray(v) && v.length > 0);

          let avgSim: number | null = null;
          if (prevEmbeddings.length > 0) {
            const sumSim = prevEmbeddings.reduce((acc, p) => acc + cosineSimilarity(emb, p), 0);
            avgSim = sumSim / prevEmbeddings.length;
            if (avgSim < 0.5) {
              const pct = Math.round(avgSim * 100);
              setSentences((prev) =>
                prev.map((item, i) => {
                  if (i !== idx) return item;
                  if (item.audioUrl) URL.revokeObjectURL(item.audioUrl);
                  return {
                    recording: false,
                    processing: false,
                    similarityPct: pct,
                    error: `Giọng đọc chưa khớp câu trước (${pct}%). Vui lòng đọc lại!`,
                  };
                }),
              );
              showToast(`Giọng đọc câu ${idx + 1} chưa đồng nhất (${pct}%). Hãy đọc lại.`, 'danger');
              return;
            }
          }

          const objUrl = URL.createObjectURL(blob);
          const pct = avgSim != null ? Math.round(avgSim * 100) : null;
          setSentences((prev) =>
            prev.map((item, i) => {
              if (i !== idx) return item;
              if (item.audioUrl) URL.revokeObjectURL(item.audioUrl);
              return {
                recording: false,
                processing: false,
                blob,
                audioUrl: objUrl,
                embedding: emb,
                similarityPct: pct,
                error: null,
              };
            }),
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Không thể ghi nhận mẫu giọng. Vui lòng thử lại.';
          setSentences((prev) =>
            prev.map((item, i) =>
              i === idx
                ? { ...item, recording: false, processing: false, error: msg }
                : item,
            ),
          );
          showToast(msg, 'danger');
        }
      };

      recorder.start();
      recordersRef.current[idx] = { recorder, stream };
      setSentences((prev) =>
        prev.map((item, i) =>
          i === idx ? { ...item, recording: true, processing: false, error: null } : item,
        ),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Không thể truy cập micro';
      setModalError(`Không thể truy cập microphone: ${msg}`);
    }
  };

  const handleFilesSelected = async (files: FileList | null) => {
    setModalError(null);
    if (!files || files.length === 0) return;
    if (!gpuUrl.trim()) {
      setModalError('Tính năng nhận diện giọng nói hiện chưa sẵn sàng. Bạn có thể bỏ qua bước này và cập nhật sau trong Hồ sơ.');
      return;
    }

    const valid = Array.from(files).filter((f) => {
      const isAudio =
        f.type.startsWith('audio/') ||
        f.type === 'video/mp4' ||
        /\.(wav|mp3|m4a|ogg|webm|aac)$/i.test(f.name);
      return isAudio && f.size <= 10 * 1024 * 1024;
    });

    if (valid.length === 0) {
      setModalError('Vui lòng chọn tệp âm thanh hợp lệ dung lượng dưới 10MB.');
      return;
    }

    uploadedFiles.forEach((u) => URL.revokeObjectURL(u.objectUrl));
    const mapped = valid.map((file) => ({ file, objectUrl: URL.createObjectURL(file) }));
    setUploadedFiles(mapped);
    setUploadedEmbeddings([]);
    setUploadStatus({ state: 'checking', message: `Đang phân tích ${valid.length} file âm thanh...` });

    try {
      const embs: number[][] = [];
      for (const file of valid) {
        embs.push(await fetchEmbeddingFromBackend(file, gpuUrl));
      }

      if (embs.length === 1) {
        setUploadedEmbeddings(embs);
        setUploadStatus({
          state: 'ready',
          message: 'Đã ghi nhận 1 mẫu giọng nói thành công.',
        });
      } else {
        let totalSim = 0;
        let count = 0;
        for (let i = 0; i < embs.length; i++) {
          for (let j = i + 1; j < embs.length; j++) {
            totalSim += cosineSimilarity(embs[i], embs[j]);
            count++;
          }
        }
        const avgSim = count > 0 ? totalSim / count : 0;
        const pct = Math.round(avgSim * 100);
        if (avgSim < 0.5) {
          setUploadedEmbeddings([]);
          setUploadStatus({
            state: 'error',
            message: `Các file âm thanh không đồng nhất (độ khớp ${pct}%). Vui lòng chọn lại cùng một người nói.`,
          });
        } else {
          setUploadedEmbeddings(embs);
          setUploadStatus({
            state: 'ready',
            message: `Đã kiểm tra ${embs.length} file khớp cùng người nói (độ tương đồng ${pct}%).`,
          });
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Không thể phân tích file âm thanh';
      setUploadedEmbeddings([]);
      setUploadStatus({ state: 'error', message: msg });
    }
  };

  const recordedCount = sentences.filter((s) => s.embedding).length;
  const allRecordedReady = sentences.every((s) => Boolean(s.blob && s.embedding));
  const uploadReady = uploadStatus.state === 'ready' && uploadedEmbeddings.length > 0;
  const canSave = activeTab === 'record' ? allRecordedReady : uploadReady;

  const handleSave = async () => {
    setModalError(null);
    const vectors =
      activeTab === 'upload'
        ? uploadedEmbeddings
        : sentences.map((s) => s.embedding).filter((v): v is number[] => Array.isArray(v));

    if (!vectors.length) {
      setModalError('Chưa có dữ liệu mẫu giọng hợp lệ để lưu.');
      return;
    }

    setSaving(true);
    try {
      const meanEmb = computeMeanNormalizedEmbedding(vectors);
      let voiceUrl: string | null = null;
      const sampleBlob =
        activeTab === 'upload' ? uploadedFiles[0]?.file : sentences[0]?.blob;

      if (userId && sampleBlob) {
        try {
          const extName =
            activeTab === 'upload' && uploadedFiles[0]?.file?.name
              ? uploadedFiles[0].file.name
              : 'voice_sample.webm';
          voiceUrl = await uploadVoiceSample(userId, sampleBlob, extName);
        } catch {
          voiceUrl = null;
        }
      }

      await onSaved({ embeddings: meanEmb, voiceUrl });
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Lỗi lưu mẫu giọng';
      setModalError(msg);
      showToast(msg, 'danger');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={allowSkip ? onSkip || onClose : onClose}
      closeOnBackdrop={!allowSkip}
      maxWidthClass="max-w-2xl"
      title={
        <span className="flex items-center gap-2">
          <Mic className="h-5 w-5 text-blue-600" />
          Đăng ký Mẫu Giọng Nói
        </span>
      }
      subtitle="Hệ thống sử dụng mẫu giọng này để nhận diện và phân biệt chính xác giọng nói của bạn khi chấm điểm."
      footer={
        <>
          {allowSkip && onSkip && (
            <button
              type="button"
              onClick={onSkip}
              disabled={saving}
              className="mr-auto rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 transition"
            >
              Bỏ qua, đăng ký sau trong Hồ sơ
            </button>
          )}
          {!allowSkip && (
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition"
            >
              Hủy
            </button>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave || saving}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-5 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-45 transition-colors duration-150"
          >
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Đang lưu mẫu giọng...
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4" />
                Lưu Mẫu Giọng
              </>
            )}
          </button>
        </>
      }
    >
      {modalError && (
        <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
          <span>{modalError}</span>
        </div>
      )}

      {!gpuUrl.trim() && (
        <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <span>
            Tính năng nhận diện giọng nói hiện đang tạm ngoại tuyến. Bạn vẫn có thể bỏ qua bước này và thu âm lại sau trong Hồ sơ cá nhân.
          </span>
        </div>
      )}

      <div className="mb-4 flex gap-1.5 rounded-2xl border border-slate-200 bg-slate-100 p-1">
        <button
          type="button"
          onClick={() => setActiveTab('record')}
          className={`flex-1 rounded-xl px-3 py-2 text-xs sm:text-sm font-semibold transition flex items-center justify-center gap-2 ${
            activeTab === 'record'
              ? 'bg-white text-blue-700 shadow-sm'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Mic className="h-4 w-4" />
          Ghi âm 5 câu ({recordedCount}/5)
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('upload')}
          className={`flex-1 rounded-xl px-3 py-2 text-xs sm:text-sm font-semibold transition flex items-center justify-center gap-2 ${
            activeTab === 'upload'
              ? 'bg-white text-blue-700 shadow-sm'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <CloudUpload className="h-4 w-4" />
          Tải file âm thanh
        </button>
      </div>

      {activeTab === 'record' ? (
        <div className="space-y-3">
          {ENROLLMENT_SENTENCES.map((text, idx) => {
            const st = sentences[idx];
            const recorded = Boolean(st?.embedding);
            const isRecThis = Boolean(st?.recording && activeStream?.idx === idx);
            return (
              <div
                key={idx}
                className={`rounded-2xl border p-3.5 transition ${
                  recorded
                    ? 'border-emerald-200 bg-emerald-50/70'
                    : st?.error
                      ? 'border-rose-200 bg-rose-50/75'
                      : isRecThis
                        ? 'border-blue-300 bg-blue-50/50 shadow-sm'
                        : 'border-slate-200 bg-slate-50/60'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
                    {idx + 1}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="mb-2.5 text-sm italic text-slate-800 font-medium">&ldquo;{text}&rdquo;</p>
                    <div className="flex flex-wrap items-center gap-2.5">
                      <button
                        type="button"
                        disabled={st?.processing || saving}
                        onClick={() => handleToggleRecord(idx)}
                        className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold transition ${
                          st?.recording
                            ? 'bg-rose-600 text-white recording-pulse'
                            : recorded
                              ? 'border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100'
                              : 'border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100'
                        } disabled:opacity-50`}
                      >
                        {st?.processing ? (
                          <>
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            Đang xử lý...
                          </>
                        ) : st?.recording ? (
                          <>
                            <Square className="h-3.5 w-3.5" />
                            Dừng ghi
                          </>
                        ) : recorded ? (
                          <>
                            <RotateCcw className="h-3.5 w-3.5" />
                            Ghi lại
                          </>
                        ) : (
                          <>
                            <Mic className="h-3.5 w-3.5" />
                            Ghi âm
                          </>
                        )}
                      </button>

                      {recorded && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-100/80 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          {st.similarityPct != null ? `Khớp ${st.similarityPct}%` : 'Mẫu gốc'}
                        </span>
                      )}

                      {isRecThis && (
                        <div className="flex items-center gap-2">
                          <LiveAudioVisualizer
                            stream={activeStream?.stream}
                            active
                            mode="recording"
                            barCount={7}
                            height={26}
                          />
                          <span className="text-xs font-semibold text-rose-600">Đang thu âm...</span>
                        </div>
                      )}

                      {st?.error && (
                        <span className="text-xs text-rose-700 font-medium">{st.error}</span>
                      )}
                    </div>

                    {st?.audioUrl && (
                      <audio controls src={st.audioUrl} className="mt-2.5 h-8 w-full" />
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="space-y-4">
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
              handleFilesSelected(e.dataTransfer.files);
            }}
            className={`upload-dropzone ${dragOver ? 'dragover' : ''}`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*"
              multiple
              className="hidden"
              onChange={(e) => handleFilesSelected(e.target.files)}
            />
            <CloudUpload className="mx-auto mb-2 h-10 w-10 text-blue-500" />
            <p className="font-semibold text-slate-800">Kéo thả hoặc nhấn chọn tệp âm thanh</p>
            <p className="mt-1 text-xs text-slate-500">
              Hỗ trợ các tệp ghi âm phổ biến (dưới 10MB). Có thể chọn nhiều tệp của cùng một người nói.
            </p>
          </div>

          {uploadedFiles.length > 0 && (
            <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  {uploadStatus.state === 'checking' && (
                    <Loader2 className="h-4 w-4 animate-spin text-sky-600" />
                  )}
                  {uploadStatus.state === 'ready' && (
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  )}
                  {uploadStatus.state === 'error' && (
                    <AlertTriangle className="h-4 w-4 text-rose-600" />
                  )}
                  <span
                    className={
                      uploadStatus.state === 'ready'
                        ? 'text-emerald-700'
                        : uploadStatus.state === 'error'
                          ? 'text-rose-700'
                          : 'text-sky-700'
                    }
                  >
                    {uploadStatus.message}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    uploadedFiles.forEach((u) => URL.revokeObjectURL(u.objectUrl));
                    setUploadedFiles([]);
                    setUploadedEmbeddings([]);
                    setUploadStatus({ state: 'idle' });
                    if (fileInputRef.current) fileInputRef.current.value = '';
                  }}
                  className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50 transition"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Xóa
                </button>
              </div>

              <div className="space-y-2">
                {uploadedFiles.map((item, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-2.5"
                  >
                    <FileAudio className="h-4 w-4 shrink-0 text-blue-600" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-semibold text-slate-800">
                        {i + 1}. {item.file.name}
                      </div>
                      <audio controls src={item.objectUrl} className="mt-1.5 h-8 w-full" />
                    </div>
                    <Volume2 className="h-4 w-4 shrink-0 text-slate-400" />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
