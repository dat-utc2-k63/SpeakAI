import { getAuthHeaders } from './auth';
import {
  extractRelatedCount,
  getRangeForPage,
  sanitizePostgrestFilterTerm,
  type PaginatedResult,
} from './pagination';
import { getSupabaseClient } from './supabase';
import type {
  AssessmentResultJson,
  PracticeAnswerRecord,
  PracticeSession,
  Question,
  QuestionSet,
  SessionMode,
  SignupTeacher,
  TaskType,
} from './types';

export async function fetchPublishedSetsPage({
  page = 1,
  pageSize = 9,
  search = '',
  examType = '',
  level = '',
}: {
  page?: number;
  pageSize?: number;
  search?: string;
  examType?: string;
  level?: string;
} = {}): Promise<PaginatedResult<QuestionSet>> {
  const client = getSupabaseClient();
  const { from, to, safePage, safeSize } = getRangeForPage(page, pageSize);
  const term = sanitizePostgrestFilterTerm(search);

  let matchingTeacherIds: string[] = [];
  if (term) {
    try {
      const { data: teachersData } = await client.rpc('get_signup_teachers');
      const lowered = term.toLowerCase();
      matchingTeacherIds = ((teachersData as SignupTeacher[]) || [])
        .filter((t) => (t.full_name || '').toLowerCase().includes(lowered))
        .map((t) => t.id)
        .slice(0, 50);
    } catch {
      matchingTeacherIds = [];
    }
  }

  const buildQuery = (countRelation: 'questions(count)' | 'questions(id)') => {
    let query = client
      .from('question_sets')
      .select(
        `
        id, teacher_id, title, description, level, exam_type, time_limit, created_at,
        teacher:profiles!teacher_id(full_name),
        ${countRelation}
      `,
        { count: 'exact' },
      )
      .eq('is_published', true)
      .order('created_at', { ascending: false });

    if (examType) query = query.eq('exam_type', examType);
    if (level) query = query.eq('level', level);

    if (term) {
      const clauses = [`title.ilike.%${term}%`, `description.ilike.%${term}%`];
      if (matchingTeacherIds.length > 0) {
        clauses.push(`teacher_id.in.(${matchingTeacherIds.join(',')})`);
      }
      query = query.or(clauses.join(','));
    }

    return query.range(from, to);
  };

  let res = await buildQuery('questions(count)');
  if (res.error) {
    res = await buildQuery('questions(id)');
  }
  if (res.error) throw res.error;

  const items = ((res.data as unknown as QuestionSet[]) || []).map((qs) => ({
    ...qs,
    exam_type: (qs.exam_type || 'general') as QuestionSet['exam_type'],
    time_limit: qs.time_limit || 0,
    teacher_name: qs.teacher?.full_name || 'Giáo viên',
    question_count: extractRelatedCount(qs.questions),
  }));

  return {
    items,
    total: res.count || 0,
    page: safePage,
    pageSize: safeSize,
  };
}

export async function fetchSetWithQuestions(setId: string): Promise<QuestionSet & { questions: Question[] }> {
  const client = getSupabaseClient();
  const { data: setData, error: setError } = await client
    .from('question_sets')
    .select('id, teacher_id, title, description, level, exam_type, time_limit, is_published, created_at')
    .eq('id', setId)
    .single();
  if (setError) throw setError;

  const { data: questions, error: qError } = await client
    .from('questions')
    .select('*')
    .eq('set_id', setId)
    .order('order_num', { ascending: true });
  if (qError) throw qError;

  return {
    ...(setData as QuestionSet),
    exam_type: (setData as QuestionSet).exam_type || 'general',
    time_limit: (setData as QuestionSet).time_limit || 0,
    questions: ((questions as Question[]) || []).map((q) => {
      let tType = q.task_type;
      if (!tType && q.hint && typeof q.hint === 'string' && q.hint.startsWith('__META__:')) {
        try {
          const meta = JSON.parse(q.hint.slice(9)) as { task_type?: TaskType };
          if (meta.task_type) tType = meta.task_type;
        } catch {
          // ignore
        }
      }
      return {
        ...q,
        task_type: (tType || 'short_qa') as TaskType,
        prep_time: q.prep_time ?? 15,
        response_time: q.response_time ?? 45,
      };
    }),
  };
}

