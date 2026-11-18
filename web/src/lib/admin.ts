import {
  extractRelatedCount,
  getRangeForPage,
  sanitizePostgrestFilterTerm,
  type PaginatedResult,
} from './pagination';
import { getSupabaseClient } from './supabase';
import type { Assessment, AssessmentResultJson, ExamType, PracticeSession, Profile, QuestionSet } from './types';

export interface AdminOverviewStats {
  totalUsers: number;
  studentCount: number;
  activeTeacherCount: number;
  pendingTeacherCount: number;
  otherUserCount: number;
  voiceReadyNonAdminCount: number;
  nonAdminTotalCount: number;
  questionSetCount: number;
  formatCounts: Record<ExamType, number>;
  savedAssessmentCount: number;
  draftAssessmentCount: number;
  avgAssessmentScore: string;
  practiceSessionCount: number;
  examSessionCount: number;
  pendingTeachers: Profile[];
}

const PROFILE_LIST_FIELDS =
  'id, role, status, full_name, email, phone, teacher_id, voice_enrolled, created_at';
const PROFILE_EXTENDED_FIELDS =
  'id, role, status, full_name, email, phone, teacher_id, voice_enrolled, student_code, date_of_birth, entry_level, target_band, guardian_name, guardian_phone, enrolled_at, enrollment_note, created_at';

export async function fetchAdminOverviewStats(): Promise<AdminOverviewStats> {
  const client = getSupabaseClient();
  const [
    totalUsersRes,
    studentRes,
    activeTeacherRes,
    pendingTeacherListRes,
    nonAdminTotalRes,
    nonAdminVoiceRes,
    qSetTotalRes,
    qIeltsRes,
    qVstepRes,
    qToeicRes,
    qGeneralRes,
    savedAssessCountRes,
    draftAssessCountRes,
    savedAssessScoresRes,
    practiceCountRes,
    examCountRes,
  ] = await Promise.all([
    client.from('profiles').select('id', { count: 'exact', head: true }),
    client.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'student'),
    client
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'teacher')
      .eq('status', 'active'),
    client
      .from('profiles')
      .select(PROFILE_LIST_FIELDS, { count: 'exact' })
      .eq('role', 'teacher')
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(20),
    client.from('profiles').select('id', { count: 'exact', head: true }).neq('role', 'admin'),
    client
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .neq('role', 'admin')
      .eq('voice_enrolled', true),
    client.from('question_sets').select('id', { count: 'exact', head: true }),
    client.from('question_sets').select('id', { count: 'exact', head: true }).eq('exam_type', 'ielts'),
    client.from('question_sets').select('id', { count: 'exact', head: true }).eq('exam_type', 'vstep'),
    client.from('question_sets').select('id', { count: 'exact', head: true }).eq('exam_type', 'toeic'),
    client.from('question_sets').select('id', { count: 'exact', head: true }).eq('exam_type', 'general'),
    client.from('assessments').select('id', { count: 'exact', head: true }).eq('saved', true),
    client.from('assessments').select('id', { count: 'exact', head: true }).eq('saved', false),
    client
      .from('assessments')
      .select('score_total')
      .eq('saved', true)
      .not('score_total', 'is', null)
      .order('created_at', { ascending: false })
      .limit(300),
    client
      .from('practice_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('mode', 'practice')
      .in('status', ['completed', 'reviewed']),
    client
      .from('practice_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('mode', 'exam')
      .in('status', ['completed', 'reviewed']),
  ]);

  if (totalUsersRes.error) throw totalUsersRes.error;
  if (qSetTotalRes.error) throw qSetTotalRes.error;

  const totalUsers = totalUsersRes.count || 0;
  const studentCount = studentRes.count || 0;
  const activeTeacherCount = activeTeacherRes.count || 0;
  const pendingTeachers = (pendingTeacherListRes.data as Profile[]) || [];
  const pendingTeacherCount = pendingTeacherListRes.count ?? pendingTeachers.length;
  const otherUserCount = Math.max(0, totalUsers - studentCount - activeTeacherCount - pendingTeacherCount);

  const scoreRows = (savedAssessScoresRes.data as Array<{ score_total?: number | null }>) || [];
  const avgAssessmentScore =
    scoreRows.length > 0
      ? (scoreRows.reduce((sum, r) => sum + Number(r.score_total || 0), 0) / scoreRows.length).toFixed(1)
      : '0.0';

  return {
    totalUsers,
    studentCount,
    activeTeacherCount,
    pendingTeacherCount,
    otherUserCount,
    voiceReadyNonAdminCount: nonAdminVoiceRes.count || 0,
    nonAdminTotalCount: nonAdminTotalRes.count || 0,
    questionSetCount: qSetTotalRes.count || 0,
    formatCounts: {
      ielts: qIeltsRes.count || 0,
      vstep: qVstepRes.count || 0,
      toeic: qToeicRes.count || 0,
      general: qGeneralRes.count || 0,
    },
    savedAssessmentCount: savedAssessCountRes.count || 0,
    draftAssessmentCount: draftAssessCountRes.count || 0,
    avgAssessmentScore,
    practiceSessionCount: practiceCountRes.count || 0,
    examSessionCount: examCountRes.count || 0,
    pendingTeachers,
  };
}

