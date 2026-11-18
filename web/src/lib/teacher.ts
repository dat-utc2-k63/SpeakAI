import {
  getRangeForPage,
  sanitizePostgrestFilterTerm,
  type PaginatedResult,
} from './pagination';
import { getSupabaseClient } from './supabase';
import type {
  Assessment,
  AssessmentResultJson,
  PracticeSession,
  Profile,
  SessionMode,
} from './types';

export async function fetchMyStudents(teacherId: string): Promise<Profile[]> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('profiles')
    .select('id, role, status, full_name, email, phone, teacher_id, voice_enrolled, voice_embeddings, created_at')
    .eq('role', 'student')
    .eq('teacher_id', teacherId)
    .order('full_name');
  if (error) throw error;
  return (data as Profile[]) || [];
}

export async function fetchMyStudentIds(teacherId: string): Promise<string[]> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('profiles')
    .select('id')
    .eq('role', 'student')
    .eq('teacher_id', teacherId);
  if (error) throw error;
  return ((data as Array<{ id: string }>) || []).map((row) => row.id);
}

export async function fetchTeacherStudentOptions(teacherId: string): Promise<Profile[]> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('profiles')
    .select('id, role, status, full_name, email, teacher_id, voice_enrolled, voice_embeddings, created_at')
    .eq('role', 'student')
    .eq('teacher_id', teacherId)
    .order('full_name');
  if (error) throw error;
  return (data as Profile[]) || [];
}

export async function fetchMyStudentsPage(
  teacherId: string,
  {
    page = 1,
    pageSize = 10,
    search = '',
    voiceFilter = '',
  }: {
    page?: number;
    pageSize?: number;
    search?: string;
    voiceFilter?: '' | 'ready' | 'missing';
  } = {},
): Promise<PaginatedResult<Profile>> {
  const client = getSupabaseClient();
  const { from, to, safePage, safeSize } = getRangeForPage(page, pageSize);

  let query = client
    .from('profiles')
    .select(
      'id, role, status, full_name, email, phone, teacher_id, voice_enrolled, created_at',
      { count: 'exact' },
    )
    .eq('role', 'student')
    .eq('teacher_id', teacherId)
    .order('full_name', { ascending: true });

  if (voiceFilter === 'ready') query = query.eq('voice_enrolled', true);
  if (voiceFilter === 'missing') query = query.eq('voice_enrolled', false);

  const term = sanitizePostgrestFilterTerm(search);
  if (term) {
    query = query.or(`full_name.ilike.%${term}%,email.ilike.%${term}%`);
  }

  const { data, count, error } = await query.range(from, to);
  if (error) throw error;

  return {
    items: (data as Profile[]) || [],
    total: count || 0,
    page: safePage,
    pageSize: safeSize,
  };
}

export async function fetchTeacherStats(teacherId: string) {
  const client = getSupabaseClient();
  const [studentsRes, assessmentsCountRes, assessmentScoresRes, qsetsRes] = await Promise.all([
    client
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'student')
      .eq('teacher_id', teacherId),
    client
      .from('assessments')
      .select('id', { count: 'exact', head: true })
      .eq('teacher_id', teacherId)
      .eq('saved', true),
    client
      .from('assessments')
      .select('score_total')
      .eq('teacher_id', teacherId)
      .eq('saved', true)
      .not('score_total', 'is', null)
      .order('created_at', { ascending: false })
      .limit(300),
    client
      .from('question_sets')
      .select('id', { count: 'exact', head: true })
      .eq('teacher_id', teacherId),
  ]);
  const studentCount = studentsRes.count || 0;
  const assessmentCount = assessmentsCountRes.count || 0;
  const scoreRows = (assessmentScoresRes.data as Array<{ score_total?: number | null }>) || [];
  const questionSetsCount = qsetsRes.count || 0;
  const avgScore =
    scoreRows.length > 0
      ? (scoreRows.reduce((a, b) => a + Number(b.score_total || 0), 0) / scoreRows.length).toFixed(1)
      : '0.0';
  return { studentCount, assessmentCount, questionSetsCount, avgScore };
}

