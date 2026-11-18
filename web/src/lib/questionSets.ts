import {
  extractRelatedCount,
  getRangeForPage,
  sanitizePostgrestFilterTerm,
  type PaginatedResult,
} from './pagination';
import { getSupabaseClient } from './supabase';
import type {
  ExamType,
  PracticeSession,
  Question,
  QuestionLevel,
  QuestionSet,
  SignupTeacher,
  TaskType,
} from './types';

export interface TaskTypeMeta {
  id: TaskType;
  label: string;
  title: string;
  includes: string;
  badgeClass: string;
  defaultPrep: number;
  defaultResponse: number;
}

export const TASK_TYPES: Record<TaskType, TaskTypeMeta> = {
  read_aloud: {
    id: 'read_aloud',
    label: 'Read Aloud',
    title: 'Đọc to đoạn văn',
    includes: 'Read Aloud',
    badgeClass: 'badge-task-read_aloud',
    defaultPrep: 45,
    defaultResponse: 45,
  },
  picture_description: {
    id: 'picture_description',
    label: 'Picture Description',
    title: 'Miêu tả tranh / hình ảnh',
    includes: 'Picture Description',
    badgeClass: 'badge-task-picture_description',
    defaultPrep: 45,
    defaultResponse: 45,
  },
  short_qa: {
    id: 'short_qa',
    label: 'Personal Q&A',
    title: 'Hỏi đáp cá nhân & thói quen',
    includes: 'Personal Q&A, preference, frequency, routine',
    badgeClass: 'badge-task-short_qa',
    defaultPrep: 15,
    defaultResponse: 30,
  },
  information_qa: {
    id: 'information_qa',
    label: 'Information-based Q&A',
    title: 'Hỏi đáp theo thông tin cho sẵn',
    includes: 'Information-based Q&A',
    badgeClass: 'badge-task-information_qa',
    defaultPrep: 30,
    defaultResponse: 30,
  },
  description: {
    id: 'description',
    label: 'Description',
    title: 'Miêu tả chi tiết đối tượng',
    includes: 'Person, place, object, event, activity',
    badgeClass: 'badge-task-description',
    defaultPrep: 30,
    defaultResponse: 45,
  },
  experience_future: {
    id: 'experience_future',
    label: 'Experience & Future',
    title: 'Trải nghiệm & Kế hoạch tương lai',
    includes: 'Experience, future plan, prediction',
    badgeClass: 'badge-task-experience_future',
    defaultPrep: 30,
    defaultResponse: 45,
  },
  opinion: {
    id: 'opinion',
    label: 'Opinion & Argument',
    title: 'Bày tỏ quan điểm & Lập luận',
    includes: 'Opinion, agree/disagree, reason, comparison, advantages/disadvantages',
    badgeClass: 'badge-task-opinion',
    defaultPrep: 45,
    defaultResponse: 60,
  },
  problem_solution: {
    id: 'problem_solution',
    label: 'Problem & Solution',
    title: 'Vấn đề & Đề xuất giải pháp',
    includes: 'Problem, solution, recommendation, choice',
    badgeClass: 'badge-task-problem_solution',
    defaultPrep: 45,
    defaultResponse: 60,
  },
  long_turn: {
    id: 'long_turn',
    label: 'Long Turn / Cue Card',
    title: 'Trình bày chủ đề dài 1-2 phút',
    includes: 'Long Turn, Cue Card, Topic Development',
    badgeClass: 'badge-task-long_turn',
    defaultPrep: 60,
    defaultResponse: 120,
  },
  discussion: {
    id: 'discussion',
    label: 'Discussion',
    title: 'Thảo luận chuyên sâu & Trừu tượng',
    includes: 'Abstract Discussion, cause/effect, speculation, evaluation, follow-up',
    badgeClass: 'badge-task-discussion',
    defaultPrep: 15,
    defaultResponse: 60,
  },
};

export const EXAM_TASK_MATRIX: Record<
  ExamType,
  { name: string; primary: TaskType[] }