export async function fetchAdminTeacherDirectory(includeVoiceEmbeddings = false): Promise<Profile[]> {
  const client = getSupabaseClient();
  const cols = includeVoiceEmbeddings
    ? `${PROFILE_LIST_FIELDS}, voice_embeddings, voice_sample_url`
    : PROFILE_LIST_FIELDS;
  const { data, error } = await client
    .from('profiles')
    .select(cols)
    .in('role', ['teacher', 'admin'])
    .order('full_name', { ascending: true });
  if (error) throw error;
  return (data as unknown as Profile[]) || [];
}

export async function fetchAdminUsersPage({
  page = 1,
  pageSize = 10,
  search = '',
  role = '',
  status = '',
  voice = '',
}: {
  page?: number;
  pageSize?: number;
  search?: string;
  role?: string;
  status?: string;
  voice?: string;
}): Promise<PaginatedResult<Profile>> {
  const client = getSupabaseClient();
  const { from, to, safePage, safeSize } = getRangeForPage(page, pageSize);

  const runQuery = async (withExtended: boolean) => {
    let query = client
      .from('profiles')
      .select(withExtended ? PROFILE_EXTENDED_FIELDS : PROFILE_LIST_FIELDS, { count: 'exact' })
      .order('created_at', { ascending: false });

    if (role) query = query.eq('role', role);
    if (status) query = query.eq('status', status);
    if (voice === 'ready') query = query.eq('voice_enrolled', true);
    if (voice === 'missing') query = query.eq('voice_enrolled', false);

    const term = sanitizePostgrestFilterTerm(search);
    if (term) {
      query = query.or(
        withExtended
          ? `full_name.ilike.%${term}%,email.ilike.%${term}%,student_code.ilike.%${term}%`
          : `full_name.ilike.%${term}%,email.ilike.%${term}%`,
      );
    }

    return query.range(from, to);
  };

  let res = await runQuery(true);
  if (res.error && (res.error.code === '42703' || res.error.message?.includes('student_code'))) {
    res = await runQuery(false);
  }
  if (res.error) throw res.error;

  return {
    items: (res.data as unknown as Profile[]) || [],
    total: res.count || 0,
    page: safePage,
    pageSize: safeSize,
  };
}

export async function fetchAdminQuestionSetsPage({
  page = 1,
  pageSize = 8,
  search = '',
  publishFilter = '',
}: {
  page?: number;
  pageSize?: number;
  search?: string;
  publishFilter?: string;
}): Promise<PaginatedResult<QuestionSet>> {
  const client = getSupabaseClient();
  const { from, to, safePage, safeSize } = getRangeForPage(page, pageSize);
  const term = sanitizePostgrestFilterTerm(search);

  let matchingCreatorIds: string[] = [];
  if (term) {
    const { data: creators } = await client
      .from('profiles')
      .select('id')
      .in('role', ['teacher', 'admin'])
      .ilike('full_name', `%${term}%`)
      .limit(50);
    matchingCreatorIds = ((creators as Array<{ id: string }>) || []).map((c) => c.id);
  }

  const buildQuery = (countRelation: 'questions(count)' | 'questions(id)') => {
    let q = client
      .from('question_sets')
      .select(
        `
        id, teacher_id, title, description, level, exam_type, time_limit, is_published, created_at,
        creator:profiles!teacher_id(id, full_name, email),
        ${countRelation}
      `,
        { count: 'exact' },
      )
      .order('created_at', { ascending: false });

    if (publishFilter === 'published') q = q.eq('is_published', true);
    if (publishFilter === 'draft') q = q.eq('is_published', false);

    if (term) {
      const clauses = [`title.ilike.%${term}%`, `description.ilike.%${term}%`];
      if (matchingCreatorIds.length > 0) {
        clauses.push(`teacher_id.in.(${matchingCreatorIds.join(',')})`);
      }
      q = q.or(clauses.join(','));
    }

    return q.range(from, to);
  };

  let res = await buildQuery('questions(count)');
  if (res.error) {
    res = await buildQuery('questions(id)');
  }
  if (res.error) throw res.error;

  const items = ((res.data as unknown as QuestionSet[]) || []).map((qs) => ({
    ...qs,
    creator_name: qs.creator?.full_name || 'Giáo viên',
    creator_email: qs.creator?.email || '',
    question_count: extractRelatedCount(qs.questions),
  }));

  return {
    items,
    total: res.count || 0,
    page: safePage,
    pageSize: safeSize,
  };
}

