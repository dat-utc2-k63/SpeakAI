import { getRangeForPage, type PaginatedResult } from './pagination';
import { getSupabaseClient } from './supabase';
import type { Assessment, PracticeSession } from './types';

export async function fetchStudentAssessmentsPage(
  studentId: string,
  { page = 1, pageSize = 8 }: { page?: number; pageSize?: number } = {},
): Promise<PaginatedResult<Assessment>> {
  const client = getSupabaseClient();
  const { from, to, safePage, safeSize } = getRangeForPage(page, pageSize);

  const { data, count, error } = await client
    .from('assessments')
    .select(
      `
      id, teacher_id, student_id, created_at, score_total, score_accuracy, score_fluency, score_prosodic, score_grammar, score_context, score_lexical, llm_feedback, teacher_note, status, saved, result_json
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

function computeStudentDashboardStats(assessments: Assessment[], sessions: PracticeSession[]) {
  const assessScores = assessments.filter((a) => a.score_total != null);
  const sessionScores = sessions.filter((s) => s.score_total != null);
  const allTotal = [
    ...assessScores.map((a) => Number(a.score_total || 0)),
    ...sessionScores.map((s) => Number(s.score_total || 0)),
  ];
  const allPR = [
    ...assessScores.map((a) => Number(a.score_accuracy ?? a.score_total ?? 0)),
    ...sessionScores.map((s) => Number(s.score_accuracy ?? s.score_total ?? 0)),
  ];
  const allFC = [
    ...assessScores.filter((a) => a.score_context != null).map((a) => Number(a.score_context)),
    ...sessionScores.filter((s) => s.score_context != null).map((s) => Number(s.score_context)),
  ];

  const avg = (arr: number[]) =>
    arr.length ? (arr.reduce((sum, v) => sum + v, 0) / arr.length).toFixed(1) : '0.0';

  return {
    totalCompleted: assessments.length + sessions.length,
    practiceCount: sessions.length,
    assessCount: assessments.length,
    avgTotal: avg(allTotal),
    avgPR: avg(allPR),
    avgFC: avg(allFC),
  };
}

export interface StudentOverviewData {
  stats: ReturnType<typeof computeStudentDashboardStats>;
  skillMetrics: {
    acc: number | null;
    ctx: number | null;
    lex: number | null;
    gra: number | null;
  };
  trendSourceSessions: PracticeSession[];
  trendSourceAssessments: Assessment[];
  recentSessions: PracticeSession[];
  recentAssessments: Assessment[];
  totalSessions: number;
  totalAssessments: number;
}

export async function fetchStudentOverviewData(studentId: string): Promise<StudentOverviewData> {
  const client = getSupabaseClient();
  const [sessionsRes, assessMetricRes, recentAssessRes] = await Promise.all([
    client
      .from('practice_sessions')
      .select(
        `
        id, mode, status, score_total, score_accuracy, score_context, score_lexical, score_grammar, exam_band, teacher_comment, started_at, completed_at,
        question_set:question_sets(id, title, level, exam_type)
      `,
        { count: 'exact' },
      )
      .eq('student_id', studentId)
      .in('status', ['completed', 'reviewed'])
      .order('completed_at', { ascending: false, nullsFirst: false })
      .limit(100),
    client
      .from('assessments')
      .select(
        'id, teacher_id, student_id, created_at, score_total, score_accuracy, score_context, score_lexical, score_grammar, status, saved',
        { count: 'exact' },
      )
      .eq('student_id', studentId)
      .eq('saved', true)
      .order('created_at', { ascending: false })
      .limit(100),
    client
      .from('assessments')
      .select(
        `
        id, teacher_id, student_id, created_at, score_total, score_accuracy, score_fluency, score_prosodic, score_grammar, score_context, score_lexical, llm_feedback, teacher_note, status, saved, result_json
      `,
      )
      .eq('student_id', studentId)
      .eq('saved', true)
      .order('created_at', { ascending: false })
      .limit(2),
  ]);

  if (sessionsRes.error) throw sessionsRes.error;
  if (assessMetricRes.error) throw assessMetricRes.error;

  const sessionRows = (sessionsRes.data as PracticeSession[]) || [];
  const assessRows = (assessMetricRes.data as Assessment[]) || [];
  const recentAssessments = (recentAssessRes.data as Assessment[]) || [];

  const totalSessions = sessionsRes.count ?? sessionRows.length;
  const totalAssessments = assessMetricRes.count ?? assessRows.length;

  const baseStats = computeStudentDashboardStats(assessRows, sessionRows);
  const stats = {
    ...baseStats,
    totalCompleted: totalSessions + totalAssessments,
    practiceCount: totalSessions,
    assessCount: totalAssessments,
  };

  const allSkillRows = [
    ...sessionRows.map((s) => ({
      acc: s.score_accuracy ?? s.score_total,
      ctx: s.score_context,
      lex: s.score_lexical,
      gra: s.score_grammar,
    })),
    ...assessRows.map((a) => ({
      acc: a.score_accuracy ?? a.score_total,
      ctx: a.score_context,
      lex: a.score_lexical,
      gra: a.score_grammar,
    })),
  ];

  const avgOf = (vals: number[]) =>
    vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : null;

  return {
    stats,
    skillMetrics: {
      acc: avgOf(allSkillRows.filter((r) => r.acc != null).map((r) => Number(r.acc))),
      ctx: avgOf(allSkillRows.filter((r) => r.ctx != null).map((r) => Number(r.ctx))),
      lex: avgOf(allSkillRows.filter((r) => r.lex != null).map((r) => Number(r.lex))),
      gra: avgOf(allSkillRows.filter((r) => r.gra != null).map((r) => Number(r.gra))),
    },
    trendSourceSessions: sessionRows.slice(0, 12),
    trendSourceAssessments: assessRows.slice(0, 12),
    recentSessions: sessionRows.slice(0, 3),
    recentAssessments,
    totalSessions,
    totalAssessments,
  };
}
