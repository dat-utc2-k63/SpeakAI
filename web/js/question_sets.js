import { supabase } from './supabase.js';

// =========================================================
// QUESTION SETS MODULE — CRUD for Teacher's question sets
// Supports Exam Types: General, VSTEP, TOEIC, IELTS
// =========================================================

/**
 * Lấy danh sách bộ đề của teacher
 */
export async function fetchQuestionSets(teacherId = null) {
  try {
    let query = supabase
      .from('question_sets')
      .select(`
        id, teacher_id, title, description, level, exam_type, time_limit, is_published, created_at,
        allowed_teacher_ids,
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
      allowed_teacher_ids: Array.isArray(qs.allowed_teacher_ids) ? qs.allowed_teacher_ids : [],
      exam_type: qs.exam_type || 'general',
      time_limit: qs.time_limit || 0,
      creator_name: qs.creator?.full_name || 'Giáo viên',
      creator_email: qs.creator?.email || '',
      question_count: qs.questions ? qs.questions.length : 0,
    }));
  } catch (err) {
    // Fallback nếu database Supabase chưa có cột allowed_teacher_ids
    if (err.message?.includes('allowed_teacher_ids') || err.code === '42703' || err.code === 'PGRST204') {
      console.warn('Cột allowed_teacher_ids chưa có trong DB Supabase, fallback query thông thường:', err.message);
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
      return (data || []).map(qs => ({
        ...qs,
        allowed_teacher_ids: [],
        exam_type: qs.exam_type || 'general',
        time_limit: qs.time_limit || 0,
        creator_name: qs.creator?.full_name || 'Giáo viên',
        creator_email: qs.creator?.email || '',
        question_count: qs.questions ? qs.questions.length : 0,
      }));
    }
    throw err;
  }
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
      allowed_teacher_ids: [],
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
 * Cập nhật danh sách giáo viên được cấp quyền sửa/xóa bộ đề
 */
export async function updateQuestionSetPermissions(setId, allowedTeacherIds = []) {
  try {
    const { error } = await supabase
      .from('question_sets')
      .update({ allowed_teacher_ids: allowedTeacherIds })
      .eq('id', setId);
    if (error) throw error;
  } catch (err) {
    if (err.message?.includes('allowed_teacher_ids') || err.code === '42703' || err.code === 'PGRST204') {
      throw new Error('Database Supabase chưa có cột allowed_teacher_ids. Vui lòng chạy lệnh SQL migration trong speak_web_schema.sql!');
    }
    throw err;
  }
}

/**
 * Lấy danh sách giáo viên & admin trong hệ thống để chọn phân quyền
 */
export async function fetchTeachersList(excludeUserId = null) {
  let query = supabase
    .from('profiles')
    .select('id, full_name, email, role')
    .in('role', ['teacher', 'admin'])
    .order('full_name');

  if (excludeUserId) {
    query = query.neq('id', excludeUserId);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
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
  const { data, error } = await supabase
    .from('question_sets')
    .update({ is_published: isPublished })
    .eq('id', setId)
    .select('id, is_published')
    .maybeSingle();

  if (error) {
    const { error: fallbackErr } = await supabase
      .from('question_sets')
      .update({ is_published: isPublished })
      .eq('id', setId);
    if (fallbackErr) throw fallbackErr;
    return { id: setId, is_published: isPublished };
  }
  return data || { id: setId, is_published: isPublished };
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

// =========================================================
// MA TRẬN PHÂN LOẠI DẠNG ĐỀ THEO KỲ THI (TOEIC, VSTEP, IELTS, GENERAL)
// =========================================================
export const EXAM_TASK_MATRIX = {
  toeic: {
    name: 'TOEIC Speaking',
    primary: ['read_aloud', 'picture_description', 'short_qa', 'information_qa', 'opinion'], // 5 phần thi chuẩn TOEIC
    supplementary: [],
    forbidden: ['description', 'experience_future', 'problem_solution', 'long_turn', 'discussion'],
  },
  vstep: {
    name: 'VSTEP Speaking',
    primary: ['short_qa', 'description', 'experience_future', 'problem_solution', 'long_turn', 'opinion', 'discussion'], // Chuẩn VSTEP Part 1, 2, 3
    supplementary: [],
    forbidden: ['read_aloud', 'picture_description', 'information_qa'],
  },
  ielts: {
    name: 'IELTS Speaking',
    primary: ['short_qa', 'description', 'experience_future', 'long_turn', 'discussion', 'opinion', 'problem_solution'], // Chuẩn IELTS Part 1, 2, 3
    supplementary: [],
    forbidden: ['read_aloud', 'picture_description', 'information_qa'],
  },
  general: {
    name: 'Luyện tập chung',
    primary: ['read_aloud', 'picture_description', 'short_qa', 'information_qa', 'description', 'experience_future', 'opinion', 'problem_solution', 'long_turn', 'discussion'],
    supplementary: [],
    forbidden: [],
  }
};

/**
 * Trả về danh sách dạng bài hợp lệ theo từng kỳ thi (Loại bỏ hoàn toàn định dạng phụ)
 */
export function getAvailableTaskTypes(examType = 'general') {
  const norm = (examType || 'general').toLowerCase();
  const rule = EXAM_TASK_MATRIX[norm] || EXAM_TASK_MATRIX.general;
  const list = [];

  for (const taskId of rule.primary) {
    const item = TASK_TYPES[taskId];
    if (item) {
      list.push({
        ...item,
        id: taskId,
        key: taskId,
        status: 'primary',
      });
    }
  }

  // Tương thích ngược nếu nơi nào vẫn truy cập .primary
  list.primary = list;
  list.supplementary = [];
  list.forbidden = rule.forbidden || [];
  return list;
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
    task_type: q.task_type || 'short_qa',
    image_url: q.image_url || null,
    reference_text: q.reference_text || null,
    prep_time: q.prep_time !== undefined && q.prep_time !== null ? q.prep_time : 15,
    response_time: q.response_time !== undefined && q.response_time !== null ? q.response_time : 45,
  }));
}

/**
 * Thêm câu hỏi mới vào bộ đề
 */
export async function addQuestion(setId, { question_text, order_num, part_title, prep_time, response_time, task_type, image_url, reference_text, hint }) {
  const payload = {
    set_id: setId,
    question_text,
    reference_text: reference_text || null,
    image_url: image_url || null,
    hint: hint || null,
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
    // Fallback nếu database Supabase chưa chạy migration cột task_type hoặc image_url
    if (error && (error.message?.includes('image_url') || error.message?.includes('task_type') || error.code === '42703' || error.code === 'PGRST204')) {
      console.warn('Cột image_url hoặc task_type chưa có trong DB Supabase, fallback:', error.message);
      if (error.message?.includes('image_url')) delete payload.image_url;
      if (error.message?.includes('task_type')) delete payload.task_type;
      const { data: retryData, error: retryError } = await supabase
        .from('questions')
        .insert(payload)
        .select()
        .single();
      if (retryError) throw retryError;
      return { ...retryData, task_type: task_type || 'short_qa', image_url: image_url || null };
    }
    throw error;
  } catch (err) {
    if (err.message?.includes('image_url') || err.message?.includes('task_type')) {
      delete payload.image_url;
      delete payload.task_type;
      const { data: retryData, error: retryError } = await supabase
        .from('questions')
        .insert(payload)
        .select()
        .single();
      if (retryError) throw retryError;
      return { ...retryData, task_type: task_type || 'short_qa', image_url: image_url || null };
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
    // Fallback nếu database Supabase chưa có cột task_type hoặc image_url
    if (error && (error.message?.includes('image_url') || error.message?.includes('task_type') || error.code === '42703' || error.code === 'PGRST204')) {
      const safeUpdates = { ...updates };
      if (error.message?.includes('image_url')) delete safeUpdates.image_url;
      if (error.message?.includes('task_type')) delete safeUpdates.task_type;
      const { error: retryErr } = await supabase
        .from('questions')
        .update(safeUpdates)
        .eq('id', questionId);
      if (retryErr) throw retryErr;
      return;
    }
    throw error;
  } catch (err) {
    if (err.message?.includes('image_url') || err.message?.includes('task_type')) {
      const safeUpdates = { ...updates };
      delete safeUpdates.image_url;
      delete safeUpdates.task_type;
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