export async function fetchAdminPracticeSessionsPage({
  page = 1,
  pageSize = 10,
  search = '',
  mode = '',
}: {
  page?: number;
  pageSize?: number;
  search?: string;
  mode?: string;
}): Promise<PaginatedResult<PracticeSession>> {
  const client = getSupabaseClient();
  const { from, to, safePage, safeSize } = getRangeForPage(page, pageSize);
  const term = sanitizePostgrestFilterTerm(search);

  let matchingStudentIds: string[] = [];
  let matchingSetIds: string[] = [];

  if (term) {
    const [studRes, setRes] = await Promise.all([
      client
        .from('profiles')
        .select('id')
        .eq('role', 'student')
        .or(`full_name.ilike.%${term}%,email.ilike.%${term}%`)
        .limit(50),
      client
        .from('question_sets')
        .select('id')
        .ilike('title', `%${term}%`)
        .limit(50),
    ]);
    matchingStudentIds = ((studRes.data as Array<{ id: string }>) || []).map((s) => s.id);
    matchingSetIds = ((setRes.data as Array<{ id: string }>) || []).map((qs) => qs.id);

    if (matchingStudentIds.length === 0 && matchingSetIds.length === 0) {
      return { items: [], total: 0, page: safePage, pageSize: safeSize };
    }
  }

  let query = client
    .from('practice_sessions')
    .select(
      `
      id, student_id, set_id, mode, status, score_total, score_accuracy, score_fluency, score_prosodic, score_grammar, score_context, score_lexical, exam_band, teacher_comment, started_at, completed_at,
      student:profiles!student_id(id, full_name, email),
      question_set:question_sets(id, title, level, exam_type)
    `,
      { count: 'exact' },
    )
    .in('status', ['completed', 'reviewed'])
    .order('completed_at', { ascending: false, nullsFirst: false });

  if (mode === 'practice' || mode === 'exam') {
    query = query.eq('mode', mode);
  }

  if (term) {
    const orParts: string[] = [];
    if (matchingStudentIds.length > 0) {
      orParts.push(`student_id.in.(${matchingStudentIds.join(',')})`);
    }
    if (matchingSetIds.length > 0) {
      orParts.push(`set_id.in.(${matchingSetIds.join(',')})`);
    }
    if (orParts.length > 0) {
      query = query.or(orParts.join(','));
    }
  }

  const { data, count, error } = await query.range(from, to);
  if (error) throw error;

  return {
    items: (data as unknown as PracticeSession[]) || [],
    total: count || 0,
    page: safePage,
    pageSize: safeSize,
  };
}

export async function deletePracticeSessionByAdmin(sessionId: string): Promise<void> {
  const client = getSupabaseClient();
  const { error } = await client.from('practice_sessions').delete().eq('id', sessionId);
  if (error) throw error;
}

