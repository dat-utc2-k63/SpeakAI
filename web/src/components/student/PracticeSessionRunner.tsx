'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Award,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Flag,
  Lightbulb,
  Loader2,
  Mic,
  Play,
  Save,
  SkipForward,
  Timer,
  Trash2,
  Volume2,
} from 'lucide-react';
import { evaluateAnswerWithGemini } from '@/lib/aiEval';
import {
  assessSingleAnswer,
  calculateBandScore,
  cancelSession,
  completeSession,
  detectVoiceActivity,
  playBeep,
  playEndTone,
  playStartTone,
  saveAnswer,
  startSession,
  uploadPracticeAudio,
} from '@/lib/practice';
import {
  getExamTypeName,
  scoreTextColorClass,
} from '@/lib/utils';
import { Modal } from '@/components/ui/Modal';
import {
  IeltsCriteriaList,
  LiveAudioVisualizer,
  PageHeader,
  ScoreRingGauge,
  SkillRadarChart,
  VoiceRecSphere,
} from '@/components/ui/AnalyticsCharts';
import { useToast } from '@/components/ToastProvider';
import { TaskQuestionCard, TaskTypeBadge } from '@/components/TaskQuestionCard';
import type {
  AssessmentResultJson,
  AssignmentRecord,
  PracticeSession,
  Profile,
  Question,
  QuestionSet,
  SessionMode,
} from '@/lib/types';

interface PracticeSessionRunnerProps {
  currentUser: Profile;
  questionSet: QuestionSet & { questions: Question[] };
  mode: SessionMode;
  assignment?: AssignmentRecord | null;
  initialSession: PracticeSession | null;
  gpuUrl: string;
  onSessionGuardChange: (active: boolean) => void;
  onFinished: () => void;
  onExit: () => void;
}

interface LocalAnswerEntry {
  question: Question;
  transcript: string;
  score_total: number;
  score_accuracy: number;
  score_fluency: number;
  score_prosodic: number;
  score_grammar: number | null;
  score_context: number | null;
  score_lexical: number | null;
  audio_url: string | null;
  result_json: AssessmentResultJson | null;
}