> = {
  toeic: {
    name: 'TOEIC Speaking',
    primary: ['read_aloud', 'picture_description', 'short_qa', 'information_qa', 'opinion'],
  },
  vstep: {
    name: 'VSTEP Speaking',
    primary: [
      'short_qa',
      'description',
      'experience_future',
      'problem_solution',
      'long_turn',
      'opinion',
      'discussion',
    ],
  },
  ielts: {
    name: 'IELTS Speaking',
    primary: [
      'short_qa',
      'description',
      'experience_future',
      'long_turn',
      'discussion',
      'opinion',
      'problem_solution',
    ],
  },
  general: {
    name: 'Luyện tập chung',
    primary: [
      'read_aloud',
      'picture_description',
      'short_qa',
      'information_qa',
      'description',
      'experience_future',
      'opinion',
      'problem_solution',
      'long_turn',
      'discussion',
    ],
  },
};

export function getAvailableTaskTypes(examType: string = 'general'): TaskTypeMeta[] {
  const norm = ((examType || 'general').toLowerCase() as ExamType);
  const rule = EXAM_TASK_MATRIX[norm] || EXAM_TASK_MATRIX.general;
  return rule.primary.map((id) => TASK_TYPES[id]).filter(Boolean);
}

function encodeMetaHint(taskType: string, originalHint?: string | null): string {
  return `__META__:${JSON.stringify({ task_type: taskType, hint: originalHint || null })}`;
}

function decodeMetaHint(hintValue?: string | null): { task_type: TaskType | null; hint: string | null } {
  if (hintValue && typeof hintValue === 'string' && hintValue.startsWith('__META__:')) {
    try {
      const parsed = JSON.parse(hintValue.slice(9)) as { task_type?: TaskType; hint?: string | null };
      return {
        task_type: parsed.task_type || null,
        hint: parsed.hint || null,
      };
    } catch {
      // ignore parse errors
    }
  }
  return { task_type: null, hint: hintValue || null };
}

