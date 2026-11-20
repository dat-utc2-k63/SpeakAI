export type UserRole = 'admin' | 'teacher' | 'student';
export type AccountStatus = 'active' | 'pending' | 'suspended';
export type ExamType = 'general' | 'toeic' | 'vstep' | 'ielts';
export type QuestionLevel = 'beginner' | 'intermediate' | 'advanced';
export type SessionMode = 'practice' | 'exam';
export type SessionStatus = 'in_progress' | 'completed' | 'reviewed';

export type TaskType =
  | 'read_aloud'
  | 'picture_description'
  | 'short_qa'
  | 'information_qa'
  | 'description'
  | 'experience_future'
  | 'opinion'
  | 'problem_solution'
  | 'long_turn'
  | 'discussion';

export interface Profile {
  id: string;
  role: UserRole;
  status: AccountStatus;
  full_name: string;
  email: string;
  phone?: string | null;
  teacher_id?: string | null;
  voice_enrolled?: boolean;
  voice_sample_url?: string | null;
  voice_embeddings?: number[] | number[][] | string | null;
  student_code?: string | null;
  date_of_birth?: string | null;
  entry_level?: QuestionLevel | null;
  target_band?: number | null;
  guardian_name?: string | null;
  guardian_phone?: string | null;
  enrolled_at?: string | null;
  enrollment_note?: string | null;
  created_at: string;
}

export interface SignupTeacher {
  id: string;
  full_name: string;
}

export interface PublicRuntimeConfig {
  api_url?: string | null;
  llm_api_url?: string | null;
  llm_model?: string | null;
}

export interface QuestionSet {
  id: string;
  teacher_id: string;
  title: string;
  description?: string | null;
  level: QuestionLevel;
  exam_type: ExamType;
  time_limit?: number;
  is_published: boolean;
  allowed_teacher_ids?: string[];
  created_at: string;
  creator?: { id?: string; full_name?: string; email?: string } | null;
  creator_name?: string;
  creator_email?: string;
  teacher?: { full_name?: string } | null;
  teacher_name?: string;
  questions?: Question[];
  question_count?: number;
}

export interface Question {
  id: string;
  set_id: string;
  question_text: string;
  reference_text?: string | null;
  image_url?: string | null;
  hint?: string | null;
  order_num: number;
  part_title?: string | null;
  prep_time: number;
  response_time: number;
  task_type: TaskType;
}

export interface PronunciationScores {
  total: number;
  accuracy: number;
  fluency: number;
  prosodic: number;
  grammar?: number | null;
  context?: number | null;
  lexical?: number | null;
  overall?: number | null;
  p?: number | null;
  fc?: number | null;
  lr?: number | null;
  gra?: number | null;
  score_pronunciation?: number | null;
  score_fluency_coherence?: number | null;
  score_lexical?: number | null;
  score_grammar?: number | null;
  score_total?: number | null;
}

export interface GrammarErrorItem {
  turn_index?: number;
  error_text: string;
  fix: string;
  explanation?: string;
}

export interface AiEvalResult {
  score_total: number;
  score_pronunciation?: number;
  score_fluency_coherence?: number | null;
  score_lexical?: number | null;
  score_grammar?: number | null;
  score_context?: number | null;
  relevance_level?: 'too_short' | 'irrelevant' | 'partially_relevant' | 'relevant' | 'excellent' | string;
  grammar_errors: GrammarErrorItem[];
  feedback_summary?: string;
  conversation_summary?: string;
  better_expression?: string;
  communication_tips?: string[];
  better_dialogue_expressions?: string[];
  is_fallback?: boolean;
  fallback_reason?: string;
  model_used?: string;
}

export interface PhonemeErrorItem {
  phoneme?: string;
  word?: string;
  target_ipa?: string;
  actual_ipa?: string;
  rule_name_vi?: string;
  articulatory_tip?: string;
  tip?: string;
  is_suspicious?: boolean;
  error_probability?: number;
  severity?: string;
}

export interface WordDetailItem {
  word: string;
  word_ipa?: string;
  status?: 'good' | 'warning' | 'bad';
}

export interface DialogueTurn {
  role: 'teacher' | 'student';
  speaker?: string;
  scored?: boolean;
  eligibility_reason?: string;
  transcript?: string;
  audio?: string | null;
  scores?: PronunciationScores;
  errors?: {
    phonemes?: PhonemeErrorItem[];
  };
  words_detail?: WordDetailItem[];
}

