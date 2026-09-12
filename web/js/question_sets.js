import { supabase } from './supabase.js';

// =========================================================
// QUESTION SETS MODULE — CRUD for Teacher's question sets
// Supports Exam Types: General, VSTEP, TOEIC, IELTS
// =========================================================

/**
 * Lấy danh sách bộ đề của teacher
 */
export async function fetchQuestionSets(teacherId = null) {
  let query = supabase
    .from('question_sets')
    .select(`
      id, teacher_id, title, description, level, exam_type, time_limit, is_published, created_at,
      creator:profiles!teacher_id(id, full_name, email),
      questions(id)
    `)
    .order('created_at', { ascending: false });

  if (teacherId) {
    query = query.eq('teacher_id', teacherId);
  }

  const { data, error } = await query;
  if (error) throw error;
  // Attach question count and creator info
  return (data || []).map(qs => ({
    ...qs,
    exam_type: qs.exam_type || 'general',
    time_limit: qs.time_limit || 0,
    creator_name: qs.creator?.full_name || 'Giáo viên',
    creator_email: qs.creator?.email || '',
    question_count: qs.questions ? qs.questions.length : 0,
  }));
}

/**
 * Tạo bộ đề mới
 */
export async function createQuestionSet(teacherId, { title, description, level, exam_type, time_limit }) {
  const { data, error } = await supabase
    .from('question_sets')
    .insert({
      teacher_id: teacherId,
      title,
      description,
      level: level || 'intermediate',
      exam_type: exam_type || 'general',
      time_limit: time_limit ? parseInt(time_limit) : 0,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Cập nhật bộ đề (bảo toàn người tạo gốc teacher_id)
 */
export async function updateQuestionSet(setId, updates) {
  // Loại bỏ teacher_id nếu có để luôn giữ nguyên người tạo ban đầu
  const { teacher_id, id, created_at, ...safeUpdates } = updates;
  const { error } = await supabase
    .from('question_sets')
    .update(safeUpdates)
    .eq('id', setId);
  if (error) throw error;
}

/**
 * Xóa bộ đề (cascade xóa câu hỏi)
 */
export async function deleteQuestionSet(setId) {
  const { error } = await supabase
    .from('question_sets')
    .delete()
    .eq('id', setId);
  if (error) throw error;
}

/**
 * Toggle publish/unpublish bộ đề
 */
export async function togglePublishSet(setId, isPublished) {
  const { error } = await supabase
    .from('question_sets')
    .update({ is_published: isPublished })
    .eq('id', setId);
  if (error) throw error;
}

/**
 * Lấy danh sách câu hỏi trong bộ đề
 */
export async function fetchQuestions(setId) {
  const { data, error } = await supabase
    .from('questions')
    .select('*')
    .eq('set_id', setId)
    .order('order_num', { ascending: true });
  if (error) throw error;
  return (data || []).map(q => ({
    ...q,
    prep_time: q.prep_time !== undefined && q.prep_time !== null ? q.prep_time : 15,
    response_time: q.response_time !== undefined && q.response_time !== null ? q.response_time : 45,
  }));
}

/**
 * Thêm câu hỏi mới vào bộ đề
 */
export async function addQuestion(setId, { question_text, order_num, part_title, prep_time, response_time }) {
  const { data, error } = await supabase
    .from('questions')
    .insert({
      set_id: setId,
      question_text,
      reference_text: null,
      hint: null,
      order_num: order_num || 1,
      part_title: part_title || null,
      prep_time: prep_time !== undefined ? parseInt(prep_time) : 15,
      response_time: response_time !== undefined ? parseInt(response_time) : 45,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Cập nhật câu hỏi
 */
export async function updateQuestion(questionId, updates) {
  const { error } = await supabase
    .from('questions')
    .update(updates)
    .eq('id', questionId);
  if (error) throw error;
}

/**
 * Xóa câu hỏi
 */
export async function deleteQuestion(questionId) {
  const { error } = await supabase
    .from('questions')
    .delete()
    .eq('id', questionId);
  if (error) throw error;
}

/**
 * Cập nhật thứ tự nhiều câu hỏi cùng lúc
 */
export async function reorderQuestions(questions) {
  for (const q of questions) {
    const { error } = await supabase
      .from('questions')
      .update({ order_num: q.order_num })
      .eq('id', q.id);
    if (error) throw error;
  }
}
