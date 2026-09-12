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

// =========================================================
// DANH SÁCH 10 DẠNG ĐỀ BÀI (TASK TYPES) NÓI TIẾNG ANH
// =========================================================
export const TASK_TYPES = {
  read_aloud: {
    id: 'read_aloud',
    label: 'Read Aloud',
    title: 'Đọc to đoạn văn',
    includes: 'Read Aloud',
    icon: 'bi-megaphone-fill',
    badgeClass: 'badge-task-read_aloud',
    defaultPrep: 45,
    defaultResponse: 45,
  },
  picture_description: {
    id: 'picture_description',
    label: 'Picture Description',
    title: 'Miêu tả tranh / hình ảnh',
    includes: 'Picture Description',
    icon: 'bi-image-fill',
    badgeClass: 'badge-task-picture_description',
    defaultPrep: 45,
    defaultResponse: 45,
  },
  short_qa: {
    id: 'short_qa',
    label: 'Personal Q&A',
    title: 'Hỏi đáp cá nhân & thói quen',
    includes: 'Personal Q&A, preference, frequency, routine',
    icon: 'bi-chat-dots-fill',
    badgeClass: 'badge-task-short_qa',
    defaultPrep: 15,
    defaultResponse: 30,
  },
  information_qa: {
    id: 'information_qa',
    label: 'Information-based Q&A',
    title: 'Hỏi đáp theo thông tin cho sẵn',
    includes: 'Information-based Q&A',
    icon: 'bi-info-circle-fill',
    badgeClass: 'badge-task-information_qa',
    defaultPrep: 30,
    defaultResponse: 30,
  },
  description: {
    id: 'description',
    label: 'Description',
    title: 'Miêu tả chi tiết đối tượng',
    includes: 'Person, place, object, event, activity',
    icon: 'bi-card-text',
    badgeClass: 'badge-task-description',
    defaultPrep: 30,
    defaultResponse: 45,
  },
  experience_future: {
    id: 'experience_future',
    label: 'Experience & Future',
    title: 'Trải nghiệm & Kế hoạch tương lai',
    includes: 'Experience, future plan, prediction',
    icon: 'bi-compass-fill',
    badgeClass: 'badge-task-experience_future',
    defaultPrep: 30,
    defaultResponse: 45,
  },
  opinion: {
    id: 'opinion',
    label: 'Opinion & Argument',
    title: 'Bày tỏ quan điểm & Lập luận',
    includes: 'Opinion, agree/disagree, reason, comparison, advantages/disadvantages',
    icon: 'bi-chat-left-quote-fill',
    badgeClass: 'badge-task-opinion',
    defaultPrep: 45,
    defaultResponse: 60,
  },
  problem_solution: {
    id: 'problem_solution',
    label: 'Problem & Solution',
    title: 'Vấn đề & Đề xuất giải pháp',
    includes: 'Problem, solution, recommendation, choice',
    icon: 'bi-lightbulb-fill',
    badgeClass: 'badge-task-problem_solution',
    defaultPrep: 45,
    defaultResponse: 60,
  },
  long_turn: {
    id: 'long_turn',
    label: 'Long Turn / Cue Card',
    title: 'Trình bày chủ đề dài 1-2 phút',
    includes: 'Long Turn, Cue Card, Topic Development',
    icon: 'bi-hourglass-split',
    badgeClass: 'badge-task-long_turn',
    defaultPrep: 60,
    defaultResponse: 120,
  },
  discussion: {
    id: 'discussion',
    label: 'Discussion',
    title: 'Thảo luận chuyên sâu & Trừu tượng',
    includes: 'Abstract Discussion, cause/effect, speculation, evaluation, individual vs society, follow-up',
    icon: 'bi-people-fill',
    badgeClass: 'badge-task-discussion',
    defaultPrep: 15,
    defaultResponse: 60,
  },
};

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
    task_type: q.task_type || 'short_qa',
    prep_time: q.prep_time !== undefined && q.prep_time !== null ? q.prep_time : 15,
    response_time: q.response_time !== undefined && q.response_time !== null ? q.response_time : 45,
  }));
}

/**
 * Thêm câu hỏi mới vào bộ đề
 */
export async function addQuestion(setId, { question_text, order_num, part_title, prep_time, response_time, task_type }) {
  const payload = {
    set_id: setId,
    question_text,
    reference_text: null,
    hint: null,
    order_num: order_num || 1,
    part_title: part_title || null,
    prep_time: prep_time !== undefined ? parseInt(prep_time) : 15,
    response_time: response_time !== undefined ? parseInt(response_time) : 45,
    task_type: task_type || 'short_qa',
  };

  try {
    const { data, error } = await supabase
      .from('questions')
      .insert(payload)
      .select()
      .single();
    if (!error) return data;
    // Fallback nếu database Supabase chưa chạy migration cột task_type
    if (error && (error.message?.includes('task_type') || error.code === '42703' || error.code === 'PGRST204')) {
      console.warn('Cột task_type chưa có trong DB Supabase, fallback bỏ task_type:', error.message);
      delete payload.task_type;
      const { data: retryData, error: retryError } = await supabase
        .from('questions')
        .insert(payload)
        .select()
        .single();
      if (retryError) throw retryError;
      return { ...retryData, task_type: task_type || 'short_qa' };
    }
    throw error;
  } catch (err) {
    if (err.message?.includes('task_type')) {
      delete payload.task_type;
      const { data: retryData, error: retryError } = await supabase
        .from('questions')
        .insert(payload)
        .select()
        .single();
      if (retryError) throw retryError;
      return { ...retryData, task_type: task_type || 'short_qa' };
    }
    throw err;
  }
}

/**
 * Cập nhật câu hỏi
 */
export async function updateQuestion(questionId, updates) {
  try {
    const { error } = await supabase
      .from('questions')
      .update(updates)
      .eq('id', questionId);
    if (!error) return;
    // Fallback nếu database Supabase chưa có cột task_type
    if (error && (error.message?.includes('task_type') || error.code === '42703' || error.code === 'PGRST204')) {
      const { task_type, ...safeUpdates } = updates;
      const { error: retryErr } = await supabase
        .from('questions')
        .update(safeUpdates)
        .eq('id', questionId);
      if (retryErr) throw retryErr;
      return;
    }
    throw error;
  } catch (err) {
    if (err.message?.includes('task_type')) {
      const { task_type, ...safeUpdates } = updates;
      const { error: retryErr } = await supabase
        .from('questions')
        .update(safeUpdates)
        .eq('id', questionId);
      if (retryErr) throw retryErr;
      return;
    }
    throw err;
  }
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