export async function fetchAdminAssessmentsPage({
  page = 1,
  pageSize = 10,
  search = '',
  teacherId = '',
  savedFilter = '',
  scoreFilter = '',
}: {
  page?: number;
  pageSize?: number;
  search?: string;
  teacherId?: string;
  savedFilter?: '' | 'saved' | 'draft';
  scoreFilter?: '' | 'excellent' | 'good' | 'fair' | 'needsWork';
}): Promise<PaginatedResult<Assessment>> {
  const client = getSupabaseClient();
  const { from, to, safePage, safeSize } = getRangeForPage(page, pageSize);
  const term = sanitizePostgrestFilterTerm(search);

  let matchingStudentIds: string[] = [];
  let matchingTeacherIds: string[] = [];

  if (term) {
    const [studRes, teachRes] = await Promise.all([
      client
        .from('profiles')
        .select('id')
        .eq('role', 'student')
        .or(`full_name.ilike.%${term}%,email.ilike.%${term}%`)
        .limit(50),
      client
        .from('profiles')
        .select('id')
        .in('role', ['teacher', 'admin'])
        .or(`full_name.ilike.%${term}%,email.ilike.%${term}%`)
        .limit(50),
    ]);
    matchingStudentIds = ((studRes.data as Array<{ id: string }>) || []).map((s) => s.id);
    matchingTeacherIds = ((teachRes.data as Array<{ id: string }>) || []).map((t) => t.id);
  }

  const buildQuery = (includeJsonTitleSearch: boolean) => {
    let query = client
      .from('assessments')
      .select(
        `
        id, teacher_id, student_id, audio_url, created_at, score_total, score_accuracy, score_fluency, score_prosodic, score_grammar, score_context, score_lexical, llm_feedback, teacher_note, status, saved, result_json,
        student:profiles!student_id(id, full_name, email),
        teacher:profiles!teacher_id(id, full_name, email)
      `,
        { count: 'exact' },
      )
      .order('created_at', { ascending: false });

    if (teacherId) query = query.eq('teacher_id', teacherId);
    if (savedFilter === 'saved') query = query.eq('saved', true);
    if (savedFilter === 'draft') query = query.eq('saved', false);

    if (scoreFilter === 'excellent') query = query.gte('score_total', 8);
    if (scoreFilter === 'good') query = query.gte('score_total', 6.5).lt('score_total', 8);
    if (scoreFilter === 'fair') query = query.gte('score_total', 5).lt('score_total', 6.5);
    if (scoreFilter === 'needsWork') query = query.lt('score_total', 5);

    if (term) {
      const orParts: string[] = [`teacher_note.ilike.%${term}%`];
      if (includeJsonTitleSearch) {
        orParts.push(`result_json->>title.ilike.%${term}%`);
      }
      if (matchingStudentIds.length > 0) {
        orParts.push(`student_id.in.(${matchingStudentIds.join(',')})`);
      }
      if (matchingTeacherIds.length > 0) {
        orParts.push(`teacher_id.in.(${matchingTeacherIds.join(',')})`);
      }
      query = query.or(orParts.join(','));
    }

    return query.range(from, to);
  };

  let res = await buildQuery(true);
  if (res.error && term) {
    res = await buildQuery(false);
  }
  if (res.error) throw res.error;

  return {
    items: (res.data as unknown as Assessment[]) || [],
    total: res.count || 0,
    page: safePage,
    pageSize: safeSize,
  };
}

export async function adminUpdateAssessment(
  assessmentId: string,
  {
    title,
    teacherNote,
    saved,
    existingResultJson,
  }: {
    title?: string;
    teacherNote?: string | null;
    saved: boolean;
    existingResultJson?: AssessmentResultJson | null;
  },
): Promise<void> {
  const client = getSupabaseClient();
  const nextJson: AssessmentResultJson | undefined =
    title !== undefined
      ? { ...(existingResultJson || {}), title: title.trim() || undefined }
      : undefined;

  const updatePayload: Record<string, unknown> = {
    saved,
    status: saved ? 'done' : 'pending',
    teacher_note: teacherNote?.trim() ? teacherNote.trim() : null,
  };
  if (nextJson) {
    updatePayload.result_json = nextJson;
  }

  const { error } = await client.from('assessments').update(updatePayload).eq('id', assessmentId);
  if (error) throw error;
}

export async function adminDeleteAssessment(assessmentId: string): Promise<void> {
  const client = getSupabaseClient();
  const { error } = await client.from('assessments').delete().eq('id', assessmentId);
  if (error) throw error;
}

export async function adminCleanupDraftAssessments(): Promise<number> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('assessments')
    .delete()
    .eq('saved', false)
    .select('id');
  if (error) throw error;
  return Array.isArray(data) ? data.length : 0;
}