export async function startSession(
  studentId: string,
  setId: string,
  mode: SessionMode = 'practice',
  options?: { assignmentId?: string | null; classId?: string | null },
): Promise<PracticeSession> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('practice_sessions')
    .insert({
      student_id: studentId,
      set_id: setId,
      mode: mode || 'practice',
      status: 'in_progress',
      ...(options?.assignmentId ? { assignment_id: options.assignmentId } : {}),
      ...(options?.classId ? { class_id: options.classId } : {}),
    })
    .select()
    .single();
  if (error) throw error;
  return data as PracticeSession;
}

export async function fetchActiveSession(
  studentId: string,
  setId: string,
  mode: SessionMode = 'practice',
  assignmentId?: string | null,
): Promise<PracticeSession | null> {
  try {
    const client = getSupabaseClient();
    let query = client
      .from('practice_sessions')
      .select(
        `
        id, mode, status, started_at, assignment_id, class_id, is_late,
        practice_answers (
          id, question_id, audio_url, transcript, score_total, score_accuracy, score_fluency, score_prosodic, score_grammar, score_context, score_lexical, result_json, created_at
        )
      `,
      )
      .eq('student_id', studentId)
      .eq('set_id', setId)
      .eq('mode', mode)
      .eq('status', 'in_progress')
      .order('started_at', { ascending: false })
      .limit(1);

    if (assignmentId) {
      query = query.eq('assignment_id', assignmentId);
    } else {
      query = query.is('assignment_id', null);
    }

    const { data, error } = await query.maybeSingle();
    if (error) return null;
    return (data as PracticeSession) || null;
  } catch {
    return null;
  }
}

export async function cancelSession(sessionId?: string | null): Promise<void> {
  if (!sessionId) return;
  try {
    const client = getSupabaseClient();
    await client.from('practice_sessions').delete().eq('id', sessionId);
  } catch (e) {
    console.warn('Lỗi cancelSession:', e);
  }
}

