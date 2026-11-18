'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  CloudUpload,
  History,
  Loader2,
  Mic,
  Save,
  Search,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { getAuthHeaders } from '@/lib/auth';
import { evaluateConversationWithAi } from '@/lib/aiEval';
import {
  createAssessment,
  deleteAssessment,
  fetchSavedAssessmentsPage,
  saveAssessment,
  uploadAudioUrlToSupabase,
  uploadConversationAudio,
} from '@/lib/teacher';
import {
  formatFriendlyStep,
  formatScoreValue,
  getIeltsBandLabel,
  hasVoiceEnrolled,
  parseVoiceEmbeddings,
} from '@/lib/utils';
import { Modal } from '@/components/ui/Modal';
import { Pagination } from '@/components/ui/Pagination';
import { useToast } from '@/components/ToastProvider';
import {
  PageHeader,
  ScoreRingGauge,
  SkillRadarChart,
} from '@/components/ui/AnalyticsCharts';
import { ComprehensiveAiFeedback, DialogueTimeline } from '@/components/AiFeedbackBlocks';
import { AssessmentCard, AssessmentDetailModal } from '@/components/AssessmentDetailModal';
import type {
  AiEvalResult,
  Assessment,
  AssessmentResultJson,
  DialogueTurn,
  Profile,
  PronunciationScores,
} from '@/lib/types';

interface TeacherAssessViewProps {
  currentUser: Profile;
  students: Profile[];
  gpuUrl: string;
  onNavigateProfile: () => void;
  onChanged?: () => void;
}

const HISTORY_PAGE_SIZE = 8;