export interface ClassSkillAnalytics {
  avgAccuracy: number | null;
  avgContext: number | null;
  avgLexical: number | null;
  avgGrammar: number | null;
  distribution: {
    excellent: number;
    good: number;
    fair: number;
    needsWork: number;
  };
  totalRecords: number;
}

export async function fetchTeacherClassAnalytics(
  teacherId: string,
  studentIds: string[],
): Promise<ClassSkillAnalytics> {
  const client = getSupabaseClient();
  const [assessRes, sessRes] = await Promise.all([
    client
      .from('assessments')
      .select('score_total, score_accuracy, score_context, score_lexical, score_grammar')
      .eq('teacher_id', teacherId)
      .eq('saved', true)
      .order('created_at', { ascending: false })
      .limit(300),
    studentIds.length > 0
      ? client
          .from('practice_sessions')
          .select('score_total, score_accuracy, score_context, score_lexical, score_grammar')
          .in('student_id', studentIds)
          .in('status', ['completed', 'reviewed'])
          .order('completed_at', { ascending: false })
          .limit(300)
      : Promise.resolve({ data: [], error: null }),
  ]);

  type Row = {
    score_total?: number | null;
    score_accuracy?: number | null;
    score_context?: number | null;
    score_lexical?: number | null;
    score_grammar?: number | null;
  };

  const rows: Row[] = [
    ...((assessRes.data as Row[]) || []),
    ...((sessRes.data as Row[]) || []),
  ];

  const avgOf = (vals: number[]) =>
    vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : null;

  const accList = rows
    .filter((r) => (r.score_accuracy ?? r.score_total) != null)
    .map((r) => Number(r.score_accuracy ?? r.score_total));
  const ctxList = rows.filter((r) => r.score_context != null).map((r) => Number(r.score_context));
  const lexList = rows.filter((r) => r.score_lexical != null).map((r) => Number(r.score_lexical));
  const graList = rows.filter((r) => r.score_grammar != null).map((r) => Number(r.score_grammar));

  const distribution = { excellent: 0, good: 0, fair: 0, needsWork: 0 };
  for (const r of rows) {
    if (r.score_total == null) continue;
    const sc = Number(r.score_total);
    if (sc >= 8) distribution.excellent += 1;
    else if (sc >= 6.5) distribution.good += 1;
    else if (sc >= 5) distribution.fair += 1;
    else distribution.needsWork += 1;
  }

  return {
    avgAccuracy: avgOf(accList),
    avgContext: avgOf(ctxList),
    avgLexical: avgOf(lexList),
    avgGrammar: avgOf(graList),
    distribution,
    totalRecords: rows.length,
  };
}

export async function fetchStudentAssessmentsForTeacher(studentId: string): Promise<Assessment[]> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('assessments')
    .select(
      `
      id, teacher_id, student_id, created_at, score_total, score_accuracy, score_fluency, score_prosodic, score_grammar, score_context, score_lexical, llm_feedback, teacher_note, status, saved, result_json,
      student:profiles!student_id(full_name, email)
    `,
    )
    .eq('student_id', studentId)
    .eq('saved', true)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data as Assessment[]) || [];
}

export async function fetchStudentAssessmentsForTeacherPage(
  studentId: string,
  { page = 1, pageSize = 6 }: { page?: number; pageSize?: number } = {},
): Promise<PaginatedResult<Assessment>> {
  const client = getSupabaseClient();
  const { from, to, safePage, safeSize } = getRangeForPage(page, pageSize);

  const { data, count, error } = await client
    .from('assessments')
    .select(
      `
      id, teacher_id, student_id, created_at, score_total, score_accuracy, score_fluency, score_prosodic, score_grammar, score_context, score_lexical, llm_feedback, teacher_note, status, saved, result_json,
      student:profiles!student_id(full_name, email)
    `,
      { count: 'exact' },
    )
    .eq('student_id', studentId)
    .eq('saved', true)
    .order('created_at', { ascending: false })
    .range(from, to);

  if (error) throw error;
  return {
    items: (data as Assessment[]) || [],
    total: count || 0,
    page: safePage,
    pageSize: safeSize,
  };
}