export async function saveAnswer(
  sessionId: string,
  questionId: string,
  payloadInput: {
    audio_url: string | null;
    transcript: string;
    score_total: number;
    score_accuracy: number;
    score_fluency: number;
    score_prosodic: number;
    score_grammar: number | null;
    score_context: number | null;
    score_lexical: number | null;
    result_json: AssessmentResultJson | null;
  },
): Promise<PracticeAnswerRecord> {
  const client = getSupabaseClient();
  const { data: existing } = await client
    .from('practice_answers')
    .select('id')
    .eq('session_id', sessionId)
    .eq('question_id', questionId)
    .maybeSingle();

  const payload = {
    audio_url: payloadInput.audio_url,
    transcript: payloadInput.transcript,
    score_total: payloadInput.score_total,
    score_accuracy: payloadInput.score_accuracy,
    score_fluency: payloadInput.score_fluency,
    score_prosodic: payloadInput.score_prosodic,
    score_grammar: payloadInput.score_grammar ?? null,
    score_context: payloadInput.score_context ?? null,
    score_lexical: payloadInput.score_lexical ?? null,
    result_json: payloadInput.result_json,
  };

  if (existing?.id) {
    const { data, error } = await client
      .from('practice_answers')
      .update({
        ...payload,
        created_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
      .select()
      .single();
    if (error) throw error;
    return data as PracticeAnswerRecord;
  }

  const { data, error } = await client
    .from('practice_answers')
    .insert({
      session_id: sessionId,
      question_id: questionId,
      ...payload,
    })
    .select()
    .single();
  if (error) throw error;
  return data as PracticeAnswerRecord;
}

export function calculateBandScore(score10: number, examType = 'general') {
  const s = Math.max(0, Math.min(10, score10 || 0));

  if (examType === 'ielts') {
    let band = 4.0;
    if (s >= 9.2) band = 9.0;
    else if (s >= 8.5) band = 8.5;
    else if (s >= 7.8) band = 8.0;
    else if (s >= 7.2) band = 7.5;
    else if (s >= 6.5) band = 7.0;
    else if (s >= 5.8) band = 6.5;
    else if (s >= 5.0) band = 6.0;
    else if (s >= 4.2) band = 5.5;
    else if (s >= 3.5) band = 5.0;
    else if (s >= 2.8) band = 4.5;

    let desc = 'Cần cải thiện';
    if (band >= 8.0) desc = 'Rất tốt / Thành thạo';
    else if (band >= 7.0) desc = 'Tốt';
    else if (band >= 6.0) desc = 'Khá';
    else if (band >= 5.0) desc = 'Trung bình';

    return {
      band: `Band ${band.toFixed(1)}`,
      badgeClass: band >= 7.0 ? 'badge-ielts-high' : band >= 6.0 ? 'badge-ielts-mid' : 'badge-ielts-low',
      title: 'IELTS Speaking',
      description: desc,
      rawBand: band,
    };
  }

  if (examType === 'vstep') {
    let level = 'A2';
    let desc = 'Sơ cấp (Chưa đạt B1)';
    let badgeClass = 'badge-vstep-a2';

    if (s >= 8.5) {
      level = 'Bậc 5 / C1';
      desc = 'Cao cấp (C1 - Thành thạo)';
      badgeClass = 'badge-vstep-c1';
    } else if (s >= 6.5) {
      level = 'Bậc 4 / B2';
      desc = 'Trung cấp cao (B2 - Đạt chuẩn)';
      badgeClass = 'badge-vstep-b2';
    } else if (s >= 4.0) {
      level = 'Bậc 3 / B1';
      desc = 'Trung cấp (B1 - Đạt chuẩn)';
      badgeClass = 'badge-vstep-b1';
    }

    return {
      band: `VSTEP ${level}`,
      badgeClass,
      title: 'VSTEP Speaking (B1-B2-C1)',
      description: desc,
      rawBand: level,
    };
  }

  if (examType === 'toeic') {
    let toeicScore = Math.round((s / 9) * 200);
    toeicScore = Math.min(200, Math.round(toeicScore / 10) * 10);
    let level = 3;
    let desc = 'Level 1-3 (0-70) - Cần cải thiện';

    if (toeicScore >= 190) {
      level = 8;
      desc = 'Level 8 (190-200) - Xuất sắc';
    } else if (toeicScore >= 160) {
      level = 7;
      desc = 'Level 7 (160-180) - Tốt';
    } else if (toeicScore >= 130) {
      level = 6;
      desc = 'Level 6 (130-150) - Khá';
    } else if (toeicScore >= 110) {
      level = 5;
      desc = 'Level 5 (110-120) - Trung bình';
    } else if (toeicScore >= 80) {
      level = 4;
      desc = 'Level 4 (80-100) - Cơ bản';
    }

    return {
      band: `${toeicScore}/200 (Level ${level})`,
      badgeClass: level >= 7 ? 'badge-toeic-high' : level >= 5 ? 'badge-toeic-mid' : 'badge-toeic-low',
      title: 'TOEIC Speaking',
      description: desc,
      rawBand: toeicScore,
    };
  }

  let rank = 'Sơ cấp (Cần rèn luyện)';
  if (s >= 8.5) rank = 'Xuất sắc';
  else if (s >= 7.0) rank = 'Tốt';
  else if (s >= 5.0) rank = 'Khá';

  return {
    band: `Band ${s.toFixed(1)} / 9.0`,
    badgeClass: s >= 7.0 ? 'badge-general-high' : s >= 5.0 ? 'badge-general-mid' : 'badge-general-low',
    title: 'IELTS Speaking Band',
    description: rank,
    rawBand: s,
  };
}

export async function completeSession(sessionId: string, examBand: string | null = null) {
  const client = getSupabaseClient();
  const { data: answers, error: aErr } = await client
    .from('practice_answers')
    .select(
      'score_total, score_accuracy, score_fluency, score_prosodic, score_grammar, score_context, score_lexical',
    )
    .eq('session_id', sessionId);
  if (aErr) throw aErr;

  const list = (answers as PracticeAnswerRecord[]) || [];
  const valid = list.filter((a) => a.score_total != null);
  const count = valid.length;

  let avgTotal = 0;
  let avgAcc = 0;
  let avgFlu = 0;
  let avgPro = 0;
  let avgGrammar = 0;
  let avgContext = 0;
  let avgLexical = 0;
  let countGrammar = 0;
  let countContext = 0;
  let countLexical = 0;

  if (count > 0) {
    for (const a of list) {
      avgTotal += a.score_total || 0;
      avgAcc += a.score_accuracy || 0;
      avgFlu += a.score_fluency || 0;
      avgPro += a.score_prosodic || 0;
      if (a.score_grammar != null) {
        avgGrammar += a.score_grammar;
        countGrammar++;
      }
      if (a.score_context != null) {
        avgContext += a.score_context;
        countContext++;
      }
      if (a.score_lexical != null) {
        avgLexical += a.score_lexical;
        countLexical++;
      }
    }
    avgTotal /= count;
    avgAcc /= count;
    avgFlu /= count;
    avgPro /= count;
    avgGrammar = countGrammar > 0 ? avgGrammar / countGrammar : 0;
    avgContext = countContext > 0 ? avgContext / countContext : 0;
    avgLexical = countLexical > 0 ? avgLexical / countLexical : 0;
  }

  const updates: Record<string, unknown> = {
    status: 'completed',
    score_total: avgTotal,
    score_accuracy: avgAcc,
    score_fluency: avgFlu,
    score_prosodic: avgPro,
    score_grammar: avgGrammar > 0 ? avgGrammar : null,
    score_context: avgContext > 0 ? avgContext : null,
    score_lexical: avgLexical > 0 ? avgLexical : null,
    completed_at: new Date().toISOString(),
  };

  if (examBand) updates.exam_band = examBand;

  const { error } = await client.from('practice_sessions').update(updates).eq('id', sessionId);
  if (error) throw error;

  return {
    score_total: avgTotal,
    score_accuracy: avgAcc,
    score_fluency: avgFlu,
    score_prosodic: avgPro,
    score_grammar: avgGrammar > 0 ? avgGrammar : null,
    score_context: avgContext > 0 ? avgContext : null,
    score_lexical: avgLexical > 0 ? avgLexical : null,
    exam_band: examBand,
  };
}

export async function fetchSessionHistoryPage(
  studentId: string,
  {
    page = 1,
    pageSize = 8,
    search = '',
    mode = 'all',
  }: {
    page?: number;
    pageSize?: number;
    search?: string;
    mode?: 'all' | SessionMode;
  } = {},
): Promise<PaginatedResult<PracticeSession>> {
  const client = getSupabaseClient();
  const { from, to, safePage, safeSize } = getRangeForPage(page, pageSize);
  const term = sanitizePostgrestFilterTerm(search);

  let matchingSetIds: string[] = [];
  if (term) {
    const { data: setsData } = await client
      .from('question_sets')
      .select('id')
      .ilike('title', `%${term}%`)
      .limit(50);
    matchingSetIds = ((setsData as Array<{ id: string }>) || []).map((qs) => qs.id);
    if (matchingSetIds.length === 0) {
      return { items: [], total: 0, page: safePage, pageSize: safeSize };
    }
  }

  let query = client
    .from('practice_sessions')
    .select(
      `
      id, mode, status, assignment_id, class_id, is_late,
      score_total, score_accuracy, score_fluency, score_prosodic, score_grammar, score_context, score_lexical, exam_band,
      teacher_comment, reviewed_by, reviewed_at,
      started_at, completed_at,
      question_set:question_sets(id, title, level, exam_type)
    `,
      { count: 'exact' },
    )
    .eq('student_id', studentId)
    .in('status', ['completed', 'reviewed'])
    .order('completed_at', { ascending: false, nullsFirst: false });

  if (mode !== 'all') query = query.eq('mode', mode);
  if (term && matchingSetIds.length > 0) {
    query = query.in('set_id', matchingSetIds);
  }

  const { data, count, error } = await query.range(from, to);
  if (error) throw error;

  return {
    items: (data as PracticeSession[]) || [],
    total: count || 0,
    page: safePage,
    pageSize: safeSize,
  };
}

export async function fetchSessionDetail(sessionId: string): Promise<PracticeSession> {
  const client = getSupabaseClient();
  const { data: session, error: sErr } = await client
    .from('practice_sessions')
    .select(
      `
      id, mode, status, assignment_id, class_id, is_late,
      score_total, score_accuracy, score_fluency, score_prosodic, score_grammar, score_context, score_lexical, exam_band,
      teacher_comment, reviewed_by, reviewed_at,
      started_at, completed_at,
      question_set:question_sets(id, title, level, exam_type, description)
    `,
    )
    .eq('id', sessionId)
    .single();
  if (sErr) throw sErr;

  const { data: answers, error: aErr } = await client
    .from('practice_answers')
    .select(
      `
      id, question_id, audio_url, transcript, score_total, score_accuracy, score_fluency, score_prosodic, score_grammar, score_context, score_lexical, result_json, created_at,
      question:questions(id, order_num, part_title, question_text, prep_time, response_time)
    `,
    )
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true });
  if (aErr) throw aErr;

  return {
    ...(session as PracticeSession),
    answers: (answers as PracticeAnswerRecord[]) || [],
  };
}