export function TeacherAssessView({
  currentUser,
  students,
  gpuUrl,
  onNavigateProfile,
  onChanged,
}: TeacherAssessViewProps) {
  const { showToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [subTab, setSubTab] = useState<'new' | 'history'>('new');

  // New Assessment State
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioObjectUrl, setAudioObjectUrl] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [scoreTeacher, setScoreTeacher] = useState(false);

  const [processing, setProcessing] = useState(false);
  const [stepLabel, setStepLabel] = useState('');
  const [draftId, setDraftId] = useState<string | null>(null);
  const [analysisResult, setAnalysisResult] = useState<AssessmentResultJson | null>(null);
  const [aiEval, setAiEval] = useState<AiEvalResult | null>(null);
  const [speakerView, setSpeakerView] = useState<'student' | 'teacher'>('student');
  const [customTitle, setCustomTitle] = useState('');
  const [savingResult, setSavingResult] = useState(false);

  // History State (server-paginated)
  const [historyData, setHistoryData] = useState<{ items: Assessment[]; total: number }>({
    items: [],
    total: 0,
  });
  const [historyPage, setHistoryPage] = useState(1);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historySearch, setHistorySearch] = useState('');
  const [debouncedHistorySearch, setDebouncedHistorySearch] = useState('');
  const historyReqSeq = useRef(0);
  const [detailAssessment, setDetailAssessment] = useState<Assessment | null>(null);
  const [deletingAssessment, setDeletingAssessment] = useState<Assessment | null>(null);
  const [deletingBusy, setDeletingBusy] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setDebouncedHistorySearch(historySearch);
      setHistoryPage(1);
    }, 300);
    return () => window.clearTimeout(t);
  }, [historySearch]);

  const loadHistory = useCallback(async () => {
    const seq = ++historyReqSeq.current;
    setLoadingHistory(true);
    try {
      const res = await fetchSavedAssessmentsPage(currentUser.id, {
        page: historyPage,
        pageSize: HISTORY_PAGE_SIZE,
        search: debouncedHistorySearch,
      });
      if (seq !== historyReqSeq.current) return;
      if (res.items.length === 0 && historyPage > 1 && res.total > 0) {
        setHistoryPage(historyPage - 1);
        return;
      }
      setHistoryData({ items: res.items, total: res.total });
    } catch (err) {
      if (seq === historyReqSeq.current) {
        showToast(err instanceof Error ? err.message : 'Lỗi tải lịch sử chấm', 'danger');
      }
    } finally {
      if (seq === historyReqSeq.current) setLoadingHistory(false);
    }
  }, [currentUser.id, historyPage, debouncedHistorySearch, showToast]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const cleanupDraft = useCallback(async (id: string | null) => {
    if (!id) return;
    try {
      await deleteAssessment(id);
    } catch {
      // ignore cleanup error
    }
  }, []);

  const handleSelectFile = (file?: File | null) => {
    if (!file) return;
    if (audioObjectUrl) URL.revokeObjectURL(audioObjectUrl);
    setAudioFile(file);
    setAudioObjectUrl(URL.createObjectURL(file));
  };

  const handleClearAudio = () => {
    if (audioObjectUrl) URL.revokeObjectURL(audioObjectUrl);
    setAudioFile(null);
    setAudioObjectUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDiscardResult = async () => {
    await cleanupDraft(draftId);
    setDraftId(null);
    setAnalysisResult(null);
    setAiEval(null);
    setCustomTitle('');
  };

  const teacherEmb = useMemo(() => parseVoiceEmbeddings(currentUser), [currentUser]);
  const selectedStudent = useMemo(
    () => students.find((s) => s.id === selectedStudentId) || null,
    [students, selectedStudentId],
  );
  const studentEmb = useMemo(() => parseVoiceEmbeddings(selectedStudent), [selectedStudent]);

  const handleRunAssessment = async () => {
    if (!gpuUrl.trim()) {
      showToast('Hệ thống chấm điểm hiện chưa sẵn sàng. Vui lòng thử lại sau.', 'danger');
      return;
    }
    if (!teacherEmb) {
      showToast('Bạn chưa đăng ký mẫu giọng nói Giáo viên trong Hồ sơ.', 'danger');
      return;
    }
    if (!selectedStudent || !studentEmb) {
      showToast('Vui lòng chọn Học viên đã có mẫu giọng nói.', 'danger');
      return;
    }
    if (!audioFile) {
      showToast('Vui lòng chọn file âm thanh hội thoại 1-1!', 'danger');
      return;
    }

    if (draftId) {
      await cleanupDraft(draftId);
      setDraftId(null);
    }

    setProcessing(true);
    setAnalysisResult(null);
    setAiEval(null);
    setSpeakerView('student');
    setStepLabel('Đang tải bản ghi hội thoại lên để phân tích...');

    try {
      // Upload full conversation audio to Supabase in parallel while GPU processes it
      const uploadAudioPromise = uploadConversationAudio(currentUser.id, audioFile).catch(() => '');

      const formData = new FormData();
      formData.append('audio', audioFile);
      formData.append('teacher_embeddings_json', JSON.stringify(teacherEmb));
      formData.append('student_embeddings_json', JSON.stringify(studentEmb));
      formData.append('score_teacher', scoreTeacher ? 'true' : 'false');

      const cleanApi = gpuUrl.trim().replace(/\/+$/, '');
      const startRes = await fetch(`${cleanApi}/assess_start`, {
        method: 'POST',
        headers: await getAuthHeaders(),
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
          startJson.error || startJson.detail || 'Không thể gửi bản ghi âm để chấm điểm. Vui lòng thử lại.',
        );
      }

      const taskId = startJson.task_id;
      let gpuResult: AssessmentResultJson | null = null;
      while (true) {
        await new Promise((r) => setTimeout(r, 2000));
        const pollRes = await fetch(`${cleanApi}/assess_status/${taskId}`, {
          headers: await getAuthHeaders(),
        });
        const pollJson = (await pollRes.json().catch(() => ({}))) as {
          success?: boolean;
          error?: string;
          detail?: string;
          data?: { status?: string; step?: string; result?: AssessmentResultJson; error?: string };
        };
        if (!pollRes.ok || !pollJson.success) {
          throw new Error(pollJson.error || pollJson.detail || 'Lỗi kiểm tra tiến độ chấm bài');
        }
        const task = pollJson.data || {};
        if (task.step) setStepLabel(formatFriendlyStep(task.step));
        if (task.status === 'completed' && task.result) {
          gpuResult = task.result;
          break;
        }
        if (task.status === 'error') {
          throw new Error(task.error || 'Không thể xử lý bản ghi âm. Vui lòng thử lại.');
        }
      }

      const uploadedUrl = await uploadAudioPromise;
      const draft = await createAssessment(currentUser.id, selectedStudent.id, uploadedUrl);
      setDraftId(draft.id);

      setStepLabel('Đang tổng hợp điểm số và nhận xét chi tiết cho Học viên...');
      const turns: DialogueTurn[] = gpuResult.dialogue?.turns || gpuResult.turns || [];
      const baseScores: Partial<PronunciationScores> = gpuResult.student?.scores || {
        total: 0,
        accuracy: 0,
        fluency: 0,
        prosodic: 0,
      };

      const evalRes = await evaluateConversationWithAi({
        dialogueTurns: turns,
        pronunciationScores: baseScores,
        gpuUrlFallback: gpuUrl,
      });

      setAnalysisResult(gpuResult);
      setAiEval(evalRes);
      setCustomTitle(`Hội thoại 1-1 · ${selectedStudent.full_name}`);
      showToast('Phân tích hội thoại & chấm điểm hoàn tất!', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Lỗi chấm hội thoại', 'danger');
    } finally {
      setProcessing(false);
    }
  };

  const handleSaveAssessment = async () => {
    if (!draftId || !analysisResult || !aiEval) return;
    setSavingResult(true);

    try {
      const cleanApi = gpuUrl.trim().replace(/\/+$/, '');
      const resolveAudio = async (rawUrl: string | null | undefined, suffix: string) => {
        if (!rawUrl) return rawUrl || undefined;
        const fullUrl = rawUrl.startsWith('/audio/') && cleanApi ? `${cleanApi}${rawUrl}` : rawUrl;
        if (fullUrl.includes('trycloudflare.com') || fullUrl.startsWith('http://') || fullUrl.startsWith('https://')) {
          if (fullUrl.includes('supabase.co')) return fullUrl;
          return uploadAudioUrlToSupabase(currentUser.id, fullUrl, suffix);
        }
        return fullUrl;
      };

      const clonedResult: AssessmentResultJson = JSON.parse(JSON.stringify(analysisResult));
      const turns = clonedResult.dialogue?.turns || clonedResult.turns || [];

      // Upload all turn audio clips concurrently (6 parallel workers instead of sequential 1-by-1)
      const audioTurnIndices = turns
        .map((t, idx) => (t.audio ? idx : -1))
        .filter((idx) => idx >= 0);
      if (audioTurnIndices.length > 0) {
        let cursor = 0;
        const concurrency = Math.min(6, audioTurnIndices.length);
        await Promise.all(
          Array.from({ length: concurrency }, async () => {
            while (cursor < audioTurnIndices.length) {
              const turnIdx = audioTurnIndices[cursor++];
              const rawAudio = turns[turnIdx]?.audio;
              if (rawAudio) {
                turns[turnIdx].audio = await resolveAudio(rawAudio, `turn_${turnIdx}`);
              }
            }
          }),
        );
      }

      clonedResult.ai_eval = aiEval;

      const sScores = clonedResult.student?.scores || {
        total: 0,
        accuracy: 0,
        fluency: 0,
        prosodic: 0,
      };

      await saveAssessment(draftId, {
        title: customTitle.trim() || `Hội thoại với ${selectedStudent?.full_name || 'Học viên'}`,
        score_total: Number(sScores.total ?? aiEval.score_total ?? 0),
        score_accuracy: Number(sScores.p ?? sScores.accuracy ?? sScores.total ?? 0),
        score_fluency: Number(sScores.fc ?? sScores.fluency ?? aiEval.score_fluency_coherence ?? 0),
        score_prosodic: Number(sScores.prosodic ?? sScores.p ?? sScores.accuracy ?? 0),
        score_grammar: sScores.gra ?? aiEval.score_grammar ?? null,
        score_context: sScores.fc ?? aiEval.score_fluency_coherence ?? aiEval.score_context ?? null,
        score_lexical: sScores.lr ?? aiEval.score_lexical ?? null,
        llm_feedback: aiEval.conversation_summary || null,
        result_json: clonedResult,
      });

      setDraftId(null);
      setAnalysisResult(null);
      setAiEval(null);
      handleClearAudio();
      showToast('Đã lưu kết quả chấm vào Lịch sử!', 'success');
      setSubTab('history');
      void loadHistory();
      onChanged?.();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Lỗi lưu kết quả đánh giá', 'danger');
    } finally {
      setSavingResult(false);
    }
  };

  const handleConfirmDeleteSaved = async () => {
    if (!deletingAssessment) return;
    setDeletingBusy(true);
    try {
      await deleteAssessment(deletingAssessment.id);
      setDeletingAssessment(null);
      showToast('Đã xóa bản ghi đánh giá.', 'info');
      await loadHistory();
      onChanged?.();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Lỗi xóa bản ghi', 'danger');
    } finally {
      setDeletingBusy(false);
    }
  };

  const activeScores = useMemo(() => {
    if (!analysisResult) return null;
    if (speakerView === 'teacher') {
      const tScores = analysisResult.teacher?.scores;
      if (tScores && (tScores.total != null || tScores.p != null || tScores.accuracy != null)) {
        return {
          total: Number(tScores.total ?? 0),
          pr: Number(tScores.p ?? tScores.accuracy ?? tScores.total ?? 0),
          fc: tScores.fc ?? null,
          lr: tScores.lr ?? null,
          gra: tScores.gra ?? null,
        };
      }
      if (analysisResult.teacher?.sentences) {
        const scored = analysisResult.teacher.sentences.filter((s) => s.scores?.total != null);
        if (scored.length === 0) return { total: 0, pr: 0, fc: null, lr: null, gra: null };
        const avg = (fn: (s: NonNullable<(typeof scored)[number]['scores']>) => number) =>
          scored.reduce((a, b) => a + fn(b.scores!), 0) / scored.length;
        return {
          total: avg((s) => s.total || 0),
          pr: avg((s) => s.p ?? s.accuracy ?? 0),
          fc: null as number | null,
          lr: null as number | null,
          gra: null as number | null,
        };
      }
      return { total: 0, pr: 0, fc: null, lr: null, gra: null };
    }

    const sScores = analysisResult.student?.scores;
    return {
      total: Number(sScores?.total ?? sScores?.overall ?? aiEval?.score_total ?? 0),
      pr: Number(sScores?.p ?? sScores?.accuracy ?? sScores?.total ?? 0),
      fc: sScores?.fc ?? sScores?.context ?? aiEval?.score_fluency_coherence ?? aiEval?.score_context ?? null,
      lr: sScores?.lr ?? sScores?.lexical ?? aiEval?.score_lexical ?? null,
      gra: sScores?.gra ?? sScores?.grammar ?? aiEval?.score_grammar ?? null,
    };
  }, [analysisResult, aiEval, speakerView]);

  const turns = useMemo(
    () => analysisResult?.dialogue?.turns || analysisResult?.turns || [],
    [analysisResult],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="ĐÁNH GIÁ HỘI THOẠI 1-1"
        title="Chấm & Đánh giá Hội thoại 1-1"
        subtitle="Tải lên bản ghi hội thoại 1-1 để AI tách giọng nói, chấm điểm chi tiết và lưu lịch sử đánh giá."
        action={
          <div className="inline-flex rounded-2xl border border-slate-200 bg-slate-100/90 p-1">
            <button
              type="button"
              onClick={() => setSubTab('new')}
              className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold transition ${
                subTab === 'new'
                  ? 'bg-white text-indigo-700 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Mic className="h-3.5 w-3.5" />
              Chấm mới
            </button>
            <button
              type="button"
              onClick={() => setSubTab('history')}
              className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold transition ${
                subTab === 'history'
                  ? 'bg-white text-indigo-700 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <History className="h-3.5 w-3.5" />
              Lịch sử đã lưu ({historyData.total})
            </button>
          </div>
        }
      />

      {subTab === 'new' ? (
        <div key="tab-new" className="space-y-6 animate-tab-in">
          {!hasVoiceEnrolled(currentUser) && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50/90 p-4 text-xs text-amber-900">
              <div className="flex items-center gap-2.5">
                <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" />
                <span>
                  Bạn chưa đăng ký mẫu giọng nói Giáo viên nên AI chưa thể tách chính xác giọng của bạn khỏi giọng học viên.
                </span>
              </div>
              <button
                type="button"
                onClick={onNavigateProfile}
                className="rounded-xl bg-amber-500 px-3.5 py-2 font-bold text-white shadow-sm hover:bg-amber-600 transition"
              >
                Đăng ký giọng ngay
              </button>
            </div>
          )}

          {/* Setup Card */}
          <div className="section-card grid gap-5 lg:grid-cols-2">
            <div>
              <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-slate-600">
                1. File ghi âm hội thoại 1-1
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
                <CloudUpload className="mx-auto mb-2 h-9 w-9 text-indigo-600" />
                <p className="text-sm font-bold text-slate-900">Kéo thả hoặc chọn file âm thanh</p>
                <p className="mt-1 text-xs text-slate-500">WAV, MP3, WEBM, M4A (&lt; 300MB)</p>
              </div>

              {audioFile && audioObjectUrl && (
                <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50/85 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate font-bold text-slate-900">{audioFile.name}</span>
                    <button
                      type="button"
                      onClick={handleClearAudio}
                      className="rounded-lg border border-rose-200 bg-rose-50 p-1.5 text-rose-600 hover:bg-rose-100"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <audio controls src={audioObjectUrl} className="h-8 w-full" />
                </div>
              )}
            </div>

            <div className="space-y-4">
              <div>
                <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-slate-600">
                  2. Chọn Học viên trong lớp
                </label>
                <select
                  value={selectedStudentId}
                  onChange={(e) => setSelectedStudentId(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50/85 px-3.5 py-2.5 text-sm text-slate-900 focus:border-indigo-500 focus:bg-white focus:outline-none"
                >
                  <option value="">
                    {students.length === 0
                      ? '-- Lớp bạn chưa có học viên được gán --'
                      : '-- Chọn học viên --'}
                  </option>
                  {students.map((s) => {
                    const ready = Boolean(parseVoiceEmbeddings(s));
                    return (
                      <option key={s.id} value={s.id}>
                        {s.full_name} {ready ? '(Đã có giọng 🎙)' : '(Chưa có giọng ⚠️)'}
                      </option>
                    );
                  })}
                </select>
                {selectedStudent && !studentEmb && (
                  <p className="mt-1.5 text-xs font-medium text-amber-700">
                    Học viên này chưa đăng ký mẫu giọng nói trong Hồ sơ.
                  </p>
                )}
              </div>

              <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50/80 p-3.5 text-xs font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={scoreTeacher}
                  onChange={(e) => setScoreTeacher(e.target.checked)}
                  className="h-4 w-4 rounded accent-indigo-600"
                />
                <span>Chấm thêm điểm phát âm cho lượt nói của Giáo viên (tùy chọn)</span>
              </label>

              <button
                type="button"
                disabled={processing || !audioFile || !teacherEmb || !studentEmb}
                onClick={handleRunAssessment}
                className="btn-glow inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-indigo-600/20 hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-45 transition"
              >
                {processing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Đang xử lý...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" />
                    Bắt đầu Tách giọng &amp; Chấm AI
                  </>
                )}
              </button>
            </div>
          </div>

          {processing && (
            <div className="section-card flex items-center gap-3 border-indigo-200 bg-indigo-50/75">
              <Loader2 className="h-5 w-5 animate-spin text-indigo-600" />
              <div className="text-sm font-medium text-slate-800">{stepLabel}</div>
            </div>
          )}

          {analysisResult && activeScores && (
            <div className="space-y-6 animate-slidein">
              <div className="section-card space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
                  <div className="flex items-center gap-2">
                    <BarChart3 className="h-5 w-5 text-indigo-600" />
                    <h3 className="text-base font-bold text-slate-900">
                      Kết quả Đánh giá Hội thoại 1-1
                    </h3>
                    <span
                      className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
                        getIeltsBandLabel(activeScores.total).badgeClass
                      }`}
                    >
                      {getIeltsBandLabel(activeScores.total).band}
                    </span>
                  </div>

                  {scoreTeacher && (
                    <div className="inline-flex rounded-xl border border-slate-200 bg-slate-100 p-1 text-xs">
                      <button
                        type="button"
                        onClick={() => setSpeakerView('student')}
                        className={`rounded-lg px-3 py-1 font-semibold transition ${
                          speakerView === 'student'
                            ? 'bg-white text-sky-700 shadow-sm'
                            : 'text-slate-600'
                        }`}
                      >
                        Học viên
                      </button>
                      <button
                        type="button"
                        onClick={() => setSpeakerView('teacher')}
                        className={`rounded-lg px-3 py-1 font-semibold transition ${
                          speakerView === 'teacher'
                            ? 'bg-white text-indigo-700 shadow-sm'
                            : 'text-slate-600'
                        }`}
                      >
                        Giáo viên
                      </button>
                    </div>
                  )}
                </div>

                <div className="grid items-center gap-6 md:grid-cols-12">
                  <div className="md:col-span-4 flex flex-col items-center justify-center rounded-2xl border border-slate-100 bg-slate-50/75 p-5">
                    <ScoreRingGauge
                      score={activeScores.total}
                      max={9}
                      size={150}
                      strokeWidth={13}
                      label="IELTS Band / 9.0"
                    />
                  </div>

                  <div className="md:col-span-4 flex justify-center">
                    <SkillRadarChart
                      size={220}
                      skills={[
                        { label: 'Pronunciation (P)', value: activeScores.pr },
                        { label: 'Fluency (FC)', value: activeScores.fc },
                        { label: 'Lexical (LR)', value: activeScores.lr },
                        { label: 'Grammar (GRA)', value: activeScores.gra },
                      ]}
                    />
                  </div>

                  <div className="md:col-span-4 space-y-2">
                    <div className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/85 px-3.5 py-2.5 text-xs">
                      <span className="font-semibold text-slate-600">Pronunciation (P) · Phát âm</span>
                      <span className="font-extrabold text-emerald-600 tabular-nums">
                        {activeScores.pr.toFixed(1)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/85 px-3.5 py-2.5 text-xs">
                      <span className="font-semibold text-slate-600">Fluency &amp; Coherence (FC)</span>
                      <span className="font-extrabold text-sky-600 tabular-nums">
                        {formatScoreValue(activeScores.fc)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/85 px-3.5 py-2.5 text-xs">
                      <span className="font-semibold text-slate-600">Lexical Resource (LR)</span>
                      <span className="font-extrabold text-amber-600 tabular-nums">
                        {formatScoreValue(activeScores.lr)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/85 px-3.5 py-2.5 text-xs">
                      <span className="font-semibold text-slate-600">Grammatical Range (GRA)</span>
                      <span className="font-extrabold text-indigo-600 tabular-nums">
                        {formatScoreValue(activeScores.gra)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Save controls */}
                <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/80 p-3.5">
                  <input
                    type="text"
                    value={customTitle}
                    onChange={(e) => setCustomTitle(e.target.value)}
                    placeholder="Tiêu đề lưu trữ..."
                    className="flex-1 min-w-[220px] rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    disabled={savingResult}
                    onClick={handleSaveAssessment}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-emerald-500 disabled:opacity-50"
                  >
                    {savingResult ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
                    Lưu vào Lịch sử
                  </button>
                  <button
                    type="button"
                    disabled={savingResult}
                    onClick={handleDiscardResult}
                    className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                  >
                    Hủy bản nháp
                  </button>
                </div>
              </div>

              {aiEval && (
                <div className="section-card">
                  <ComprehensiveAiFeedback
                    aiEval={aiEval}
                    otf={analysisResult.overall_transformer_feedback}
                    scores={{
                      total: activeScores.total,
                      accuracy: activeScores.pr,
                      context: activeScores.fc,
                      lexical: activeScores.lr,
                      grammar: activeScores.gra,
                    }}
                  />
                </div>
              )}

              <div className="section-card">
                <h4 className="mb-4 text-sm font-bold text-slate-900">
                  Chi tiết từng lượt hội thoại ({turns.length})
                </h4>
                <DialogueTimeline turns={turns} />
              </div>
            </div>
          )}
        </div>
      ) : (
        /* TAB 2: HISTORY */
        <div key="tab-history" className="space-y-4 animate-tab-in">
          <div className="section-card flex flex-wrap items-center justify-between gap-3">
            <div className="relative flex-1 min-w-[240px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={historySearch}
                onChange={(e) => setHistorySearch(e.target.value)}
                placeholder="Tìm theo tên học viên hoặc tiêu đề buổi chấm..."
                className="w-full rounded-xl border border-slate-200 bg-slate-50/80 py-2.5 pl-9 pr-3 text-sm text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none"
              />
            </div>
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              Tổng số: {historyData.total} bản ghi
            </span>
          </div>

          {loadingHistory && historyData.items.length === 0 ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-7 w-7 animate-spin text-indigo-600" />
            </div>
          ) : historyData.items.length === 0 ? (
            <div className="section-card py-12 text-center text-sm text-slate-500">
              Chưa có kết quả chấm hội thoại 1-1 nào được lưu.
            </div>
          ) : (
            <>
              <div className={`grid gap-3 lg:grid-cols-2 ${loadingHistory ? 'opacity-60' : ''}`}>
                {historyData.items.map((item) => (
                  <AssessmentCard
                    key={item.id}
                    assessment={item}
                    showDelete
                    onSelect={setDetailAssessment}
                    onDelete={setDeletingAssessment}
                  />
                ))}
              </div>
              <Pagination
                page={historyPage}
                pageSize={HISTORY_PAGE_SIZE}
                totalCount={historyData.total}
                onPageChange={setHistoryPage}
                disabled={loadingHistory}
                itemLabel="buổi chấm"
              />
            </>
          )}
        </div>
      )}

      {/* MODAL: Delete Saved Assessment Confirm */}
      <Modal
        open={Boolean(deletingAssessment)}
        onClose={() => setDeletingAssessment(null)}
        maxWidthClass="max-w-md"
        title="Xác nhận xóa đánh giá 1-1"
      >
        <div className="space-y-4 text-sm text-slate-600">
          <p>
            Bạn có chắc chắn muốn xóa bản ghi{' '}
            <strong className="text-slate-900">
              {deletingAssessment?.result_json?.title || 'Chấm hội thoại 1-1'}
            </strong>
            ? Hành động này không thể hoàn tác.
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setDeletingAssessment(null)}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700"
            >
              Hủy
            </button>
            <button
              type="button"
              disabled={deletingBusy}
              onClick={handleConfirmDeleteSaved}
              className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-500 disabled:opacity-50"
            >
              {deletingBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Xác nhận xóa
            </button>
          </div>
        </div>
      </Modal>

      <AssessmentDetailModal
        assessment={detailAssessment}
        onClose={() => setDetailAssessment(null)}
      />
    </div>
  );
}