export async function fetchStudentPracticeSessionsForTeacher(studentId: string): Promise<PracticeSession[]> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('practice_sessions')
    .select(
      `
      id, mode, status, score_total, score_accuracy, score_fluency, score_prosodic, score_grammar, score_context, score_lexical, exam_band,
      teacher_comment, reviewed_by, reviewed_at,
      started_at, completed_at,
      question_set:question_sets(id, title, level, exam_type)
    `,
    )
    .eq('student_id', studentId)
    .in('status', ['completed', 'reviewed'])
    .order('completed_at', { ascending: false, nullsFirst: false });
  if (error) throw error;
  return (data as PracticeSession[]) || [];
}

export async function fetchStudentPracticeSessionsForTeacherPage(
  studentId: string,
  {
    page = 1,
    pageSize = 6,
    mode = 'all',
  }: { page?: number; pageSize?: number; mode?: 'all' | SessionMode } = {},
): Promise<PaginatedResult<PracticeSession>> {
  const client = getSupabaseClient();
  const { from, to, safePage, safeSize } = getRangeForPage(page, pageSize);

  let query = client
    .from('practice_sessions')
    .select(
      `
      id, mode, status, score_total, score_accuracy, score_fluency, score_prosodic, score_grammar, score_context, score_lexical, exam_band,
      teacher_comment, reviewed_by, reviewed_at,
      started_at, completed_at,
      question_set:question_sets(id, title, level, exam_type)
    `,
      { count: 'exact' },
    )
    .eq('student_id', studentId)
    .in('status', ['completed', 'reviewed'])
    .order('completed_at', { ascending: false, nullsFirst: false });

  if (mode !== 'all') {
    query = query.eq('mode', mode);
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

export async function createAssessment(
  teacherId: string,
  studentId: string,
  audioUrl: string,
): Promise<Assessment> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('assessments')
    .insert({
      teacher_id: teacherId,
      student_id: studentId,
      audio_url: audioUrl,
      status: 'pending',
      saved: false,
    })
    .select()
    .single();
  if (error) throw error;
  return data as Assessment;
}

export async function uploadConversationAudio(teacherId: string, file: File): Promise<string> {
  const client = getSupabaseClient();
  const ext = file.name.split('.').pop() || 'wav';
  const path = `conversations/${teacherId}/${Date.now()}.${ext}`;
  const { error } = await client.storage.from('speakai-audio').upload(path, file, { upsert: false });
  if (error) throw error;
  const { data: urlData } = client.storage.from('speakai-audio').getPublicUrl(path);
  return urlData.publicUrl;
}

export async function uploadAudioUrlToSupabase(
  teacherId: string,
  url: string,
  suffix: string,
): Promise<string> {
  try {
    const client = getSupabaseClient();
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Failed to fetch audio from ${url}`);
    const blob = await response.blob();
    const ext = url.split('.').pop()?.split('?')[0] || 'wav';
    const path = `conversations/${teacherId}/extracted_${Date.now()}_${suffix}.${ext}`;
    const { error } = await client.storage.from('speakai-audio').upload(path, blob, {
      upsert: false,
      contentType: blob.type || (ext === 'wav' ? 'audio/wav' : undefined),
    });
    if (error) throw error;
    const { data: urlData } = client.storage.from('speakai-audio').getPublicUrl(path);
    return urlData.publicUrl;
  } catch (err) {
    console.error('Lỗi upload url:', url, err);
    return url;
  }
}

export async function saveAssessment(
  assessmentId: string,
  resultData: {
    score_total: number;
    score_accuracy: number;
    score_fluency: number;
    score_prosodic: number;
    score_grammar?: number | null;
    score_context?: number | null;
    score_lexical?: number | null;
    llm_feedback?: string | null;
    result_json: AssessmentResultJson;
    title?: string;
  },
): Promise<void> {
  const client = getSupabaseClient();
  const finalJson: AssessmentResultJson = { ...(resultData.result_json || {}), title: resultData.title };

  const updatePayload: Record<string, unknown> = {
    saved: true,
    status: 'done',
    score_total: resultData.score_total,
    score_accuracy: resultData.score_accuracy,
    score_fluency: resultData.score_fluency,
    score_prosodic: resultData.score_prosodic,
    llm_feedback: resultData.llm_feedback || null,
    result_json: finalJson,
  };
  if (resultData.score_grammar != null) updatePayload.score_grammar = resultData.score_grammar;
  if (resultData.score_context != null) updatePayload.score_context = resultData.score_context;
  if (resultData.score_lexical != null) updatePayload.score_lexical = resultData.score_lexical;

  const { error } = await client.from('assessments').update(updatePayload).eq('id', assessmentId);
  if (error) throw error;
}

export async function fetchSavedAssessments(teacherId: string): Promise<Assessment[]> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('assessments')
    .select(
      `
      id, teacher_id, student_id, created_at, score_total, score_accuracy, score_fluency, score_prosodic, score_grammar, score_context, score_lexical, llm_feedback, teacher_note, status, saved, result_json,
      student:profiles!student_id(full_name, email)
    `,
    )
    .eq('teacher_id', teacherId)
    .eq('saved', true)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data as Assessment[]) || [];
}

export async function fetchSavedAssessmentsPage(
  teacherId: string,
  {
    page = 1,
    pageSize = 8,
    search = '',
  }: { page?: number; pageSize?: number; search?: string } = {},
): Promise<PaginatedResult<Assessment>> {
  const client = getSupabaseClient();
  const { from, to, safePage, safeSize } = getRangeForPage(page, pageSize);
  const term = sanitizePostgrestFilterTerm(search);

  let matchingStudentIds: string[] = [];
  if (term) {
    const { data: students } = await client
      .from('profiles')
      .select('id')
      .eq('role', 'student')
      .eq('teacher_id', teacherId)
      .or(`full_name.ilike.%${term}%,email.ilike.%${term}%`)
      .limit(50);
    matchingStudentIds = ((students as Array<{ id: string }>) || []).map((s) => s.id);
  }

  const runQuery = (includeJsonTitleSearch: boolean) => {
    let query = client
      .from('assessments')
      .select(
        `
        id, teacher_id, student_id, created_at, score_total, score_accuracy, score_fluency, score_prosodic, score_grammar, score_context, score_lexical, llm_feedback, teacher_note, status, saved, result_json,
        student:profiles!student_id(full_name, email)
      `,
        { count: 'exact' },
      )
      .eq('teacher_id', teacherId)
      .eq('saved', true)
      .order('created_at', { ascending: false });

    if (term) {
      const orParts: string[] = [`teacher_note.ilike.%${term}%`];
      if (includeJsonTitleSearch) {
        orParts.push(`result_json->>title.ilike.%${term}%`);
      }
      if (matchingStudentIds.length > 0) {
        orParts.push(`student_id.in.(${matchingStudentIds.join(',')})`);
      }
      query = query.or(orParts.join(','));
    }

    return query.range(from, to);
  };

  let res = await runQuery(true);
  if (res.error && term) {
    res = await runQuery(false);
  }
  if (res.error) throw res.error;

  return {
    items: (res.data as Assessment[]) || [],
    total: res.count || 0,
    page: safePage,
    pageSize: safeSize,
  };
}

export async function deleteAssessment(assessmentId: string): Promise<void> {
  const client = getSupabaseClient();
  const { error } = await client.from('assessments').delete().eq('id', assessmentId);
  if (error) throw error;
}

