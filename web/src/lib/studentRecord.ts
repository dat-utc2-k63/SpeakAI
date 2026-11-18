import { getSupabaseClient } from './supabase';
import type {
  Assessment,
  ClassMemberStatus,
  ClassRecord,
  ClassTeacherBasic,
  PracticeSession,
  Profile,
} from './types';

export interface StudentClassHistoryItem {
  membershipId: string;
  classInfo: ClassRecord;
  membershipStatus: ClassMemberStatus;
  joinedAt: string;
  teachers: ClassTeacherBasic[];
}

export interface StudentAttendanceSummary {
  total: number;
  present: number;
  late: number;
  absent: number;
  excused: number;
  rate: number | null;
}

export interface StudentFullRecord {
  profile: Profile;
  classHistory: StudentClassHistoryItem[];
  attendance: StudentAttendanceSummary;
  practiceSessions: PracticeSession[];
  assessments: Assessment[];
  avgBand: number | null;
  totalCompletedCount: number;
}

export async function fetchStudentFullRecord(studentId: string): Promise<StudentFullRecord> {
  const client = getSupabaseClient();

  const [profileRes, membershipsRes, attendanceRes, sessionsRes, assessmentsRes] = await Promise.all([
    client.from('profiles').select('*').eq('id', studentId).single(),
    client
      .from('class_members')
      .select('id, class_id, status, joined_at, class_info:classes!class_id(*)')
      .eq('user_id', studentId)
      .eq('member_role', 'student')
      .order('joined_at', { ascending: false }),
    client
      .from('lesson_attendance')
      .select('status')
      .eq('student_id', studentId),
    client
      .from('practice_sessions')
      .select(
        `
        id, student_id, set_id, assignment_id, class_id, is_late, mode, status,
        score_total, score_accuracy, score_context, score_lexical, score_grammar,
        exam_band, teacher_comment, started_at, completed_at,
        question_set:question_sets(id, title, exam_type, level),
        class_info:classes!class_id(id, name, code)
      `,
      )
      .eq('student_id', studentId)
      .in('status', ['completed', 'reviewed'])
      .order('completed_at', { ascending: false })
      .limit(50),
    client
      .from('assessments')
      .select(
        `
        *,
        teacher:profiles!teacher_id(id, full_name, email),
        student:profiles!student_id(id, full_name, email)
      `,
      )
      .eq('student_id', studentId)
      .eq('saved', true)
      .order('created_at', { ascending: false })
      .limit(50),
  ]);

  if (profileRes.error) throw profileRes.error;
  const profile = profileRes.data as Profile;

  const rawMemberships =
    (membershipsRes.data as unknown as Array<{
      id: string;
      class_id: string;
      status: ClassMemberStatus;
      joined_at: string;
      class_info: ClassRecord | null;
    }>) || [];

  const classHistory: StudentClassHistoryItem[] = await Promise.all(
    rawMemberships
      .filter((m) => Boolean(m.class_info))
      .map(async (m) => {
        const { data: teachersData } = await client.rpc('get_class_teachers', {
          p_class_id: m.class_id,
        });
        return {
          membershipId: m.id,
          classInfo: m.class_info as ClassRecord,
          membershipStatus: m.status,
          joinedAt: m.joined_at,
          teachers: (teachersData as ClassTeacherBasic[]) || [],
        };
      }),
  );

  const attRows = (attendanceRes.data as Array<{ status: string }>) || [];
  let present = 0;
  let late = 0;
  let absent = 0;
  let excused = 0;
  for (const r of attRows) {
    if (r.status === 'present') present++;
    else if (r.status === 'late') late++;
    else if (r.status === 'absent') absent++;
    else if (r.status === 'excused') excused++;
  }
  const attTotal = attRows.length;
  const attRate = attTotal > 0 ? Math.round(((present + late) / attTotal) * 100) : null;

  const practiceSessions = (sessionsRes.data as unknown as PracticeSession[]) || [];
  const assessments = (assessmentsRes.data as unknown as Assessment[]) || [];

  const allScores = [
    ...practiceSessions.map((s) => s.score_total),
    ...assessments.map((a) => a.score_total),
  ]
    .map((v) => (v != null && !Number.isNaN(Number(v)) ? Number(v) : null))
    .filter((v): v is number => v !== null);

  const avgBand =
    allScores.length > 0
      ? Math.round((allScores.reduce((a, b) => a + b, 0) / allScores.length) * 10) / 10
      : null;

  return {
    profile,
    classHistory,
    attendance: {
      total: attTotal,
      present,
      late,
      absent,
      excused,
      rate: attRate,
    },
    practiceSessions,
    assessments,
    avgBand,
    totalCompletedCount: practiceSessions.length + assessments.length,
  };
}