export async function fetchQuestionSetsPage({
  currentUserId,
  scope = 'mine',
  page = 1,
  pageSize = 9,
  search = '',
  level = '',
  publishFilter = '',
}: {
  currentUserId: string;
  scope?: 'mine' | 'others';
  page?: number;
  pageSize?: number;
  search?: string;
  level?: string;
  publishFilter?: '' | 'published' | 'draft';
}): Promise<PaginatedResult<QuestionSet>> {
  const client = getSupabaseClient();
  const { from, to, safePage, safeSize } = getRangeForPage(page, pageSize);
  const term = sanitizePostgrestFilterTerm(search);

  let matchingTeacherIds: string[] = [];
  if (term && scope === 'others') {
    try {
      const { data: teachersData } = await client.rpc('get_signup_teachers');
      const lowered = term.toLowerCase();
      matchingTeacherIds = ((teachersData as SignupTeacher[]) || [])
        .filter((t) => t.id !== currentUserId && (t.full_name || '').toLowerCase().includes(lowered))
        .map((t) => t.id)
        .slice(0, 50);
    } catch {
      matchingTeacherIds = [];
    }
  }

  const executeQuery = async (withAllowedColumn: boolean, useCountRel: boolean) => {
    const countRel = useCountRel ? 'questions(count)' : 'questions(id)';
    const cols = withAllowedColumn
      ? `
        id, teacher_id, title, description, level, exam_type, time_limit, is_published, created_at,
        allowed_teacher_ids,
        creator:profiles!teacher_id(id, full_name, email),
        ${countRel}
      `
      : `
        id, teacher_id, title, description, level, exam_type, time_limit, is_published, created_at,
        creator:profiles!teacher_id(id, full_name, email),
        ${countRel}
      `;

    let query = client
      .from('question_sets')
      .select(cols, { count: 'exact' })
      .order('created_at', { ascending: false });

    if (scope === 'mine') {
      query = query.eq('teacher_id', currentUserId);
      if (publishFilter === 'published') query = query.eq('is_published', true);
      if (publishFilter === 'draft') query = query.eq('is_published', false);
    } else {
      query = query.neq('teacher_id', currentUserId).eq('is_published', true);
    }

    if (level) query = query.eq('level', level);

    if (term) {
      const clauses = [`title.ilike.%${term}%`, `description.ilike.%${term}%`];
      if (matchingTeacherIds.length > 0) {
        clauses.push(`teacher_id.in.(${matchingTeacherIds.join(',')})`);
      }
      query = query.or(clauses.join(','));
    }

    return query.range(from, to);
  };

  let res = await executeQuery(true, true);
  if (res.error) {
    const msg = res.error.message || '';
    if (msg.includes('allowed_teacher_ids')) {
      res = await executeQuery(false, true);
      if (res.error) {
        res = await executeQuery(false, false);
      }
    } else {
      res = await executeQuery(true, false);
      if (res.error && res.error.message?.includes('allowed_teacher_ids')) {
        res = await executeQuery(false, false);
      }
    }
  }

  if (res.error) throw res.error;

  const items = ((res.data as unknown as QuestionSet[]) || []).map((qs) => ({
    ...qs,
    allowed_teacher_ids: Array.isArray(qs.allowed_teacher_ids) ? qs.allowed_teacher_ids : [],
    exam_type: (qs.exam_type || 'general') as ExamType,
    time_limit: qs.time_limit || 0,
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

export async function fetchSetSubmissionsPage(
  setId: string,
  { page = 1, pageSize = 8 }: { page?: number; pageSize?: number } = {},
): Promise<PaginatedResult<PracticeSession>> {
  const client = getSupabaseClient();
  const { from, to, safePage, safeSize } = getRangeForPage(page, pageSize);

  const { data, count, error } = await client
    .from('practice_sessions')
    .select(
      `
      id, student_id, set_id, mode, status, score_total, score_accuracy, score_fluency, score_prosodic, score_grammar, score_context, score_lexical, exam_band, teacher_comment, started_at, completed_at,
      student:profiles!student_id(id, full_name, email),
      question_set:question_sets(id, title, level, exam_type)
    `,
      { count: 'exact' },
    )
    .eq('set_id', setId)
    .in('status', ['completed', 'reviewed'])
    .order('completed_at', { ascending: false, nullsFirst: false })
    .range(from, to);

  if (error) throw error;
  return {
    items: (data as unknown as PracticeSession[]) || [],
    total: count || 0,
    page: safePage,
    pageSize: safeSize,
  };
}

export async function createQuestionSet(
  teacherId: string,
  {
    title,
    description,
    level,
    exam_type,
    time_limit,
  }: {
    title: string;
    description?: string;
    level?: QuestionLevel;
    exam_type?: ExamType;
    time_limit?: number;
  },
): Promise<QuestionSet> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('question_sets')
    .insert({
      teacher_id: teacherId,
      title,
      description: description || '',
      level: level || 'intermediate',
      exam_type: exam_type || 'general',
      time_limit: time_limit ? Number(time_limit) : 0,
      allowed_teacher_ids: [],
    })
    .select()
    .single();
  if (error) throw error;
  return data as QuestionSet;
}

export async function updateQuestionSet(setId: string, updates: Partial<QuestionSet>): Promise<void> {
  const client = getSupabaseClient();
  const rest = { ...updates };
  delete rest.teacher_id;
  delete rest.id;
  delete rest.created_at;
  delete rest.creator;
  delete rest.questions;
  const { error } = await client.from('question_sets').update(rest).eq('id', setId);
  if (error) throw error;
}

export async function cloneQuestionSet(sourceSetId: string): Promise<string> {
  const client = getSupabaseClient();
  const { data, error } = await client.rpc('clone_question_set', {
    p_source_set_id: sourceSetId,
  });
  if (error) throw error;
  return String(data);
}

export async function deleteQuestionSet(setId: string): Promise<void> {
  const client = getSupabaseClient();
  const { error } = await client.from('question_sets').delete().eq('id', setId);
  if (error) throw error;
}

export async function togglePublishSet(
  setId: string,
  isPublished: boolean,
): Promise<{ id: string; is_published: boolean }> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('question_sets')
    .update({ is_published: isPublished })
    .eq('id', setId)
    .select('id, is_published')
    .maybeSingle();

  if (error) {
    const { error: fallbackErr } = await client
      .from('question_sets')
      .update({ is_published: isPublished })
      .eq('id', setId);
    if (fallbackErr) throw fallbackErr;
    return { id: setId, is_published: isPublished };
  }
  return (data as { id: string; is_published: boolean }) || { id: setId, is_published: isPublished };
}

export async function fetchQuestions(setId: string): Promise<Question[]> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('questions')
    .select('*')
    .eq('set_id', setId)
    .order('order_num', { ascending: true });
  if (error) throw error;

  return ((data as Question[]) || []).map((q) => {
    const meta = decodeMetaHint(q.hint);
    return {
      ...q,
      task_type: (q.task_type || meta.task_type || 'short_qa') as TaskType,
      hint: meta.hint !== null ? meta.hint : q.hint && !q.hint.startsWith('__META__:') ? q.hint : null,
      image_url: q.image_url || null,
      reference_text: q.reference_text || null,
      prep_time: q.prep_time ?? 15,
      response_time: q.response_time ?? 45,
    };
  });
}

export async function addQuestion(
  setId: string,
  {
    question_text,
    order_num,
    part_title,
    prep_time,
    response_time,
    task_type,
    image_url,
    reference_text,
    hint,
  }: {
    question_text: string;
    order_num?: number;
    part_title?: string | null;
    prep_time?: number;
    response_time?: number;
    task_type?: TaskType;
    image_url?: string | null;
    reference_text?: string | null;
    hint?: string | null;
  },
): Promise<Question> {
  const client = getSupabaseClient();
  const tType: TaskType = task_type || 'short_qa';
  const payload: Record<string, unknown> = {
    set_id: setId,
    question_text,
    reference_text: reference_text || null,
    image_url: image_url || null,
    hint: encodeMetaHint(tType, hint),
    order_num: order_num || 1,
    part_title: part_title || null,
    prep_time: prep_time ?? 15,
    response_time: response_time ?? 45,
    task_type: tType,
  };

  const { data, error } = await client.from('questions').insert(payload).select().single();
  if (!error) return { ...(data as Question), task_type: (data as Question).task_type || tType, hint: hint || null };

  if (error.message?.includes('image_url') || error.message?.includes('task_type')) {
    if (error.message.includes('image_url')) delete payload.image_url;
    if (error.message.includes('task_type')) delete payload.task_type;
    const { data: retryData, error: retryErr } = await client.from('questions').insert(payload).select().single();
    if (retryErr) throw retryErr;
    return {
      ...(retryData as Question),
      task_type: tType,
      image_url: image_url || null,
      hint: hint || null,
    };
  }
  throw error;
}

export async function updateQuestion(questionId: string, updates: Partial<Question>): Promise<void> {
  const client = getSupabaseClient();
  const safeUpdates: Record<string, unknown> = { ...updates };
  if (updates.task_type) {
    safeUpdates.hint = encodeMetaHint(updates.task_type, updates.hint);
  }
  const { error } = await client.from('questions').update(safeUpdates).eq('id', questionId);
  if (!error) return;
  if (error.message?.includes('image_url') || error.message?.includes('task_type')) {
    if (error.message.includes('image_url')) delete safeUpdates.image_url;
    if (error.message.includes('task_type')) delete safeUpdates.task_type;
    const { error: retryErr } = await client.from('questions').update(safeUpdates).eq('id', questionId);
    if (retryErr) throw retryErr;
    return;
  }
  throw error;
}

export async function deleteQuestion(questionId: string): Promise<void> {
  const client = getSupabaseClient();
  const { error } = await client.from('questions').delete().eq('id', questionId);
  if (error) throw error;
}

export async function compressImageFile(
  file: File,
  maxDimension = 1280,
  quality = 0.85,
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) {
      reject(new Error('Tệp tải lên không phải là hình ảnh hợp lệ!'));
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let width = img.naturalWidth || img.width;
        let height = img.naturalHeight || img.height;
        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Không thể khởi tạo canvas xử lý ảnh!'));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => reject(new Error('Không thể đọc dữ liệu hình ảnh!'));
      img.src = String(e.target?.result || '');
    };
    reader.onerror = () => reject(new Error('Lỗi khi đọc file ảnh!'));
    reader.readAsDataURL(file);
  });
}