function formatTimerClock(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function PracticeSessionRunner({
  currentUser,
  questionSet,
  mode,
  assignment = null,
  initialSession,
  gpuUrl,
  onSessionGuardChange,
  onFinished,
  onExit,
}: PracticeSessionRunnerProps) {
  const { showToast } = useToast();
  const questions = useMemo(() => questionSet.questions || [], [questionSet.questions]);

  const [sessionId, setSessionId] = useState<string | null>(initialSession?.id || null);
  const [phase, setPhase] = useState<'active' | 'finalizing' | 'summary'>('active');
  const [currentIndex, setCurrentIndex] = useState(() => {
    if (mode === 'practice' && initialSession?.practice_answers?.length) {
      const answeredIds = new Set(initialSession.practice_answers.map((a) => a.question_id));
      const nextIdx = questions.findIndex((q) => !answeredIds.has(q.id));
      return nextIdx >= 0 ? nextIdx : 0;
    }
    return 0;
  });

  // Preload draft answers if resuming
  const [answersMap, setAnswersMap] = useState<Record<string, LocalAnswerEntry>>(() => {
    const initial: Record<string, LocalAnswerEntry> = {};
    for (const ans of initialSession?.practice_answers || []) {
      const q = questions.find((item) => item.id === ans.question_id);
      if (!q) continue;
      initial[ans.question_id] = {
        question: q,
        transcript: ans.transcript || '',
        score_total: Number(ans.score_total || 0),
        score_accuracy: Number(ans.score_accuracy || 0),
        score_fluency: Number(ans.score_fluency || 0),
        score_prosodic: Number(ans.score_prosodic || 0),
        score_grammar: ans.score_grammar ?? null,
        score_context: ans.score_context ?? null,
        score_lexical: ans.score_lexical ?? null,
        audio_url: ans.audio_url || null,
        result_json: ans.result_json || null,
      };
    }
    return initial;
  });

  // Practice-mode recording state
  const [recording, setRecording] = useState(false);
  const [recordingSec, setRecordingSec] = useState(0);
  const [liveStream, setLiveStream] = useState<MediaStream | null>(null);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  const [submittingAnswer, setSubmittingAnswer] = useState(false);
  const [finishingSession, setFinishingSession] = useState(false);
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);

  // Exam-mode timer & queue state
  const [examStep, setExamStep] = useState<'ready' | 'prep' | 'record'>('ready');
  const [timeLeft, setTimeLeft] = useState(0);
  const [examExitConfirmOpen, setExamExitConfirmOpen] = useState(false);
  const examTasksRef = useRef<Array<Promise<LocalAnswerEntry>>>([]);
  const examSubmittedIndicesRef = useRef<Set<number>>(new Set());

  // Summary state
  const [summaryTotals, setSummaryTotals] = useState<{
    score_total: number;
    score_accuracy: number;
    score_fluency: number;
    score_prosodic: number;
    score_grammar: number | null;
    score_context: number | null;
    score_lexical: number | null;
    exam_band?: string | null;
  } | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);

  const stopRecorderAndStream = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state === 'recording') {
      try {
        recorderRef.current.stop();
      } catch {
        // ignore
      }
    }
    recorderRef.current = null;
    if (streamRef.current) {
      try {
        streamRef.current.getTracks().forEach((t) => t.stop());
      } catch {
        // ignore
      }
    }
    streamRef.current = null;
    setLiveStream(null);
    setRecording(false);
  }, []);

  useEffect(() => {
    if (!recording) {
      setRecordingSec(0);
      return;
    }
    const timer = window.setInterval(() => {
      setRecordingSec((s) => s + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [recording]);

  useEffect(() => {
    const isActive = phase === 'active' || phase === 'finalizing';
    onSessionGuardChange(isActive);
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isActive) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      onSessionGuardChange(false);
    };
  }, [phase, onSessionGuardChange]);

  useEffect(() => {
    return () => {
      stopRecorderAndStream();
      if (recordedUrl) URL.revokeObjectURL(recordedUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currentQuestion = questions[currentIndex];
  const currentSavedAnswer = currentQuestion ? answersMap[currentQuestion.id] : undefined;

  const clearPendingAudio = useCallback(() => {
    if (recordedUrl) URL.revokeObjectURL(recordedUrl);
    setRecordedBlob(null);
    setRecordedUrl(null);
  }, [recordedUrl]);

  const handleSelectQuestionIndex = (idx: number) => {
    if (recording || submittingAnswer) return;
    clearPendingAudio();
    setCurrentIndex(idx);
  };

  // Helper to evaluate a recorded answer against GPU + Gemini
  const evaluateRecordedBlob = useCallback(
    async (q: Question, blob: Blob): Promise<LocalAnswerEntry> => {
      const vad = await detectVoiceActivity(blob);
      if (!vad.hasVoice) {
        return {
          question: q,
          transcript: '',
          score_total: 1.0,
          score_accuracy: 1.0,
          score_fluency: 1.0,
          score_prosodic: 1.0,
          score_grammar: q.task_type === 'read_aloud' ? null : 1.0,
          score_context: q.task_type === 'read_aloud' ? null : 1.0,
          score_lexical: q.task_type === 'read_aloud' ? null : 1.0,
          audio_url: null,
          result_json: {
            gemini_eval: {
              score_total: 1.0,
              grammar_errors: [],
              feedback_summary: vad.reason || 'Không phát hiện giọng nói hợp lệ trong bản thu.',
              better_expression: '',
            },
          },
        };
      }

      let audioUrl: string | null = null;
      try {
        audioUrl = await uploadPracticeAudio(
          currentUser.id,
          blob,
          `q_${q.order_num || 1}.webm`,
        );
      } catch {
        audioUrl = null;
      }

      const gpuRes = await assessSingleAnswer(gpuUrl, blob, {
        taskType: q.task_type,
        referenceText: q.reference_text || q.question_text || undefined,
      });

      const sData = gpuRes.student || {};
      const transcript = (sData.transcript || '').trim();
      const rawScores = sData.scores || { total: 0, accuracy: 0, fluency: 0, prosodic: 0 };

      const geminiEval = await evaluateAnswerWithGemini({
        questionText: q.question_text,
        partTitle: q.part_title || '',
        examType: questionSet.exam_type,
        taskType: q.task_type,
        referenceText: q.reference_text || '',
        imageUrl: q.image_url,
        transcript,
        pronunciationScores: rawScores,
        gpuUrlFallback: gpuUrl,
      });

      const mergedResultJson: AssessmentResultJson = {
        ...gpuRes,
        gemini_eval: geminiEval,
      };

      const pronScore = Number(
        rawScores.p ?? rawScores.score_pronunciation ?? rawScores.accuracy ?? rawScores.total ?? 0,
      );

      return {
        question: q,
        transcript,
        score_total: Number(geminiEval.score_total ?? rawScores.overall ?? rawScores.total ?? 0),
        score_accuracy: pronScore,
        score_fluency: Number(geminiEval.score_fluency_coherence ?? rawScores.fc ?? rawScores.fluency ?? 0),
        score_prosodic: Number(rawScores.prosodic ?? pronScore),
        score_grammar: geminiEval.score_grammar ?? rawScores.gra ?? rawScores.score_grammar ?? null,
        score_context: geminiEval.score_context ?? geminiEval.score_fluency_coherence ?? rawScores.fc ?? null,
        score_lexical: geminiEval.score_lexical ?? rawScores.lr ?? rawScores.score_lexical ?? null,
        audio_url: audioUrl,
        result_json: mergedResultJson,
      };
    },
    [currentUser.id, gpuUrl, questionSet.exam_type],
  );

  // PRACTICE MODE: Record toggle
  const handleTogglePracticeRecord = async () => {
    if (recording) {
      if (recorderRef.current && recorderRef.current.state === 'recording') {
        recorderRef.current.stop();
      }
      return;
    }

    clearPendingAudio();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          noiseSuppression: true,
          echoCancellation: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;
      setLiveStream(stream);
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        recorderRef.current = null;
        setLiveStream(null);
        setRecording(false);

        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        const vad = await detectVoiceActivity(blob);
        if (!vad.hasVoice) {
          showToast(`${vad.reason}. Vui lòng ghi âm lại rõ ràng hơn.`, 'danger');
          return;
        }
        const url = URL.createObjectURL(blob);
        setRecordedBlob(blob);
        setRecordedUrl(url);
      };

      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
    } catch (err) {
      showToast(
        err instanceof Error ? `Lỗi mở micro: ${err.message}` : 'Không thể truy cập micro.',
        'danger',
      );
    }
  };

  // PRACTICE MODE: Submit single answer
  const handleSubmitPracticeAnswer = async () => {
    if (!currentQuestion || !recordedBlob) return;
    if (!gpuUrl.trim()) {
      showToast('Hệ thống chấm điểm hiện chưa sẵn sàng. Vui lòng thử lại sau.', 'danger');
      return;
    }

    setSubmittingAnswer(true);
    try {
      let activeSid = sessionId;
      if (!activeSid) {
        const created = await startSession(currentUser.id, questionSet.id, 'practice', {
          assignmentId: assignment?.id || null,
          classId: assignment?.class_id || null,
        });
        activeSid = created.id;
        setSessionId(activeSid);
      }

      const entry = await evaluateRecordedBlob(currentQuestion, recordedBlob);

      await saveAnswer(activeSid, currentQuestion.id, {
        audio_url: entry.audio_url,
        transcript: entry.transcript,
        score_total: entry.score_total,
        score_accuracy: entry.score_accuracy,
        score_fluency: entry.score_fluency,
        score_prosodic: entry.score_prosodic,
        score_grammar: entry.score_grammar,
        score_context: entry.score_context,
        score_lexical: entry.score_lexical,
        result_json: entry.result_json,
      });

      setAnswersMap((prev) => ({ ...prev, [currentQuestion.id]: entry }));
      clearPendingAudio();
      showToast(`Đã chấm xong Câu ${currentQuestion.order_num || currentIndex + 1}!`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Lỗi chấm điểm câu trả lời', 'danger');
    } finally {
      setSubmittingAnswer(false);
    }
  };

  // PRACTICE MODE: Complete & View Summary
  const handleFinishPractice = async () => {
    const answeredCount = Object.keys(answersMap).length;
    if (answeredCount === 0) {
      showToast('Bạn cần chấm ít nhất 1 câu trả lời trước khi hoàn tất.', 'danger');
      return;
    }
    if (!sessionId) return;

    setFinishingSession(true);
    try {
      const entries = Object.values(answersMap);
      const rawAvg = entries.reduce((sum, e) => sum + e.score_total, 0) / entries.length;
      const bandInfo = calculateBandScore(rawAvg, questionSet.exam_type);
      const completed = await completeSession(sessionId, bandInfo.band);
      setSummaryTotals(completed);
      setPhase('summary');
      showToast('Đã hoàn thành bài Luyện tập!', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Lỗi hoàn tất phiên luyện tập', 'danger');
    } finally {
      setFinishingSession(false);
    }
  };

  const handleSaveDraftAndExit = () => {
    stopRecorderAndStream();
    clearPendingAudio();
    showToast('Đã lưu nháp tiến trình. Bạn có thể quay lại làm tiếp bất cứ lúc nào!', 'info');
    onExit();
  };

  const handleDiscardAndExit = async () => {
    stopRecorderAndStream();
    clearPendingAudio();
    if (sessionId) {
      await cancelSession(sessionId);
    }
    setDiscardConfirmOpen(false);
    showToast('Đã hủy bản nháp.', 'info');
    onExit();
  };

  // =========================================================================
  // EXAM MODE: Automated Prep -> Record -> Background Assess -> Summary
  // =========================================================================
  const finalizeExam = useCallback(async () => {
    setPhase('finalizing');
    stopRecorderAndStream();
    try {
      const settled = await Promise.all(examTasksRef.current);
      const examSession = await startSession(currentUser.id, questionSet.id, 'exam', {
        assignmentId: assignment?.id || null,
        classId: assignment?.class_id || null,
      });
      setSessionId(examSession.id);

      const newMap: Record<string, LocalAnswerEntry> = {};
      for (const entry of settled) {
        await saveAnswer(examSession.id, entry.question.id, {
          audio_url: entry.audio_url,
          transcript: entry.transcript,
          score_total: entry.score_total,
          score_accuracy: entry.score_accuracy,
          score_fluency: entry.score_fluency,
          score_prosodic: entry.score_prosodic,
          score_grammar: entry.score_grammar,
          score_context: entry.score_context,
          score_lexical: entry.score_lexical,
          result_json: entry.result_json,
        });
        newMap[entry.question.id] = entry;
      }

      const rawAvg = settled.length
        ? settled.reduce((s, e) => s + e.score_total, 0) / settled.length
        : 0;
      const bandInfo = calculateBandScore(rawAvg, questionSet.exam_type);
      const completed = await completeSession(examSession.id, bandInfo.band);
      setAnswersMap(newMap);
      setSummaryTotals(completed);
      setPhase('summary');
      showToast('Đã hoàn tất & chấm điểm toàn bộ bài thi thử!', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Lỗi tổng hợp bài thi', 'danger');
      onExit();
    }
  }, [
    assignment?.class_id,
    assignment?.id,
    currentUser.id,
    onExit,
    questionSet.exam_type,
    questionSet.id,
    showToast,
    stopRecorderAndStream,
  ]);

  const startExamQuestionRecording = useCallback(
    async (qIdx: number) => {
      const q = questions[qIdx];
      if (!q) return;

      playStartTone();
      setExamStep('record');
      setTimeLeft(Math.max(5, q.response_time || 45));

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            noiseSuppression: true,
            echoCancellation: true,
            autoGainControl: true,
          },
        });
        streamRef.current = stream;
        setLiveStream(stream);
        const recorder = new MediaRecorder(stream);
        chunksRef.current = [];
        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
        };
        recorder.onstop = () => {
          stream.getTracks().forEach((t) => t.stop());
          streamRef.current = null;
          recorderRef.current = null;
          setLiveStream(null);
          setRecording(false);

          const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
          const taskPromise = evaluateRecordedBlob(q, blob).catch(() => ({
            question: q,
            transcript: '',
            score_total: 1.0,
            score_accuracy: 1.0,
            score_fluency: 1.0,
            score_prosodic: 1.0,
            score_grammar: q.task_type === 'read_aloud' ? null : 1.0,
            score_context: q.task_type === 'read_aloud' ? null : 1.0,
            score_lexical: q.task_type === 'read_aloud' ? null : 1.0,
            audio_url: null,
            result_json: null,
          }));
          examTasksRef.current.push(taskPromise);

          if (qIdx + 1 < questions.length) {
            const nextQ = questions[qIdx + 1];
            setCurrentIndex(qIdx + 1);
            const nextPrep = nextQ.prep_time ?? 15;
            if (nextPrep > 0) {
              setExamStep('prep');
              setTimeLeft(nextPrep);
            } else {
              startExamQuestionRecording(qIdx + 1);
            }
          } else {
            finalizeExam();
          }
        };

        recorder.start();
        recorderRef.current = recorder;
        setRecording(true);
      } catch (err) {
        showToast(
          err instanceof Error ? `Không thể mở micro: ${err.message}` : 'Lỗi micro trong khi thi',
          'danger',
        );
        onExit();
      }
    },
    [evaluateRecordedBlob, finalizeExam, onExit, questions, showToast],
  );

  const handleStartExam = () => {
    if (!gpuUrl.trim()) {
      showToast('Hệ thống chấm điểm hiện chưa sẵn sàng. Vui lòng thử lại sau.', 'danger');
      return;
    }
    const firstQ = questions[0];
    if (!firstQ) return;
    examTasksRef.current = [];
    examSubmittedIndicesRef.current = new Set();
    setCurrentIndex(0);
    const prep = firstQ.prep_time ?? 15;
    if (prep > 0) {
      playBeep(660, 0.12);
      setExamStep('prep');
      setTimeLeft(prep);
    } else {
      startExamQuestionRecording(0);
    }
  };

  const handleAdvanceExamStep = useCallback(() => {
    if (examStep === 'prep') {
      startExamQuestionRecording(currentIndex);
    } else if (examStep === 'record') {
      if (examSubmittedIndicesRef.current.has(currentIndex)) return;
      examSubmittedIndicesRef.current.add(currentIndex);
      playEndTone();
      if (recorderRef.current && recorderRef.current.state === 'recording') {
        recorderRef.current.stop();
      }
    }
  }, [currentIndex, examStep, startExamQuestionRecording]);

  // Countdown tick for Exam Mode
  useEffect(() => {
    if (mode !== 'exam' || phase !== 'active' || examStep === 'ready') return;
    if (timeLeft <= 0) {
      handleAdvanceExamStep();
      return;
    }
    const id = window.setTimeout(() => {
      setTimeLeft((prev) => prev - 1);
    }, 1000);
    return () => window.clearTimeout(id);
  }, [mode, phase, examStep, timeLeft, handleAdvanceExamStep]);

  // =========================================================================
  // SUMMARY SCORECARD VIEW
  // =========================================================================
  if (phase === 'summary' && summaryTotals) {
    const entries = Object.values(answersMap);
    const bandInfo = calculateBandScore(summaryTotals.score_total, questionSet.exam_type);

    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow={mode === 'exam' ? 'KẾT QUẢ THI THỬ' : 'TỔNG KẾT LUYỆN TẬP'}
          title={questionSet.title}
          pill={
            <>
              <Award className="size-3.5 text-emerald-600" />
              <span>Hoàn thành {entries.length} câu</span>
            </>
          }
          action={
            <button
              type="button"
              onClick={onFinished}
              className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 transition-colors duration-150"
            >
              Về Kho Bộ Đề &amp; Lịch sử
            </button>
          }
        />

        <div className="section-card">
          <div className="grid items-center gap-6 lg:grid-cols-12">
            <div className="lg:col-span-3 flex flex-col items-center justify-center rounded-xl border border-slate-200 bg-slate-50 p-5 text-center">
              <ScoreRingGauge
                score={summaryTotals.score_total}
                max={9}
                size={168}
                strokeWidth={14}
                label="IELTS Band / 9.0"
              />
              <div className="mt-3 inline-flex flex-col items-center rounded-lg border border-blue-200 bg-blue-50 px-4 py-2">
                <span className="text-[10px] font-semibold uppercase text-blue-700">
                  {bandInfo.title}
                </span>
                <span className="text-lg font-bold text-slate-900 tabular-nums">{bandInfo.band}</span>
                <span className="text-[11px] text-slate-500">{bandInfo.description}</span>
              </div>
            </div>

            <div className="lg:col-span-5 flex items-center justify-center py-1">
              <SkillRadarChart
                size={260}
                skills={[
                  { label: 'Pronunciation (P)', value: summaryTotals.score_accuracy },
                  { label: 'Fluency (FC)', value: summaryTotals.score_context },
                  { label: 'Lexical (LR)', value: summaryTotals.score_lexical },
                  { label: 'Grammar (GRA)', value: summaryTotals.score_grammar },
                ]}
              />
            </div>

            <div className="lg:col-span-4">
              <IeltsCriteriaList
                pr={summaryTotals.score_accuracy}
                fc={summaryTotals.score_context}
                lr={summaryTotals.score_lexical}
                gra={summaryTotals.score_grammar}
              />
            </div>
          </div>
        </div>

        <div className="section-card space-y-4">
          <h3 className="text-base font-bold text-slate-900">
            Chi tiết từng câu ({entries.length})
          </h3>
          <div className="space-y-3">
            {entries.map((entry, i) => {
              const gem = entry.result_json?.gemini_eval;
              return (
                <div
                  key={entry.question.id}
                  className="rounded-2xl border border-slate-200 bg-slate-50/65 p-4 space-y-2.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-semibold text-slate-900">
                      <span className="text-blue-600">
                        Câu {entry.question.order_num || i + 1}:
                      </span>{' '}
                      {entry.question.question_text}
                    </div>
                    <span className={`text-lg font-extrabold tabular-nums ${scoreTextColorClass(entry.score_total)}`}>
                      {entry.score_total.toFixed(1)}
                    </span>
                  </div>
                  {entry.transcript && (
                    <p className="text-xs italic text-slate-600">
                      &ldquo;{entry.transcript}&rdquo;
                    </p>
                  )}
                  {gem?.feedback_summary && (
                    <div className="rounded-xl border border-amber-200 bg-amber-50/80 px-3 py-2 text-xs text-amber-900">
                      {gem.feedback_summary}
                    </div>
                  )}
                  {entry.audio_url && <audio controls src={entry.audio_url} className="h-9 w-full" />}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // FINALIZING SCREEN
  if (phase === 'finalizing') {
    return (
      <div className="section-card mx-auto mt-8 max-w-xl p-8 sm:p-10 text-center space-y-5">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-blue-50 text-blue-600">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
        <h3 className="text-lg font-bold text-slate-900">Đang tổng hợp &amp; chấm điểm bài thi...</h3>
        <LiveAudioVisualizer active={false} mode="processing" height={52} />
        <p className="text-sm text-slate-500">
          Hệ thống AI đang đánh giá phát âm, ngữ pháp và nội dung cho tất cả các câu trả lời của bạn.
        </p>
      </div>
    );
  }

  // =========================================================================
  // ACTIVE EXAM RUNNER
  // =========================================================================
  if (mode === 'exam') {
    if (examStep === 'ready') {
      return (
        <div className="section-card mx-auto max-w-2xl p-6 sm:p-10 text-center space-y-5">
          <div className="mx-auto flex size-14 items-center justify-center rounded-xl border border-amber-200 bg-amber-50 text-amber-700">
            <Timer className="size-7" />
          </div>
          <div>
            <span className="rounded-md border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">
              {getExamTypeName(questionSet.exam_type)} · Thi thử bấm giờ
            </span>
            <h2 className="mt-3 text-2xl font-bold text-slate-900 text-balance">{questionSet.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-600 text-pretty">
              Bài thi gồm <strong className="text-slate-900 tabular-nums">{questions.length}</strong> câu hỏi nối tiếp tự động
              (Chuẩn bị → Bíp thu âm → Nộp). Hãy kiểm tra micro trước khi bắt đầu.
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-3 pt-2">
            <button
              type="button"
              onClick={onExit}
              className="rounded-lg border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors duration-150"
            >
              Quay lại
            </button>
            <button
              type="button"
              onClick={handleStartExam}
              className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-6 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 transition-colors duration-150"
            >
              <Play className="size-4" />
              Bắt đầu Thi Ngay
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-5">
        <div className="section-card flex flex-wrap items-center justify-between gap-3">
          <div>
            <span className="text-xs font-semibold uppercase text-blue-600 tabular-nums">
              {questionSet.title} · Câu {currentIndex + 1}/{questions.length}
            </span>
            <h3 className="mt-0.5 text-lg font-bold text-slate-900 text-balance">
              {examStep === 'prep' ? 'Thời gian chuẩn bị ý tưởng' : 'Đang ghi âm câu trả lời'}
            </h3>
          </div>

          <div
            className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-xl font-bold font-mono tabular-nums ${
              examStep === 'record'
                ? 'border-rose-200 bg-rose-50 text-rose-600'
                : 'border-amber-200 bg-amber-50 text-amber-700'
            }`}
          >
            <Clock className="size-5" />
            <span>{timeLeft}s</span>
          </div>
        </div>

        <div className="section-card space-y-5">
          {currentQuestion && (
            <>
              <div className="flex items-center justify-between gap-2">
                <TaskTypeBadge taskType={currentQuestion.task_type} />
                {currentQuestion.part_title && (
                  <span className="text-xs font-medium text-slate-500">
                    {currentQuestion.part_title}
                  </span>
                )}
              </div>
              <TaskQuestionCard question={currentQuestion} />
            </>
          )}

          {/* Exam Studio Wavefront */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-5 flex flex-col items-center gap-3">
            <LiveAudioVisualizer
              stream={liveStream}
              active={examStep === 'record' && recording}
              mode={examStep === 'record' ? 'recording' : 'idle'}
              height={64}
            />
            <div className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700">
              {examStep === 'record' ? (
                <span className="inline-flex items-center gap-2 text-rose-600">
                  <span className="size-2 rounded-full bg-rose-600" />
                  Đang lắng nghe bài nói của bạn...
                </span>
              ) : (
                'Hãy đọc kỹ đề bài và phác thảo nhanh các ý chính'
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4">
            <button
              type="button"
              onClick={() => setExamExitConfirmOpen(true)}
              className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-100 transition-colors duration-150"
            >
              Thoát bài thi
            </button>

            <button
              type="button"
              onClick={handleAdvanceExamStep}
              className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 transition-colors duration-150"
            >
              {examStep === 'prep' ? (
                <>
                  <Mic className="h-4 w-4" />
                  Bỏ qua chuẩn bị &amp; Ghi âm ngay
                </>
              ) : currentIndex + 1 < questions.length ? (
                <>
                  <SkipForward className="h-4 w-4" />
                  Nộp câu này sớm → Câu tiếp theo
                </>
              ) : (
                <>
                  <Flag className="h-4 w-4" />
                  Hoàn thành &amp; Nộp bài thi
                </>
              )}
            </button>
          </div>
        </div>

        <Modal
          open={examExitConfirmOpen}
          onClose={() => setExamExitConfirmOpen(false)}
          maxWidthClass="max-w-md"
          title="Thoát bài thi thử?"
        >
          <div className="space-y-4 text-sm text-slate-600">
            <p>
              Thoát giữa giờ sẽ hủy bài thi thử hiện tại và các câu chưa tổng hợp sẽ không được lưu. Bạn vẫn muốn thoát?
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setExamExitConfirmOpen(false)}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Tiếp tục thi
              </button>
              <button
                type="button"
                onClick={() => {
                  setExamExitConfirmOpen(false);
                  stopRecorderAndStream();
                  onExit();
                }}
                className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-500"
              >
                Xác nhận thoát
              </button>
            </div>
          </div>
        </Modal>
      </div>
    );
  }

  // =========================================================================
  // ACTIVE PRACTICE RUNNER (HABLAYA VOICE STUDIO LAYOUT)
  // =========================================================================
  const answeredCount = Object.keys(answersMap).length;
  const geminiFeedback = currentSavedAnswer?.result_json?.gemini_eval;
  const otfTips = currentSavedAnswer?.result_json?.overall_transformer_feedback?.tips || [];
  const grammarErrors = geminiFeedback?.grammar_errors || [];

  const studioStatusText = submittingAnswer
    ? 'AI đang phân tích phát âm và ngữ pháp...'
    : recording
      ? `Đang lắng nghe · ${formatTimerClock(recordingSec)}`
      : recordedBlob
        ? 'Đã ghi âm xong — Nghe lại hoặc nhấn Chấm câu trả lời này'
        : currentSavedAnswer
          ? 'Câu này đã chấm · Nhấn Ghi âm nếu bạn muốn luyện lại'
          : 'Nhấn Ghi âm để bắt đầu nói câu trả lời';

  return (
    <div className="space-y-5">
      {/* Studio Top Bar */}
      <PageHeader
        eyebrow={`LUYỆN SPEAKING · ${getExamTypeName(questionSet.exam_type).toUpperCase()}`}
        title={questionSet.title}
        pill={
          <>
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
            <span>
              Đã chấm {answeredCount}/{questions.length} câu
            </span>
          </>
        }
        action={
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleSaveDraftAndExit}
              disabled={recording || submittingAnswer}
              className="inline-flex items-center gap-1.5 rounded-2xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50 transition"
            >
              <Save className="h-3.5 w-3.5" />
              Lưu nháp
            </button>
            <button
              type="button"
              onClick={() => setDiscardConfirmOpen(true)}
              disabled={recording || submittingAnswer}
              className="inline-flex items-center gap-1.5 rounded-2xl border border-rose-200 bg-rose-50 px-3.5 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50 transition"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Hủy
            </button>
            <button
              type="button"
              disabled={answeredCount === 0 || finishingSession || submittingAnswer || recording}
              onClick={handleFinishPractice}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-45 transition-colors duration-150"
            >
              {finishingSession ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Flag className="size-3.5" />
              )}
              Hoàn tất bài
            </button>
          </div>
        }
      />

      {/* Question Pill Strip + Progress Bar */}
      <div className="space-y-2.5">
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {questions.map((q, idx) => {
            const isDone = Boolean(answersMap[q.id]);
            const isCurrent = idx === currentIndex;
            return (
              <button
                key={q.id}
                type="button"
                onClick={() => handleSelectQuestionIndex(idx)}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors duration-150 ${
                  isCurrent
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : isDone
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                {isDone && <CheckCircle2 className="size-3.5" />}
                Câu {q.order_num || idx + 1}
              </button>
            );
          })}
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
          <div
            className="h-full rounded-full bg-blue-600"
            style={{
              width: `${questions.length > 0 ? Math.round((answeredCount / questions.length) * 100) : 0}%`,
            }}
          />
        </div>
      </div>

      {/* Main 2-Column Practice Studio */}
      {currentQuestion && (
        <div className="grid gap-6 lg:grid-cols-12">
          {/* Left Studio Card: Question Prompt + REC + Live Equalizer */}
          <div className="section-card lg:col-span-7 flex flex-col justify-between space-y-5">
            <div key={currentQuestion.id} className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-md bg-blue-50 border border-blue-200 px-2.5 py-1 text-xs font-semibold text-blue-700 tabular-nums">
                    Câu {currentQuestion.order_num || currentIndex + 1}/{questions.length}
                  </span>
                  {currentQuestion.part_title && (
                    <span className="text-xs font-medium text-slate-500">
                      {currentQuestion.part_title}
                    </span>
                  )}
                  <TaskTypeBadge taskType={currentQuestion.task_type} />
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={currentIndex === 0 || recording || submittingAnswer}
                    onClick={() => handleSelectQuestionIndex(currentIndex - 1)}
                    className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50 disabled:opacity-40 transition-colors duration-150"
                    aria-label="Câu trước"
                  >
                    <ChevronLeft className="size-4" />
                  </button>
                  <button
                    type="button"
                    disabled={currentIndex === questions.length - 1 || recording || submittingAnswer}
                    onClick={() => handleSelectQuestionIndex(currentIndex + 1)}
                    className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50 disabled:opacity-40 transition-colors duration-150"
                    aria-label="Câu sau"
                  >
                    <ChevronRight className="size-4" />
                  </button>
                </div>
              </div>

              <TaskQuestionCard question={currentQuestion} />
            </div>

            {/* Voice Studio Centerpiece */}
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-5 sm:p-6 flex flex-col items-center gap-4">
              <VoiceRecSphere
                recording={recording}
                processing={submittingAnswer}
                hasRecorded={Boolean(recordedBlob)}
                size="lg"
                onClick={handleTogglePracticeRecord}
              />

              <LiveAudioVisualizer
                stream={liveStream}
                active={recording}
                mode={
                  submittingAnswer
                    ? 'processing'
                    : recording
                      ? 'recording'
                      : recordedBlob
                        ? 'ready'
                        : 'idle'
                }
                barCount={13}
                height={64}
              />

              <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white px-4 py-2 text-center text-xs font-medium text-slate-700">
                {recording ? (
                  <span className="inline-flex items-center justify-center gap-2 font-semibold text-rose-600 tabular-nums">
                    <span className="size-2 rounded-full bg-rose-600" />
                    {studioStatusText}
                  </span>
                ) : (
                  <span>{studioStatusText}</span>
                )}
              </div>

              {recordedUrl && (
                <div className="w-full max-w-md space-y-3 pt-1">
                  <audio controls src={recordedUrl} className="h-9 w-full" />
                  {!recording && (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={submittingAnswer}
                        onClick={handleSubmitPracticeAnswer}
                        className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50 transition-colors duration-150"
                      >
                        {submittingAnswer ? (
                          <>
                            <Loader2 className="size-4 animate-spin" />
                            Đang chấm điểm...
                          </>
                        ) : (
                          <>
                            <CheckCircle2 className="size-4" />
                            Chấm câu trả lời này
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        disabled={submittingAnswer}
                        onClick={clearPendingAudio}
                        title="Xóa bản thu âm này"
                        aria-label="Xóa bản thu âm này"
                        className="shrink-0 rounded-lg border border-slate-200 bg-white p-2.5 text-slate-500 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-45 transition-colors duration-150"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Right Studio Card: Live Pronunciation & 4 Skill Rows */}
          <div className="section-card lg:col-span-5 flex flex-col justify-between space-y-5">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-base font-bold text-slate-900">Đánh giá Phát âm</h3>
              <span
                className={`rounded-md border px-2.5 py-0.5 text-xs font-semibold ${
                  submittingAnswer
                    ? 'border-blue-200 bg-blue-50 text-blue-700'
                    : currentSavedAnswer
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      : 'border-slate-200 bg-slate-50 text-slate-500'
                }`}
              >
                {submittingAnswer
                  ? 'Đang chấm...'
                  : currentSavedAnswer
                    ? 'Đã chấm xong'
                    : 'Chờ câu trả lời'}
              </span>
            </div>

            <div className="flex flex-col items-center justify-center py-2">
              <ScoreRingGauge
                score={submittingAnswer ? null : currentSavedAnswer ? currentSavedAnswer.score_total : null}
                max={9}
                size={168}
                strokeWidth={14}
                label="IELTS Band / 9.0"
                sublabel={
                  submittingAnswer
                    ? 'Đang phân tích phát âm, ngữ điệu và ngữ pháp...'
                    : currentSavedAnswer
                      ? 'Kết quả phân tích chi tiết của câu hiện tại'
                      : 'Ghi âm và gửi để xem điểm trực tiếp'
                }
              />
            </div>

            <IeltsCriteriaList
              compact
              pr={submittingAnswer ? null : currentSavedAnswer ? currentSavedAnswer.score_accuracy : null}
              fc={submittingAnswer ? null : currentSavedAnswer ? currentSavedAnswer.score_context : null}
              lr={submittingAnswer ? null : currentSavedAnswer ? currentSavedAnswer.score_lexical : null}
              gra={submittingAnswer ? null : currentSavedAnswer ? currentSavedAnswer.score_grammar : null}
            />
          </div>
        </div>
      )}

      {/* Detailed Immediate Feedback Below Studio */}
      {currentSavedAnswer && (
        <div className="section-card space-y-4 border-emerald-200">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
            <h3 className="flex items-center gap-2 text-base font-bold text-slate-900">
              <CheckCircle2 className="size-5 text-emerald-600" />
              Nhận xét chi tiết Câu {currentQuestion?.order_num || currentIndex + 1}
            </h3>
            {currentIndex < questions.length - 1 && (
              <button
                type="button"
                onClick={() => handleSelectQuestionIndex(currentIndex + 1)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 transition-colors duration-150"
              >
                Câu tiếp theo
                <ArrowRight className="size-3.5" />
              </button>
            )}
          </div>

          {currentSavedAnswer.transcript && (
            <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3.5 text-sm italic text-slate-800">
              &ldquo;{currentSavedAnswer.transcript}&rdquo;
            </div>
          )}

          {geminiFeedback?.feedback_summary && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50/80 p-3.5 text-xs leading-relaxed text-amber-900">
              <strong>Nhận xét AI:</strong> {geminiFeedback.feedback_summary}
            </div>
          )}

          {grammarErrors.length > 0 && (
            <div className="rounded-2xl border border-rose-200 bg-rose-50/75 p-3.5 space-y-2 text-xs">
              <div className="flex items-center gap-1.5 font-bold text-rose-700">
                <AlertCircle className="h-3.5 w-3.5" />
                Lỗi ngữ pháp cần sửa ({grammarErrors.length}):
              </div>
              {grammarErrors.map((err, idx) => (
                <div key={idx} className="pl-2.5 border-l-2 border-rose-400 space-y-0.5">
                  <div>
                    <span className="text-rose-600 line-through">{err.error_text}</span>{' '}
                    <span className="text-slate-400">→</span>{' '}
                    <span className="font-bold text-emerald-700">{err.fix}</span>
                  </div>
                  {err.explanation && <div className="text-slate-600">{err.explanation}</div>}
                </div>
              ))}
            </div>
          )}

          {geminiFeedback?.better_expression && (
            <div className="rounded-2xl border border-sky-200 bg-sky-50/75 p-3.5 text-xs text-slate-700">
              <div className="mb-1 flex items-center gap-1.5 font-bold text-sky-800">
                <Lightbulb className="h-3.5 w-3.5" />
                Câu mẫu gợi ý:
              </div>
              <span className="italic">&ldquo;{geminiFeedback.better_expression}&rdquo;</span>
            </div>
          )}

          {otfTips.length > 0 && (
            <div className="clean-feedback-box text-xs text-slate-700 space-y-1">
              <div className="font-bold text-amber-800">Gợi ý cải thiện phát âm:</div>
              {otfTips.map((tip, idx) => (
                <div key={idx}>• {tip}</div>
              ))}
            </div>
          )}

          {currentSavedAnswer.audio_url && (
            <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3.5 py-2">
              <Volume2 className="h-4 w-4 text-sky-600 shrink-0" />
              <audio controls src={currentSavedAnswer.audio_url} className="h-8 w-full" />
            </div>
          )}
        </div>
      )}

      {/* Discard Confirm Modal */}
      <Modal
        open={discardConfirmOpen}
        onClose={() => setDiscardConfirmOpen(false)}
        maxWidthClass="max-w-md"
        title="Hủy bản nháp luyện tập?"
      >
        <div className="space-y-4 text-sm text-slate-600">
          <p>
            Nếu hủy bản nháp, toàn bộ câu đã trả lời trong phiên luyện tập chưa hoàn tất này sẽ bị xóa. Bạn có thể chọn{' '}
            <strong className="text-slate-900">Lưu nháp</strong> để giữ lại tiến trình.
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setDiscardConfirmOpen(false)}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Ở lại làm tiếp
            </button>
            <button
              type="button"
              onClick={handleDiscardAndExit}
              className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-500"
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              Xác nhận hủy nháp
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
