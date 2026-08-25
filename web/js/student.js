import { supabase } from './supabase.js';

// =========================================================
// STUDENT MODULE
// =========================================================

/**
 * Lấy profile + tên teacher của student
 */
export async function fetchStudentProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*, teacher:profiles!teacher_id(id, full_name, email)')
    .eq('id', userId)
    .single();
  if (error) throw error;
  return data;
}

/**
 * Lấy danh sách assessments của student đã được lưu bởi teacher
 */
export async function fetchStudentAssessments(studentId) {
  const { data, error } = await supabase
    .from('assessments')
    .select(`
      id, created_at, score_total, score_accuracy, score_fluency, score_prosodic, llm_feedback, status, result_json,
      teacher:profiles!teacher_id(full_name)
    `)
    .eq('student_id', studentId)
    .eq('saved', true)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

/**
 * Lấy điểm trung bình của student
 */
export async function fetchStudentStats(studentId) {
  const { data, error } = await supabase
    .from('assessments')
    .select('score_total, score_accuracy, score_fluency, score_prosodic')
    .eq('student_id', studentId)
    .eq('saved', true);
  if (error) throw error;
  if (!data || data.length === 0) return { count: 0, avgTotal: 0, avgAcc: 0, avgFlu: 0, avgPro: 0 };
  const count = data.length;
  const avg = (key) => (data.reduce((s, r) => s + (r[key] || 0), 0) / count).toFixed(1);
  return {
    count,
    avgTotal: avg('score_total'),
    avgAcc: avg('score_accuracy'),
    avgFlu: avg('score_fluency'),
    avgPro: avg('score_prosodic'),
  };
}