export interface AssessmentResultJson {
  title?: string;
  student?: {
    transcript?: string;
    full_audio?: string;
    scores?: PronunciationScores;
    message?: string;
    sentences?: Array<{
      transcript?: string;
      audio?: string;
      scores?: PronunciationScores;
    }>;
  };
  teacher?: {
    transcript?: string;
    scored?: boolean;
    scores?: PronunciationScores;
    full_audio?: string;
    sentences?: Array<{
      transcript?: string;
      audio?: string;
      scores?: PronunciationScores;
    }>;
  };
  dialogue?: {
    turns?: DialogueTurn[];
  };
  turns?: DialogueTurn[];
  overall_transformer_feedback?: {
    summary?: string;
    tips?: string[];
  };
  ai_eval?: AiEvalResult | null;
  llm_eval?: AiEvalResult | null;
  llm_feedback?: string | null;
  score_total?: number;
  score_accuracy?: number;
  score_fluency?: number;
  score_prosodic?: number;
  score_grammar?: number | null;
  score_context?: number | null;
  score_lexical?: number | null;
}

export interface Assessment {
  id: string;
  teacher_id: string;
  student_id: string;
  class_id?: string | null;
  lesson_id?: string | null;
  audio_url?: string | null;
  score_total?: number | null;
  score_accuracy?: number | null;
  score_fluency?: number | null;
  score_prosodic?: number | null;
  score_grammar?: number | null;
  score_context?: number | null;
  score_lexical?: number | null;
  llm_feedback?: string | null;
  teacher_note?: string | null;
  status: string;
  saved: boolean;
  result_json?: AssessmentResultJson | null;
  created_at: string;
  student?: { id?: string; full_name?: string; email?: string } | null;
  teacher?: { id?: string; full_name?: string; email?: string } | null;
  class_info?: { id?: string; name?: string; code?: string } | null;
}

export interface PracticeAnswerRecord {
  id?: string;
  question_id: string;
  audio_url?: string | null;
  transcript?: string | null;
  score_total?: number | null;
  score_accuracy?: number | null;
  score_fluency?: number | null;
  score_prosodic?: number | null;
  score_grammar?: number | null;
  score_context?: number | null;
  score_lexical?: number | null;
  result_json?: AssessmentResultJson | null;
  created_at?: string;
  question?: {
    id?: string;
    order_num?: number;
    part_title?: string | null;
    question_text?: string;
    prep_time?: number;
    response_time?: number;
  } | null;
}

export interface PracticeSession {
  id: string;
  student_id?: string;
  set_id?: string;
  assignment_id?: string | null;
  class_id?: string | null;
  is_late?: boolean;
  mode: SessionMode;
  status: SessionStatus;
  score_total?: number | null;
  score_accuracy?: number | null;
  score_fluency?: number | null;
  score_prosodic?: number | null;
  score_grammar?: number | null;
  score_context?: number | null;
  score_lexical?: number | null;
  exam_band?: string | null;
  teacher_comment?: string | null;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  started_at: string;
  completed_at?: string | null;
  question_set?: {
    id?: string;
    title?: string;
    level?: QuestionLevel;
    exam_type?: ExamType;
    description?: string | null;
  } | null;
  assignment?: {
    id?: string;
    title?: string;
    due_at?: string | null;
    max_attempts?: number;
  } | null;
  class_info?: {
    id?: string;
    name?: string;
    code?: string;
  } | null;
  student?: {
    id?: string;
    full_name?: string;
    email?: string;
  } | null;
  practice_answers?: PracticeAnswerRecord[];
  answers?: PracticeAnswerRecord[];
}

export interface ClassroomSegment {
  index: number;
  start_sec: number;
  end_sec: number;
  duration_sec: number;
  language: 'en' | 'vi' | 'unknown' | string;
  word_count?: number;
  total_words?: number;
  vi_percent?: number;
  transcript: string;
}

export interface ClassroomAnalysisResult {
  duration?: {
    total_audio_sec?: number;
    total_speech_sec?: number;
    en_speech_sec?: number;
    vi_speech_sec?: number;
    unknown_speech_sec?: number;
    silence_sec?: number;
    speech_ratio_percent?: number;
  };
  overall?: {
    en_percent?: number;
    vi_percent?: number;
    unknown_percent?: number;
    en_time_percent?: number;
    vi_time_percent?: number;
    unknown_time_percent?: number;
    en_words?: number;
    vi_words?: number;
    unknown_words?: number;
    total_words?: number;
  };
  timeline?: ClassroomSegment[];
}