export async function uploadPracticeAudio(
  studentId: string,
  audioBlob: Blob,
  filename: string,
): Promise<string> {
  const client = getSupabaseClient();
  const path = `practice/${studentId}/${Date.now()}_${filename}`;
  const { error } = await client.storage
    .from('speakai-audio')
    .upload(path, audioBlob, { upsert: false, contentType: audioBlob.type || 'audio/webm' });
  if (error) throw error;
  const { data: urlData } = client.storage.from('speakai-audio').getPublicUrl(path);
  return urlData.publicUrl;
}

export async function detectVoiceActivity(
  audioBlob: Blob,
  options: {
    minSpeechDuration?: number;
    speechRmsThreshold?: number;
    minPeakAmp?: number;
  } = {},
) {
  const minSpeechDuration = options.minSpeechDuration ?? 0.35;
  const speechRmsThreshold = options.speechRmsThreshold ?? 0.012;
  const minPeakAmp = options.minPeakAmp ?? 0.025;

  if (!audioBlob || audioBlob.size === 0) {
    return {
      hasVoice: false,
      speechDurationSec: 0,
      totalDurationSec: 0,
      maxRms: 0,
      avgRms: 0,
      peakAmp: 0,
      reason: 'File ghi âm rỗng',
    };
  }

  const AudioContextClass =
    typeof window !== 'undefined'
      ? window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      : undefined;

  if (!AudioContextClass) {
    return {
      hasVoice: true,
      speechDurationSec: 1.0,
      totalDurationSec: 1.0,
      maxRms: 0.1,
      avgRms: 0.05,
      peakAmp: 0.1,
      reason: 'Web Audio API không hỗ trợ, cho phép pass',
    };
  }

  const audioCtx = new AudioContextClass();
  try {
    const arrayBuffer = await audioBlob.arrayBuffer();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

    const sampleRate = audioBuffer.sampleRate;
    const totalDurationSec = audioBuffer.duration;

    if (totalDurationSec < 0.4) {
      return {
        hasVoice: false,
        speechDurationSec: 0,
        totalDurationSec: Number(totalDurationSec.toFixed(2)),
        maxRms: 0,
        avgRms: 0,
        peakAmp: 0,
        reason: 'Thời lượng ghi âm quá ngắn (< 0.4s)',
      };
    }

    const channelData = audioBuffer.getChannelData(0);
    const frameSamples = Math.floor(sampleRate * 0.025);
    const hopSamples = Math.floor(sampleRate * 0.01);
    const hopSec = hopSamples / sampleRate;

    let speechFrames = 0;
    let totalFrames = 0;
    let maxRms = 0;
    let sumRms = 0;
    let peakAmp = 0;

    for (let i = 0; i <= channelData.length - frameSamples; i += hopSamples) {
      let sumSq = 0;
      for (let j = 0; j < frameSamples; j++) {
        const s = channelData[i + j];
        sumSq += s * s;
        const absVal = Math.abs(s);
        if (absVal > peakAmp) peakAmp = absVal;
      }
      const rms = Math.sqrt(sumSq / frameSamples);
      if (rms > maxRms) maxRms = rms;
      sumRms += rms;
      totalFrames++;

      if (rms >= speechRmsThreshold) speechFrames++;
    }

    const avgRms = totalFrames > 0 ? sumRms / totalFrames : 0;
    const speechDurationSec = speechFrames * hopSec;

    const hasVoice =
      peakAmp >= minPeakAmp &&
      maxRms >= speechRmsThreshold * 1.25 &&
      speechDurationSec >= minSpeechDuration;

    let reason = hasVoice ? 'Phát hiện giọng nói hợp lệ' : 'Không phát hiện giọng nói';
    if (!hasVoice) {
      if (peakAmp < minPeakAmp) {
        reason = 'Âm lượng mic quá nhỏ hoặc micro đang bị tắt tiếng';
      } else if (speechDurationSec < minSpeechDuration) {
        reason = `Thời lượng nói quá ngắn (${speechDurationSec.toFixed(1)}s)`;
      } else {
        reason = 'Chưa nghe rõ giọng nói trong bản ghi âm';
      }
    }

    return {
      hasVoice,
      speechDurationSec: Number(speechDurationSec.toFixed(2)),
      totalDurationSec: Number(totalDurationSec.toFixed(2)),
      maxRms: Number(maxRms.toFixed(4)),
      avgRms: Number(avgRms.toFixed(4)),
      peakAmp: Number(peakAmp.toFixed(4)),
      reason,
    };
  } catch {
    return {
      hasVoice: true,
      speechDurationSec: 1.0,
      totalDurationSec: 1.0,
      maxRms: 0.1,
      avgRms: 0.05,
      peakAmp: 0.1,
      reason: 'Không thể đọc dữ liệu âm thanh',
    };
  } finally {
    try {
      await audioCtx.close();
    } catch {
      // ignore
    }
  }
}

