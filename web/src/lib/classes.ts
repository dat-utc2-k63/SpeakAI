import {
  getRangeForPage,
  sanitizePostgrestFilterTerm,
  type PaginatedResult,
} from './pagination';
import { getSupabaseClient } from './supabase';
import type {
  Assessment,
  AssignmentCellSummary,
  AssignmentRecord,
  AttendanceStatus,
  ClassMemberRecord,
  ClassMemberRole,
  ClassMemberStatus,
  ClassRecord,
  ClassStatus,
  ClassStudentSummaryRow,
  ClassTeacherBasic,
  ClassroomAnalysisRecord,
  ClassroomAnalysisResult,
  ExamType,
  LessonAttendanceRecord,
  LessonRecord,
  LessonStatus,
  PracticeSession,
  Profile,
  QuestionSet,
  SessionMode,
} from './types';

function avgNums(nums: Array<number | null | undefined>): number | null {
  const valid = nums
    .filter((v): v is number => v != null && !Number.isNaN(Number(v)))
    .map(Number);
  if (valid.length === 0) return null;
  return Number((valid.reduce((a, b) => a + b, 0) / valid.length).toFixed(1));
}

export function generateClassCode(courseType: ExamType = 'ielts'): string {
  const prefix =
    courseType === 'ielts'
      ? 'IELTS'
      : courseType === 'vstep'
        ? 'VSTEP'
        : courseType === 'toeic'
          ? 'TOEIC'
          : 'CLS';
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${prefix}-${rand}`;
}

/* ── ADMIN: CLASSES CRUD & ROSTER ────────────────────────── */
export async function fetchClassesPage({
  page = 1,
  pageSize = 10,
  search = '',
  courseType = '',
  status = '',
}: {
  page?: number;
  pageSize?: number;
  search?: string;
  courseType?: '' | ExamType;
  status?: '' | ClassStatus;
} = {}): Promise<PaginatedResult<ClassRecord>> {
  const client = getSupabaseClient();
  const { from, to, safePage, safeSize } = getRangeForPage(page, pageSize);

  let query = client
    .from('classes')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false });

  if (courseType) query = query.eq('course_type', courseType);
  if (status) query = query.eq('status', status);

  const term = sanitizePostgrestFilterTerm(search);
  if (term) {
    query = query.or(`name.ilike.%${term}%,code.ilike.%${term}%,schedule_text.ilike.%${term}%`);
  }

  const { data, count, error } = await query.range(from, to);
  if (error) throw error;

  const classes = (data as ClassRecord[]) || [];
  const enriched = await enrichClassesWithStats(classes);

  return {
    items: enriched,
    total: count || 0,
    page: safePage,
    pageSize: safeSize,
  };
}

export async function enrichClassesWithStats(
  classes: ClassRecord[],
  currentUserId?: string,
): Promise<ClassRecord[]> {
  if (classes.length === 0) return [];
  const client = getSupabaseClient();
  const classIds = classes.map((c) => c.id);

  const [membersRes, assignmentsRes, sessionsRes, analysesRes] = await Promise.all([
    client
      .from('class_members')
      .select('class_id, user_id, member_role, status, profile:profiles!user_id(full_name)')
      .in('class_id', classIds)
      .in('status', ['active', 'completed']),
    client.from('assignments').select('id, class_id').in('class_id', classIds),
    client
      .from('practice_sessions')
      .select('id, class_id, status, score_total')
      .in('class_id', classIds)
      .in('status', ['completed', 'reviewed'])
      .limit(1000),
    client
      .from('classroom_analyses')
      .select('class_id, en_percent')
      .in('class_id', classIds)
      .order('created_at', { ascending: false })
      .limit(400),
  ]);

  type MemberRow = {
    class_id: string;
    user_id: string;
    member_role: ClassMemberRole;
    status: ClassMemberStatus;
    profile?: { full_name?: string } | Array<{ full_name?: string }> | null;
  };
  const members = (membersRes.data as unknown as MemberRow[]) || [];
  const assignments = (assignmentsRes.data as Array<{ id: string; class_id: string }>) || [];
  const sessions =
    (sessionsRes.data as Array<{
      id: string;
      class_id: string;
      status: string;
      score_total?: number | null;
    }>) || [];
  const analyses =
    (analysesRes.data as Array<{ class_id: string; en_percent: number }>) || [];

  return classes.map((cls) => {
    const clsMembers = members.filter((m) => m.class_id === cls.id);
    const students = clsMembers.filter((m) => m.member_role === 'student');
    const teachers = clsMembers.filter(
      (m) => m.member_role === 'lead_teacher' || m.member_role === 'assistant',
    );
    const teacherNames = teachers
      .map((t) => {
        const p = Array.isArray(t.profile) ? t.profile[0] : t.profile;
        return p?.full_name || '';
      })
      .filter(Boolean);
    const myRow = currentUserId ? clsMembers.find((m) => m.user_id === currentUserId) : undefined;
    const clsSessions = sessions.filter((s) => s.class_id === cls.id);
    const pendingReviewCount = clsSessions.filter((s) => s.status === 'completed').length;
    const clsAnalyses = analyses.filter((a) => a.class_id === cls.id);

    return {
      ...cls,
      student_count: students.length,
      teacher_names: teacherNames,
      my_member_role: myRow?.member_role,
      assignment_count: assignments.filter((a) => a.class_id === cls.id).length,
      pending_review_count: pendingReviewCount,
      avg_band: avgNums(clsSessions.map((s) => s.score_total)),
      avg_en_percent: avgNums(clsAnalyses.map((a) => a.en_percent)),
    };
  });
}

export async function createClass(payload: {
  name: string;
  code: string;
  description?: string | null;
  course_type: ExamType;
  target_band?: number | null;
  schedule_text?: string | null;
  status?: ClassStatus;
  start_date?: string | null;
  end_date?: string | null;
  created_by: string;
}): Promise<ClassRecord> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('classes')
    .insert({
      name: payload.name.trim(),
      code: payload.code.trim().toUpperCase(),
      description: payload.description?.trim() || null,
      course_type: payload.course_type || 'ielts',
      target_band: payload.target_band ?? null,
      schedule_text: payload.schedule_text?.trim() || null,
      status: payload.status || 'active',
      start_date: payload.start_date || null,
      end_date: payload.end_date || null,
      created_by: payload.created_by,
    })
    .select()
    .single();
  if (error) throw error;
  return data as ClassRecord;
}

export async function updateClass(
  classId: string,
  payload: Partial<{
    name: string;
    code: string;
    description: string | null;
    course_type: ExamType;
    target_band: number | null;
    schedule_text: string | null;
    status: ClassStatus;
    start_date: string | null;
    end_date: string | null;
  }>,
): Promise<ClassRecord> {
  const client = getSupabaseClient();
  const clean: Record<string, unknown> = { ...payload };
  if (typeof clean.name === 'string') clean.name = clean.name.trim();
  if (typeof clean.code === 'string') clean.code = clean.code.trim().toUpperCase();
  const { data, error } = await client
    .from('classes')
    .update(clean)
    .eq('id', classId)
    .select()
    .single();
  if (error) throw error;
  return data as ClassRecord;
}

export async function deleteClass(classId: string): Promise<void> {
  const client = getSupabaseClient();
  const { error } = await client.from('classes').delete().eq('id', classId);
  if (error) throw error;
}

export async function fetchClassMembers(classId: string): Promise<ClassMemberRecord[]> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('class_members')
    .select(
      `
      id, class_id, user_id, member_role, status, joined_at,
      profile:profiles!user_id(id, role, status, full_name, email, phone, voice_enrolled, voice_embeddings, created_at)
    `,
    )
    .eq('class_id', classId)
    .order('joined_at', { ascending: true });
  if (error) throw error;

  return ((data as unknown as Array<ClassMemberRecord & { profile?: Profile | Profile[] | null }>) || []).map(
    (m) => ({
      ...m,
      profile: Array.isArray(m.profile) ? m.profile[0] || null : m.profile || null,
    }),
  );
}

export async function addClassMembersBulk(
  classId: string,
  userIds: string[],
  memberRole: ClassMemberRole,
): Promise<void> {
  if (userIds.length === 0) return;
  const client = getSupabaseClient();
  const rows = userIds.map((uid) => ({
    class_id: classId,
    user_id: uid,
    member_role: memberRole,
    status: 'active' as ClassMemberStatus,
  }));
  const { error } = await client
    .from('class_members')
    .upsert(rows, { onConflict: 'class_id,user_id' });
  if (error) throw error;
}

export async function updateClassMember(
  memberId: string,
  updates: Partial<{ member_role: ClassMemberRole; status: ClassMemberStatus }>,
): Promise<void> {
  const client = getSupabaseClient();
  const { error } = await client.from('class_members').update(updates).eq('id', memberId);
  if (error) throw error;
}

export async function removeClassMember(memberId: string): Promise<void> {
  const client = getSupabaseClient();
  const { error } = await client.from('class_members').delete().eq('id', memberId);
  if (error) throw error;
}

export async function fetchActiveProfilesForRoster(): Promise<{
  teachers: Profile[];
  students: Profile[];
  assignedStudentIds: Set<string>;
}> {
  const client = getSupabaseClient();
  const [teachersRes, studentsRes, membershipsRes] = await Promise.all([
    client
      .from('profiles')
      .select('id, role, status, full_name, email, phone, voice_enrolled, created_at')
      .eq('role', 'teacher')
      .eq('status', 'active')
      .order('full_name'),
    client
      .from('profiles')
      .select('id, role, status, full_name, email, phone, voice_enrolled, created_at')
      .eq('role', 'student')
      .eq('status', 'active')
      .order('full_name'),
    client
      .from('class_members')
      .select('user_id')
      .eq('member_role', 'student')
      .eq('status', 'active'),
  ]);
  if (teachersRes.error) throw teachersRes.error;
  if (studentsRes.error) throw studentsRes.error;

  const assignedStudentIds = new Set(
    ((membershipsRes.data as Array<{ user_id: string }>) || []).map((m) => m.user_id),
  );
  return {
    teachers: (teachersRes.data as Profile[]) || [],
    students: (studentsRes.data as Profile[]) || [],
    assignedStudentIds,
  };
}

/* ── TEACHER & ADMIN: MY CLASSES ─────────────────────────── */
export async function fetchMyManagedClasses(
  userId: string,
  role: 'admin' | 'teacher',
): Promise<ClassRecord[]> {
  const client = getSupabaseClient();
  if (role === 'admin') {
    const { data, error } = await client
      .from('classes')
      .select('*')
      .order('status', { ascending: true })
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) throw error;
    return enrichClassesWithStats((data as ClassRecord[]) || [], userId);
  }

  const { data: memberships, error: memErr } = await client
    .from('class_members')
    .select('class_id, member_role')
    .eq('user_id', userId)
    .in('member_role', ['lead_teacher', 'assistant'])
    .eq('status', 'active');
  if (memErr) throw memErr;

  const rows = (memberships as Array<{ class_id: string; member_role: ClassMemberRole }>) || [];
  if (rows.length === 0) return [];

  const classIds = rows.map((r) => r.class_id);
  const { data, error } = await client
    .from('classes')
    .select('*')
    .in('id', classIds)
    .order('status', { ascending: true })
    .order('created_at', { ascending: false });
  if (error) throw error;

  return enrichClassesWithStats((data as ClassRecord[]) || [], userId);
}

/* ── LESSONS & ATTENDANCE ────────────────────────────────── */
export async function fetchClassLessons(classId: string): Promise<LessonRecord[]> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('lessons')
    .select('*')
    .eq('class_id', classId)
    .order('lesson_no', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data as LessonRecord[]) || [];
}

export async function createLesson(payload: {
  class_id: string;
  lesson_no: number;
  title: string;
  scheduled_at?: string | null;
  summary_notes?: string | null;
  status?: LessonStatus;
  created_by: string;
}): Promise<LessonRecord> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('lessons')
    .insert({
      class_id: payload.class_id,
      lesson_no: Math.max(1, Number(payload.lesson_no) || 1),
      title: payload.title.trim(),
      scheduled_at: payload.scheduled_at || null,
      summary_notes: payload.summary_notes?.trim() || null,
      status: payload.status || 'planned',
      created_by: payload.created_by,
    })
    .select()
    .single();
  if (error) throw error;
  return data as LessonRecord;
}

export async function updateLesson(
  lessonId: string,
  payload: Partial<{
    lesson_no: number;
    title: string;
    scheduled_at: string | null;
    summary_notes: string | null;
    status: LessonStatus;
  }>,
): Promise<LessonRecord> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('lessons')
    .update(payload)
    .eq('id', lessonId)
    .select()
    .single();
  if (error) throw error;
  return data as LessonRecord;
}

export async function deleteLesson(lessonId: string): Promise<void> {
  const client = getSupabaseClient();
  const { error } = await client.from('lessons').delete().eq('id', lessonId);
  if (error) throw error;
}

export async function fetchAttendanceForLessons(
  lessonIds: string[],
): Promise<LessonAttendanceRecord[]> {
  if (lessonIds.length === 0) return [];
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('lesson_attendance')
    .select('*')
    .in('lesson_id', lessonIds);
  if (error) throw error;
  return (data as LessonAttendanceRecord[]) || [];
}

export async function saveLessonAttendanceBulk(
  lessonId: string,
  markedBy: string,
  entries: Array<{ student_id: string; status: AttendanceStatus; note?: string | null }>,
): Promise<LessonAttendanceRecord[]> {
  if (entries.length === 0) return [];
  const client = getSupabaseClient();
  const rows = entries.map((e) => ({
    lesson_id: lessonId,
    student_id: e.student_id,
    status: e.status,
    note: e.note?.trim() || null,
    marked_by: markedBy,
    updated_at: new Date().toISOString(),
  }));
  const { data, error } = await client
    .from('lesson_attendance')
    .upsert(rows, { onConflict: 'lesson_id,student_id' })
    .select();
  if (error) throw error;
  return (data as LessonAttendanceRecord[]) || [];
}

/* ── ASSIGNMENTS ─────────────────────────────────────────── */
export async function fetchClassAssignments(classId: string): Promise<AssignmentRecord[]> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('assignments')
    .select(
      `
      *,
      question_set:question_sets(id, title, level, exam_type, is_published),
      lesson:lessons(id, lesson_no, title)
    `,
    )
    .eq('class_id', classId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data as unknown as AssignmentRecord[]) || [];
}

export async function fetchAssignableQuestionSets(): Promise<QuestionSet[]> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('question_sets')
    .select('id, teacher_id, title, description, level, exam_type, is_published, created_at, questions(id)')
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  return ((data as unknown as QuestionSet[]) || []).map((qs) => ({
    ...qs,
    question_count: Array.isArray(qs.questions) ? qs.questions.length : 0,
  }));
}

export async function createAssignment(payload: {
  class_id: string;
  lesson_id?: string | null;
  set_id: string;
  title: string;
  instructions?: string | null;
  mode: SessionMode;
  due_at?: string | null;
  max_attempts: number;
  min_band_target?: number | null;
  assigned_by: string;
}): Promise<AssignmentRecord> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('assignments')
    .insert({
      class_id: payload.class_id,
      lesson_id: payload.lesson_id || null,
      set_id: payload.set_id,
      title: payload.title.trim(),
      instructions: payload.instructions?.trim() || null,
      mode: payload.mode || 'practice',
      due_at: payload.due_at || null,
      max_attempts: Math.max(0, Number(payload.max_attempts) || 0),
      min_band_target: payload.min_band_target ?? null,
      assigned_by: payload.assigned_by,
    })
    .select(
      `
      *,
      question_set:question_sets(id, title, level, exam_type, is_published),
      lesson:lessons(id, lesson_no, title)
    `,
    )
    .single();
  if (error) throw error;
  return data as unknown as AssignmentRecord;
}

export async function deleteAssignment(assignmentId: string): Promise<void> {
  const client = getSupabaseClient();
  const { error } = await client.from('assignments').delete().eq('id', assignmentId);
  if (error) throw error;
}

/* ── CLASS WORKSPACE AGGREGATION & MATRIX ────────────────── */
export interface ClassWorkspaceBundle {
  classInfo: ClassRecord;
  members: ClassMemberRecord[];
  lessons: LessonRecord[];
  attendance: LessonAttendanceRecord[];
  assignments: AssignmentRecord[];
  sessions: PracticeSession[];
  assessments: Assessment[];
  analyses: ClassroomAnalysisRecord[];
  studentRows: ClassStudentSummaryRow[];
  skillAverages: {
    avgTotal: number | null;
    avgP: number | null;
    avgFC: number | null;
    avgLR: number | null;
    avgGRA: number | null;
  };
}

export async function fetchClassWorkspaceBundle(classId: string): Promise<ClassWorkspaceBundle> {
  const client = getSupabaseClient();
  const [clsRes, members, lessons, assignments, sessionsRes, assessmentsRes, analysesRes] =
    await Promise.all([
      client.from('classes').select('*').eq('id', classId).single(),
      fetchClassMembers(classId),
      fetchClassLessons(classId),
      fetchClassAssignments(classId),
      client
        .from('practice_sessions')
        .select(
          `
          id, student_id, set_id, assignment_id, class_id, is_late, mode, status,
          score_total, score_accuracy, score_fluency, score_prosodic, score_grammar, score_context, score_lexical,
          exam_band, teacher_comment, reviewed_by, reviewed_at, started_at, completed_at,
          question_set:question_sets(id, title, level, exam_type)
        `,
        )
        .eq('class_id', classId)
        .in('status', ['completed', 'reviewed'])
        .order('completed_at', { ascending: false }),
      client
        .from('assessments')
        .select(
          `
          id, teacher_id, student_id, class_id, lesson_id, audio_url,
          score_total, score_accuracy, score_fluency, score_prosodic, score_grammar, score_context, score_lexical,
          llm_feedback, teacher_note, status, saved, result_json, created_at,
          student:profiles!student_id(id, full_name, email),
          teacher:profiles!teacher_id(id, full_name, email)
        `,
        )
        .eq('class_id', classId)
        .eq('saved', true)
        .order('created_at', { ascending: false }),
      client
        .from('classroom_analyses')
        .select(
          `
          *,
          lesson:lessons(id, lesson_no, title),
          teacher:profiles!teacher_id(id, full_name, email)
        `,
        )
        .eq('class_id', classId)
        .order('created_at', { ascending: false }),
    ]);

  if (clsRes.error) throw clsRes.error;
  const classInfo = clsRes.data as ClassRecord;
  const attendance = await fetchAttendanceForLessons(lessons.map((l) => l.id));

  const sessions = (sessionsRes.data as unknown as PracticeSession[]) || [];
  const assessments = (assessmentsRes.data as unknown as Assessment[]) || [];
  const analyses = (analysesRes.data as unknown as ClassroomAnalysisRecord[]) || [];

  const studentMembers = members.filter((m) => m.member_role === 'student' && m.profile);
  const completedLessonsCount = lessons.filter((l) => l.status !== 'cancelled').length;

  const studentRows: ClassStudentSummaryRow[] = studentMembers.map((m) => {
    const stu = m.profile as Profile;
    const stuAtt = attendance.filter((a) => a.student_id === stu.id);
    const presentCount = stuAtt.filter((a) => a.status === 'present' || a.status === 'late').length;
    const attTotal = stuAtt.length > 0 ? stuAtt.length : completedLessonsCount;
    const attRate =
      stuAtt.length > 0 ? Math.round((presentCount / stuAtt.length) * 100) : null;

    const stuSessions = sessions.filter((s) => s.student_id === stu.id);
    const stuAssessments = assessments.filter((a) => a.student_id === stu.id);

    const cells: Record<string, AssignmentCellSummary> = {};
    let assignmentsCompleted = 0;
    let overdueMissingCount = 0;
    const nowMs = Date.now();

    for (const asg of assignments) {
      const asgSessions = stuSessions.filter((s) => s.assignment_id === asg.id);
      if (asgSessions.length === 0) {
        cells[asg.id] = {
          assignmentId: asg.id,
          bestSessionId: null,
          bestScore: null,
          attemptsUsed: 0,
          status: 'not_submitted',
          isLate: false,
        };
        if (asg.due_at && new Date(asg.due_at).getTime() < nowMs) {
          overdueMissingCount += 1;
        }
      } else {
        assignmentsCompleted += 1;
        // Pick best score session (tie-breaker: latest completed)
        const sorted = [...asgSessions].sort((a, b) => {
          const diff = Number(b.score_total ?? -1) - Number(a.score_total ?? -1);
          if (diff !== 0) return diff;
          return (
            new Date(b.completed_at || b.started_at).getTime() -
            new Date(a.completed_at || a.started_at).getTime()
          );
        });
        const best = sorted[0];
        const hasReviewed = asgSessions.some((s) => s.status === 'reviewed');
        cells[asg.id] = {
          assignmentId: asg.id,
          bestSessionId: best.id,
          bestScore: best.score_total != null ? Number(best.score_total) : null,
          attemptsUsed: asgSessions.length,
          status: hasReviewed ? 'reviewed' : 'pending_review',
          isLate: Boolean(best.is_late),
        };
      }
    }

    const combinedScores = [
      ...stuSessions.map((s) => ({
        total: s.score_total,
        p: s.score_accuracy,
        fc: s.score_context,
        lr: s.score_lexical,
        gra: s.score_grammar,
      })),
      ...stuAssessments.map((a) => ({
        total: a.score_total,
        p: a.score_accuracy,
        fc: a.score_context,
        lr: a.score_lexical,
        gra: a.score_grammar,
      })),
    ];

    const avgBand = avgNums(combinedScores.map((r) => r.total));
    const avgP = avgNums(combinedScores.map((r) => r.p));
    const avgFC = avgNums(combinedScores.map((r) => r.fc));
    const avgLR = avgNums(combinedScores.map((r) => r.lr));
    const avgGRA = avgNums(combinedScores.map((r) => r.gra));

    const riskReasons: string[] = [];
    if (classInfo.target_band != null && avgBand != null && avgBand <= Number(classInfo.target_band) - 1.0) {
      riskReasons.push(`Thấp hơn mục tiêu (${avgBand.toFixed(1)} / ${Number(classInfo.target_band).toFixed(1)})`);
    }
    if (overdueMissingCount > 0) {
      riskReasons.push(`Chưa nộp ${overdueMissingCount} bài quá hạn`);
    }
    if (attRate != null && attRate < 75) {
      riskReasons.push(`Chuyên cần thấp (${attRate}%)`);
    }

    return {
      student: stu,
      memberStatus: m.status,
      attendancePresent: presentCount,
      attendanceTotal: attTotal,
      attendanceRate: attRate,
      assignmentsCompleted,
      assignmentsTotal: assignments.length,
      avgBand,
      avgP,
      avgFC,
      avgLR,
      avgGRA,
      cells,
      isAtRisk: riskReasons.length > 0,
      riskReasons,
    };
  });

  const allScoreItems = [
    ...sessions.map((s) => ({
      total: s.score_total,
      p: s.score_accuracy,
      fc: s.score_context,
      lr: s.score_lexical,
      gra: s.score_grammar,
    })),
    ...assessments.map((a) => ({
      total: a.score_total,
      p: a.score_accuracy,
      fc: a.score_context,
      lr: a.score_lexical,
      gra: a.score_grammar,
    })),
  ];

  return {
    classInfo,
    members,
    lessons,
    attendance,
    assignments,
    sessions,
    assessments,
    analyses,
    studentRows,
    skillAverages: {
      avgTotal: avgNums(allScoreItems.map((x) => x.total)),
      avgP: avgNums(allScoreItems.map((x) => x.p)),
      avgFC: avgNums(allScoreItems.map((x) => x.fc)),
      avgLR: avgNums(allScoreItems.map((x) => x.lr)),
      avgGRA: avgNums(allScoreItems.map((x) => x.gra)),
    },
  };
}

/* ── TEACHER REVIEW INBOX ────────────────────────────────── */
export async function fetchTeacherReviewInbox({
  teacherId,
  role = 'teacher',
  classId = '',
  status = 'completed',
  search = '',
  page = 1,
  pageSize = 15,
}: {
  teacherId: string;
  role?: 'admin' | 'teacher';
  classId?: string;
  status?: 'completed' | 'reviewed' | 'all';
  search?: string;
  page?: number;
  pageSize?: number;
}): Promise<PaginatedResult<PracticeSession>> {
  const client = getSupabaseClient();
  const { from, to, safePage, safeSize } = getRangeForPage(page, pageSize);

  // Restrict to classes managed by this teacher (or all for admin)
  let allowedClassIds: string[] | null = null;
  if (role === 'teacher') {
    const myClasses = await fetchMyManagedClasses(teacherId, 'teacher');
    allowedClassIds = myClasses.map((c) => c.id);
  }

  let query = client
    .from('practice_sessions')
    .select(
      `
      id, student_id, set_id, assignment_id, class_id, is_late, mode, status,
      score_total, score_accuracy, score_context, score_lexical, score_grammar,
      exam_band, teacher_comment, reviewed_by, reviewed_at, started_at, completed_at,
      question_set:question_sets(id, title, level, exam_type),
      student:profiles!student_id(id, full_name, email),
      assignment:assignments(id, title, due_at, max_attempts),
      class_info:classes!class_id(id, name, code)
    `,
      { count: 'exact' },
    )
    .order('completed_at', { ascending: false, nullsFirst: false });

  if (status === 'all') {
    query = query.in('status', ['completed', 'reviewed']);
  } else {
    query = query.eq('status', status);
  }

  if (classId) {
    query = query.eq('class_id', classId);
  } else if (allowedClassIds !== null && allowedClassIds.length > 0) {
    // Include sessions tied to teacher's classes OR student's self-practice visible via RLS
    // RLS already scopes to teacher's students & classes!
  }

  const term = sanitizePostgrestFilterTerm(search);
  const { data, count, error } = await query.range(from, to);
  if (error) throw error;

  let items = ((data as unknown as PracticeSession[]) || []).map((row) => ({
    ...row,
    student: Array.isArray(row.student) ? row.student[0] || null : row.student || null,
    question_set: Array.isArray(row.question_set) ? row.question_set[0] || null : row.question_set || null,
    assignment: Array.isArray(row.assignment) ? row.assignment[0] || null : row.assignment || null,
    class_info: Array.isArray(row.class_info) ? row.class_info[0] || null : row.class_info || null,
  }));

  if (term) {
    const lower = term.toLowerCase();
    items = items.filter(
      (s) =>
        (s.student?.full_name || '').toLowerCase().includes(lower) ||
        (s.question_set?.title || '').toLowerCase().includes(lower) ||
        (s.assignment?.title || '').toLowerCase().includes(lower) ||
        (s.class_info?.name || '').toLowerCase().includes(lower),
    );
  }

  return {
    items,
    total: term ? items.length : count || 0,
    page: safePage,
    pageSize: safeSize,
  };
}

export async function countPendingReviewsForTeacher(): Promise<number> {
  const client = getSupabaseClient();
  try {
    const { count } = await client
      .from('practice_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'completed');
    return count || 0;
  } catch {
    return 0;
  }
}

/* ── CLASSROOM EN/VI ANALYSIS PERSISTENCE ────────────────── */
export async function saveClassroomAnalysis(payload: {
  class_id?: string | null;
  lesson_id?: string | null;
  teacher_id: string;
  file_name: string;
  result: ClassroomAnalysisResult;
}): Promise<ClassroomAnalysisRecord> {
  const client = getSupabaseClient();
  const ov = payload.result.overall || {};
  const dur = payload.result.duration || {};
  const { data, error } = await client
    .from('classroom_analyses')
    .insert({
      class_id: payload.class_id || null,
      lesson_id: payload.lesson_id || null,
      teacher_id: payload.teacher_id,
      file_name: payload.file_name,
      en_percent: Number(ov.en_percent || 0),
      vi_percent: Number(ov.vi_percent || 0),
      en_time_percent: ov.en_time_percent != null ? Number(ov.en_time_percent) : null,
      vi_time_percent: ov.vi_time_percent != null ? Number(ov.vi_time_percent) : null,
      speech_ratio_percent:
        dur.speech_ratio_percent != null ? Number(dur.speech_ratio_percent) : null,
      total_audio_sec: dur.total_audio_sec != null ? Number(dur.total_audio_sec) : null,
      total_words: Number(ov.total_words || 0),
      result_json: payload.result,
    })
    .select(
      `
      *,
      class_info:classes!class_id(id, name, code),
      lesson:lessons(id, lesson_no, title),
      teacher:profiles!teacher_id(id, full_name, email)
    `,
    )
    .single();
  if (error) throw error;
  return data as unknown as ClassroomAnalysisRecord;
}

export async function fetchClassroomAnalysesPage({
  page = 1,
  pageSize = 10,
  classId = '',
}: {
  page?: number;
  pageSize?: number;
  classId?: string;
} = {}): Promise<PaginatedResult<ClassroomAnalysisRecord>> {
  const client = getSupabaseClient();
  const { from, to, safePage, safeSize } = getRangeForPage(page, pageSize);

  let query = client
    .from('classroom_analyses')
    .select(
      `
      *,
      class_info:classes!class_id(id, name, code),
      lesson:lessons(id, lesson_no, title),
      teacher:profiles!teacher_id(id, full_name, email)
    `,
      { count: 'exact' },
    )
    .order('created_at', { ascending: false });

  if (classId) query = query.eq('class_id', classId);

  const { data, count, error } = await query.range(from, to);
  if (error) throw error;

  return {
    items: (data as unknown as ClassroomAnalysisRecord[]) || [],
    total: count || 0,
    page: safePage,
    pageSize: safeSize,
  };
}

export async function deleteClassroomAnalysis(id: string): Promise<void> {
  const client = getSupabaseClient();
  const { error } = await client.from('classroom_analyses').delete().eq('id', id);
  if (error) throw error;
}

/* ── STUDENT: MY CLASSES & ASSIGNMENTS ───────────────────── */
export async function fetchClassTeachersRpc(classId: string): Promise<ClassTeacherBasic[]> {
  const client = getSupabaseClient();
  const { data, error } = await client.rpc('get_class_teachers', { p_class_id: classId });
  if (error) return [];
  return (data as ClassTeacherBasic[]) || [];
}

export interface StudentClassEnrollment {
  classInfo: ClassRecord;
  memberStatus: ClassMemberStatus;
  joinedAt: string;
  teachers: ClassTeacherBasic[];
  attendancePresent: number;
  attendanceTotal: number;
}

export async function fetchStudentClasses(studentId: string): Promise<StudentClassEnrollment[]> {
  const client = getSupabaseClient();
  const { data: memRows, error: memErr } = await client
    .from('class_members')
    .select('class_id, status, joined_at')
    .eq('user_id', studentId)
    .eq('member_role', 'student')
    .in('status', ['active', 'completed'])
    .order('joined_at', { ascending: false });
  if (memErr) throw memErr;

  const memberships =
    (memRows as Array<{ class_id: string; status: ClassMemberStatus; joined_at: string }>) || [];
  if (memberships.length === 0) return [];

  const classIds = memberships.map((m) => m.class_id);
  const [classesRes, lessonsRes, attendanceRes, teachersLists] = await Promise.all([
    client.from('classes').select('*').in('id', classIds),
    client.from('lessons').select('id, class_id').in('class_id', classIds),
    client.from('lesson_attendance').select('lesson_id, status').eq('student_id', studentId),
    Promise.all(classIds.map((cid) => fetchClassTeachersRpc(cid))),
  ]);
  if (classesRes.error) throw classesRes.error;

  const classMap = new Map(((classesRes.data as ClassRecord[]) || []).map((c) => [c.id, c]));
  const lessonToClass = new Map(
    ((lessonsRes.data as Array<{ id: string; class_id: string }>) || []).map((l) => [
      l.id,
      l.class_id,
    ]),
  );
  const attendanceRows =
    (attendanceRes.data as Array<{ lesson_id: string; status: AttendanceStatus }>) || [];

  const out: StudentClassEnrollment[] = [];
  memberships.forEach((m, idx) => {
    const cls = classMap.get(m.class_id);
    if (!cls) return;
    const clsAtt = attendanceRows.filter((a) => lessonToClass.get(a.lesson_id) === m.class_id);
    const present = clsAtt.filter((a) => a.status === 'present' || a.status === 'late').length;
    out.push({
      classInfo: cls,
      memberStatus: m.status,
      joinedAt: m.joined_at,
      teachers: teachersLists[idx] || [],
      attendancePresent: present,
      attendanceTotal: clsAtt.length,
    });
  });
  return out;
}

export async function fetchStudentAssignments(studentId: string): Promise<AssignmentRecord[]> {
  const client = getSupabaseClient();
  const { data: memRows } = await client
    .from('class_members')
    .select('class_id')
    .eq('user_id', studentId)
    .eq('member_role', 'student')
    .eq('status', 'active');

  const classIds = ((memRows as Array<{ class_id: string }>) || []).map((m) => m.class_id);
  if (classIds.length === 0) return [];

  const [asgRes, sessRes] = await Promise.all([
    client
      .from('assignments')
      .select(
        `
        *,
        question_set:question_sets(id, title, level, exam_type, is_published),
        class_info:classes!class_id(id, name, code, course_type),
        lesson:lessons(id, lesson_no, title)
      `,
      )
      .in('class_id', classIds)
      .order('due_at', { ascending: true, nullsFirst: false }),
    client
      .from('practice_sessions')
      .select(
        'id, assignment_id, status, score_total, is_late, started_at, completed_at, teacher_comment',
      )
      .eq('student_id', studentId)
      .not('assignment_id', 'is', null)
      .in('status', ['completed', 'reviewed'])
      .order('completed_at', { ascending: false }),
  ]);
  if (asgRes.error) throw asgRes.error;

  const assignments = (asgRes.data as unknown as AssignmentRecord[]) || [];
  const sessions = (sessRes.data as unknown as PracticeSession[]) || [];

  return assignments.map((a) => {
    const mine = sessions.filter((s) => s.assignment_id === a.id);
    const scores = mine
      .map((s) => s.score_total)
      .filter((v): v is number => v != null && !Number.isNaN(Number(v)));
    const bestScore = scores.length > 0 ? Math.max(...scores) : null;
    return {
      ...a,
      used_attempts: mine.length,
      best_score: bestScore,
      latest_session: mine[0] || null,
      has_late_submission: mine.some((s) => Boolean(s.is_late)),
    };
  });
}

/* ── CSV EXPORT (UTF-8 BOM FOR EXCEL) ────────────────────── */
export function exportClassReportCsv(bundle: ClassWorkspaceBundle): void {
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const headers = [
    'Họ tên Học viên',
    'Email',
    'Mẫu giọng',
    'Chuyên cần',
    'Bài tập hoàn thành',
    'Band TB',
    'P (Phát âm)',
    'FC (Trôi chảy)',
    'LR (Từ vựng)',
    'GRA (Ngữ pháp)',
    ...bundle.assignments.map((a) => `BT: ${a.title}`),
    'Cảnh báo',
  ];

  const rows = bundle.studentRows.map((row) => {
    const attStr =
      row.attendanceRate != null
        ? `${row.attendancePresent}/${row.attendanceTotal} (${row.attendanceRate}%)`
        : '--';
    const asgStr = `${row.assignmentsCompleted}/${row.assignmentsTotal}`;
    return [
      esc(row.student.full_name),
      esc(row.student.email),
      esc(row.student.voice_enrolled ? 'Đã có' : 'Chưa có'),
      esc(attStr),
      esc(asgStr),
      esc(row.avgBand != null ? row.avgBand.toFixed(1) : '--'),
      esc(row.avgP != null ? row.avgP.toFixed(1) : '--'),
      esc(row.avgFC != null ? row.avgFC.toFixed(1) : '--'),
      esc(row.avgLR != null ? row.avgLR.toFixed(1) : '--'),
      esc(row.avgGRA != null ? row.avgGRA.toFixed(1) : '--'),
      ...bundle.assignments.map((a) => {
        const cell = row.cells[a.id];
        if (!cell || cell.status === 'not_submitted') return esc('Chưa nộp');
        const scoreStr = cell.bestScore != null ? cell.bestScore.toFixed(1) : '--';
        const lateTag = cell.isLate ? ' (Trễ)' : '';
        return esc(`${scoreStr}${lateTag}`);
      }),
      esc(row.riskReasons.join('; ')),
    ].join(',');
  });

  const csvContent = '\uFEFF' + [headers.map(esc).join(','), ...rows].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const safeCode = (bundle.classInfo.code || 'class').replace(/[^a-zA-Z0-9_-]/g, '_');
  a.download = `BaoCao_Lop_${safeCode}_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