export interface GpuHealthData {
  status?: string;
  uptime_human?: string;
  uptime_sec?: number;
  tasks_active?: number;
  gpu_queue_waiting?: number;
  tasks_completed?: number;
  gpu?: {
    available?: boolean;
    device_name?: string;
    memory_allocated_mb?: number;
    memory_total_mb?: number;
  };
}

/* ── CLASSROOM MANAGEMENT v5.0 TYPES ─────────────────────── */
export type ClassStatus = 'active' | 'completed' | 'archived';
export type ClassMemberRole = 'lead_teacher' | 'assistant' | 'student';
export type ClassMemberStatus = 'active' | 'completed' | 'dropped';
export type LessonStatus = 'planned' | 'completed' | 'cancelled';
export type AttendanceStatus = 'present' | 'absent' | 'late' | 'excused';

export interface ClassRecord {
  id: string;
  name: string;
  code: string;
  description?: string | null;
  course_type: ExamType;
  target_band?: number | null;
  schedule_text?: string | null;
  status: ClassStatus;
  start_date?: string | null;
  end_date?: string | null;
  created_by?: string | null;
  created_at: string;
  // Computed client summaries
  student_count?: number;
  teacher_names?: string[];
  my_member_role?: ClassMemberRole;
  pending_review_count?: number;
  avg_band?: number | null;
  avg_en_percent?: number | null;
  assignment_count?: number;
}

export interface ClassMemberRecord {
  id: string;
  class_id: string;
  user_id: string;
  member_role: ClassMemberRole;
  status: ClassMemberStatus;
  joined_at: string;
  profile?: Profile | null;
}

export interface ClassTeacherBasic {
  user_id: string;
  full_name: string;
  email: string;
  member_role: 'lead_teacher' | 'assistant';
}

export interface LessonRecord {
  id: string;
  class_id: string;
  lesson_no: number;
  title: string;
  scheduled_at?: string | null;
  summary_notes?: string | null;
  status: LessonStatus;
  created_by?: string | null;
  created_at: string;
}

export interface LessonAttendanceRecord {
  id: string;
  lesson_id: string;
  student_id: string;
  status: AttendanceStatus;
  note?: string | null;
  marked_by?: string | null;
  updated_at: string;
}

export interface AssignmentRecord {
  id: string;
  class_id: string;
  lesson_id?: string | null;
  set_id: string;
  title: string;
  instructions?: string | null;
  mode: SessionMode;
  due_at?: string | null;
  max_attempts: number;
  min_band_target?: number | null;
  assigned_by?: string | null;
  created_at: string;
  question_set?: {
    id: string;
    title: string;
    level: QuestionLevel;
    exam_type: ExamType;
    is_published?: boolean;
  } | null;
  class_info?: {
    id: string;
    name: string;
    code: string;
    course_type?: ExamType;
  } | null;
  lesson?: {
    id: string;
    lesson_no: number;
    title: string;
  } | null;
  // Student-facing computed progress
  used_attempts?: number;
  best_score?: number | null;
  latest_session?: PracticeSession | null;
  has_late_submission?: boolean;
}

export interface ClassroomAnalysisRecord {
  id: string;
  class_id?: string | null;
  lesson_id?: string | null;
  teacher_id?: string | null;
  file_name: string;
  en_percent: number;
  vi_percent: number;
  en_time_percent?: number | null;
  vi_time_percent?: number | null;
  speech_ratio_percent?: number | null;
  total_audio_sec?: number | null;
  total_words?: number;
  result_json?: ClassroomAnalysisResult | null;
  created_at: string;
  class_info?: { id?: string; name?: string; code?: string } | null;
  lesson?: { id?: string; lesson_no?: number; title?: string } | null;
  teacher?: { id?: string; full_name?: string; email?: string } | null;
}

export interface AssignmentCellSummary {
  assignmentId: string;
  bestSessionId: string | null;
  bestScore: number | null;
  attemptsUsed: number;
  status: 'not_submitted' | 'pending_review' | 'reviewed';
  isLate: boolean;
}

export interface ClassStudentSummaryRow {
  student: Profile;
  memberStatus: ClassMemberStatus;
  attendancePresent: number;
  attendanceTotal: number;
  attendanceRate: number | null;
  assignmentsCompleted: number;
  assignmentsTotal: number;
  avgBand: number | null;
  avgP: number | null;
  avgFC: number | null;
  avgLR: number | null;
  avgGRA: number | null;
  cells: Record<string, AssignmentCellSummary>;
  isAtRisk: boolean;
  riskReasons: string[];
}