export async function assessSingleAnswer(
  apiUrl: string,
  audioBlob: Blob,
  options: { taskType?: string; referenceText?: string } = {},
): Promise<AssessmentResultJson> {
  const formData = new FormData();
  formData.append('audio', audioBlob, 'practice_answer.webm');
  if (options.taskType) formData.append('task_type', options.taskType);
  if (options.referenceText) formData.append('reference_text', options.referenceText);

  const cleanApi = apiUrl.trim().replace(/\/+$/, '');
  const authHeaders = await getAuthHeaders();
  const startRes = await fetch(`${cleanApi}/assess_practice`, {
    method: 'POST',
    headers: authHeaders,
    body: formData,
  });

  if (!startRes.ok) {
    const errJson = (await startRes.json().catch(() => null)) as { error?: string; detail?: string } | null;
    throw new Error(
      errJson?.error || errJson?.detail || 'Không thể gửi bản thu âm để chấm điểm. Vui lòng thử lại.',
    );
  }

  const startData = (await startRes.json()) as { success?: boolean; task_id?: string; error?: string };
  if (!startData.success || !startData.task_id) {
    throw new Error(startData.error || 'Không thể bắt đầu chấm điểm bài nói. Vui lòng thử lại.');
  }

  const taskId = startData.task_id;
  while (true) {
    await new Promise((r) => setTimeout(r, 2000));
    const statusRes = await fetch(`${cleanApi}/assess_status/${taskId}`, {
      headers: await getAuthHeaders(),
    });
    if (!statusRes.ok) {
      const errJson = (await statusRes.json().catch(() => null)) as { error?: string; detail?: string } | null;
      throw new Error(
        errJson?.error || errJson?.detail || 'Mất kết nối trong khi kiểm tra kết quả chấm bài.',
      );
    }
    const statusData = (await statusRes.json()) as {
      success?: boolean;
      error?: string;
      data?: { status?: string; result?: AssessmentResultJson; error?: string };
    };
    if (!statusData.success) {
      throw new Error(statusData.error || 'Không thể lấy kết quả chấm bài. Vui lòng thử lại.');
    }

    const task = statusData.data;
    if (task?.status === 'completed' && task.result) return task.result;
    if (task?.status === 'error') {
      throw new Error(task.error || 'Không thể hoàn tất chấm điểm câu trả lời. Vui lòng thử lại.');
    }
  }
}

export async function submitTeacherReview(sessionId: string, comment: string) {
  const client = getSupabaseClient();
  const { data, error } = await client.rpc('teacher_review_session', {
    p_session_id: sessionId,
    p_comment: (comment || '').trim(),
  });
  if (error) throw error;
  return data as PracticeSession;
}

let sharedAudioCtx: AudioContext | null = null;
function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!sharedAudioCtx) {
    const Ctor =
      window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (Ctor) sharedAudioCtx = new Ctor();
  }
  if (sharedAudioCtx && sharedAudioCtx.state === 'suspended') {
    sharedAudioCtx.resume().catch(() => {});
  }
  return sharedAudioCtx;
}

export function playBeep(freq = 880, duration = 0.2, type: OscillatorType = 'sine') {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  } catch {
    // ignore beep error
  }
}

export function playStartTone() {
  playBeep(880, 0.15);
  setTimeout(() => playBeep(1174, 0.25), 180);
}

export function playEndTone() {
  playBeep(440, 0.35, 'triangle');
}
