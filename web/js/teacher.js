import { supabase } from './supabase.js';

// =========================================================
// TEACHER MODULE
// =========================================================

/**
 * Lấy danh sách học viên của teacher
 */
export async function fetchMyStudents(teacherId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, email, phone, voice_enrolled, voice_embeddings, created_at')
    .eq('role', 'student')
    .eq('teacher_id', teacherId)
    .order('full_name');
  if (error) throw error;
  return data;
}

/**
 * Lấy thống kê tổng quan cho teacher
 */
export async function fetchTeacherStats(teacherId) {
  const [studentsRes, assessmentsRes] = await Promise.all([
    supabase.from('profiles').select('id', { count: 'exact' }).eq('teacher_id', teacherId),
    supabase.from('assessments').select('id, score_total, saved', { count: 'exact' }).eq('teacher_id', teacherId).eq('saved', true),
  ]);
  const studentCount = studentsRes.count || 0;
  const savedAssessments = assessmentsRes.data || [];
  const assessmentCount = savedAssessments.length;
  const avgScore = assessmentCount
    ? (savedAssessments.reduce((a, b) => a + (b.score_total || 0), 0) / assessmentCount).toFixed(1)
    : 0;
  return { studentCount, assessmentCount, avgScore };
}

/**
 * Tạo assessment mới
 */
export async function createAssessment(teacherId, studentId, audioUrl, scoreTeacher) {
  const { data, error } = await supabase
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
  return data;
}

/**
 * Upload audio hội thoại lên storage
 */
export async function uploadConversationAudio(teacherId, file) {
  const ext = file.name.split('.').pop();
  const path = `conversations/${teacherId}/${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from('speakai-audio').upload(path, file, { upsert: false });
  if (error) throw error;
  const { data: urlData } = supabase.storage.from('speakai-audio').getPublicUrl(path);
  return urlData.publicUrl;
}

export async function uploadAudioUrlToSupabase(teacherId, url, suffix) {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error("Failed to fetch audio from " + url);
    const blob = await response.blob();
    const ext = url.split('.').pop().split('?')[0] || 'wav';
    const path = `conversations/${teacherId}/extracted_${Date.now()}_${suffix}.${ext}`;
    const { error } = await supabase.storage.from('speakai-audio').upload(path, blob, { upsert: false });
    if (error) throw error;
    const { data: urlData } = supabase.storage.from('speakai-audio').getPublicUrl(path);
    return urlData.publicUrl;
  } catch (err) {
    console.error("Lỗi upload url:", url, err);
    return url;
  }
}


/**
 * Lưu kết quả assessment (save)
 */
export async function saveAssessment(assessmentId, resultData) {
    const finalJson = resultData.result_json || {};
    finalJson.title = resultData.title;

    const { error } = await supabase
    .from('assessments')
    .update({
      saved: true,
      status: 'done',
      score_total: resultData.score_total,
      score_accuracy: resultData.score_accuracy,
      score_fluency: resultData.score_fluency,
      score_prosodic: resultData.score_prosodic,
      llm_feedback: resultData.llm_feedback,
      result_json: finalJson,
    })
    .eq('id', assessmentId);
  if (error) throw error;
}

/**
 * Lấy danh sách assessments đã lưu của teacher
 */
export async function fetchSavedAssessments(teacherId) {
  const { data, error } = await supabase
    .from('assessments')
    .select(`
      id, created_at, score_total, score_accuracy, score_fluency, score_prosodic, llm_feedback, status, result_json,
      student:profiles!student_id(full_name, email)
    `)
    .eq('teacher_id', teacherId)
    .eq('saved', true)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

/**
 * Xóa assessment
 */
export async function deleteAssessment(assessmentId) {
  const { error } = await supabase
    .from('assessments')
    .delete()
    .eq('id', assessmentId);
  if (error) throw error;
}
