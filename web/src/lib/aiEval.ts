import { getAccessToken, getPublicRuntimeConfig } from './auth';
import { APP_CONFIG } from './supabase';
import type { AiEvalResult, DialogueTurn, PronunciationScores } from './types';

export const DEFAULT_LLM_ENDPOINT = APP_CONFIG.DEFAULT_LLM_ENDPOINT || 'https://revidapi.com/v1/chat/completions';
export const DEFAULT_LLM_MODEL = APP_CONFIG.DEFAULT_LLM_MODEL || 'deepseek-v4.1-flash';

let cachedRuntimeUrls: {
  apiUrl: string;
  llmApiUrl: string;
  llmModel: string;
} = {
  apiUrl: APP_CONFIG.SPEAKAI_API_URL || '',
  llmApiUrl: DEFAULT_LLM_ENDPOINT,
  llmModel: DEFAULT_LLM_MODEL,
};

let runtimePromise: Promise<void> | null = null;

export async function syncLlmConfigFromSupabase(force = false): Promise<{
  apiUrl: string;
  llmApiUrl: string;
  llmModel: string;
}> {
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem('speakai_llm_key');
  }
  if (!force && cachedRuntimeUrls.llmApiUrl && cachedRuntimeUrls.llmModel && !runtimePromise) {
    if (cachedRuntimeUrls.apiUrl) return cachedRuntimeUrls;
  }
  if (!runtimePromise || force) {
    runtimePromise = (async () => {
      try {
        const data = await getPublicRuntimeConfig();
        if (data) {
          const endpoint = (
            data.llm_api_url ||
            cachedRuntimeUrls.llmApiUrl ||
            DEFAULT_LLM_ENDPOINT
          ).trim();
          const model = (
            data.llm_model ||
            cachedRuntimeUrls.llmModel ||
            DEFAULT_LLM_MODEL
          ).trim();
          cachedRuntimeUrls = {
            apiUrl: (data.api_url || cachedRuntimeUrls.apiUrl || '').trim().replace(/\/+$/, ''),
            llmApiUrl: endpoint,
            llmModel: model,
          };
        }
      } catch (err) {
        console.warn('Lỗi lấy cấu hình AI Evaluator từ Supabase:', err);
      } finally {
        runtimePromise = null;
      }
    })();
  }
  await runtimePromise;
  return cachedRuntimeUrls;
}

export function setRuntimeGpuUrl(apiUrl: string) {
  cachedRuntimeUrls = {
    ...cachedRuntimeUrls,
    apiUrl: apiUrl.trim().replace(/\/+$/, ''),
  };
}

interface CallAiProxyParams {
  action: 'eval_answer' | 'eval_conversation';
  messages: Array<{ role: 'system' | 'user'; content: unknown }>;
  temperature?: number;
  gpuUrlFallback?: string;
}

async function callAiProxy({ action, messages, temperature = 0.2, gpuUrlFallback }: CallAiProxyParams) {
  const token = await getAccessToken();
  if (!token) {
    throw new Error('Chưa đăng nhập hoặc phiên làm việc đã hết hạn.');
  }

  const runtime = await syncLlmConfigFromSupabase();
  const gpuBase = (gpuUrlFallback || runtime.apiUrl || '').trim().replace(/\/+$/, '');

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
  const bodyJson = JSON.stringify({ action, messages, temperature });

  let res: Response | null = null;
  let shouldFallback = false;

  try {
    res = await fetch('/api/ai-eval', {
      method: 'POST',
      headers,
      body: bodyJson,
    });
    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    if (
      res.status === 404 ||
      res.status === 405 ||
      res.status === 501 ||
      res.status === 503 ||
      (!contentType.includes('application/json') && res.status >= 400)
    ) {
      shouldFallback = true;
    }
  } catch (networkErr) {
    if (!gpuBase) throw networkErr;
    shouldFallback = true;
  }

  if (shouldFallback && gpuBase) {
    const gpuRes = await fetch(`${gpuBase}/ai_eval`, {
      method: 'POST',
      headers,
      body: bodyJson,
    });
    res = gpuRes;
  }

  if (!res) {
    throw new Error('Không thể kết nối tới dịch vụ chấm điểm AI.');
  }

  const payload = (await res.json().catch(() => null)) as {
    success?: boolean;
    content?: string;
    model?: string;
    error?: string;
    detail?: string;
  } | null;

  if (!res.ok || !payload?.success) {
    throw new Error(
      payload?.error || payload?.detail || 'Dịch vụ AI tạm thời không phản hồi. Vui lòng thử lại.',
    );
  }

  return payload;
}

function buildExaminerSystemPrompt(taskType = ''): string {
  if (taskType === 'read_aloud') {
    return `Giám khảo Speaking IELTS/TOEIC cho dạng Đọc to (Read Aloud). Điểm phát âm (PR) đã được hệ thống đo âm học, KHÔNG chấm lại điểm hay ngữ pháp.
Chỉ trả về DUY NHẤT JSON:
{"feedback_summary":"<1-2 câu tiếng Việt nhận xét ngắt nghỉ, trọng âm, ngữ điệu dựa trên bài đọc và điểm PR>"}`;
  }

  return `Giám khảo IELTS Speaking (Band 1.0-9.0, bước 0.5). Điểm PR đã đo âm học (KHÔNG tính lại PR hay score_total).
Chấm 3 tiêu chí ngôn ngữ & trả về DUY NHẤT JSON:
- fc (Fluency & Coherence): đúng trọng tâm/mạch lạc=7.0; mở rộng tự nhiên=7.5-8.5; ngắn/ngập ngừng=6.0-6.5; lạc đề<=3.0.
- lr (Lexical Resource): phù hợp chủ đề=7.0; chọn lọc/B2-C1=7.5-8.5; cơ bản/lặp=6.0-6.5.
- gra (Grammatical Range & Accuracy): câu phức đúng=8.5; câu đơn chuẩn=8.0; lấn cấn nhẹ=7.0-7.5; 1 lỗi rõ=6.5; nhiều lỗi/cụt<=6.0.
OUTPUT JSON:
{"fc":<1.0-9.0>,"lr":<1.0-9.0>,"gra":<1.0-9.0>,"relevance_level":"too_short"|"irrelevant"|"partially_relevant"|"relevant"|"excellent","grammar_errors":[{"error_text":"...","fix":"...","explanation":"<ngắn gọn VI>"}],"feedback_summary":"<1-2 câu tiếng Việt>","better_expression":"<1 câu mẫu nâng cao>"}`;
}

export function getTaskSpecificRubric(taskType = ''): string {
  const normType = (taskType || '').trim().toLowerCase();

  switch (normType) {
    case 'read_aloud':
      return 'Read Aloud: chỉ nhận xét ngắt nghỉ (pausing), trọng âm và ngữ điệu.';
    case 'picture_description':
      return 'Picture Description: đối chiếu trực tiếp ảnh đính kèm; trừ mạnh fc nếu tả sai chi tiết trong ảnh; kiểm tra hiện tại tiếp diễn, giới từ vị trí, There is/are.';
    case 'short_qa':
      return 'Short Q&A: trả lời trực diện Wh-question, ưu tiên có mở rộng lý do/ví dụ, đúng thì hiện tại đơn.';
    case 'information_qa':
      return 'Information Q&A: đối chiếu dữ liệu đã cho; nếu sai ngày/giờ/địa điểm/giá thì fc <= 4.0.';
    case 'description':
      return 'Description: miêu tả cụ thể bằng tính từ, mệnh đề quan hệ và chia thì nhất quán.';
    case 'experience_future':
      return 'Experience/Future: kiểm soát đúng thì Quá khứ (trải nghiệm) hoặc Tương lai (kế hoạch), trình tự rõ.';
    case 'opinion':
      return 'Opinion: nêu rõ lập trường + luận cứ/ví dụ + từ nối lập luận.';
    case 'problem_solution':
      return 'Problem/Solution: nêu rõ vấn đề + giải pháp khả thi + câu điều kiện/modal verbs.';
    case 'long_turn':
      return 'Long Turn (Cue Card): bao quát đủ ý gợi ý, bố cục 3 phần, dùng discourse markers.';
    case 'discussion':
      return 'Discussion: góc nhìn xã hội đa chiều, từ vựng B2/C1 và cấu trúc câu phức.';
    default:
      return '';
  }
}

function clampScore(val: unknown, min = 0, max = 10): number {
  const num = Number(val);
  if (Number.isNaN(num)) return 5.0;
  return Math.round(Math.max(min, Math.min(max, num)) * 10) / 10;
}

function roundToHalf(val: unknown, min = 1.0, max = 9.0): number {
  const num = Number(val);
  if (Number.isNaN(num)) return 7.0;
  const clamped = Math.max(min, Math.min(max, num));
  return Math.round(clamped * 2) / 2;
}

export function calibrateTotalScoreWithContext(
  rawTotal: number,
  contextScore: number | null,
  grammarScore: number | null,
  lexicalScore: number | null = null,
  relevanceLevel = '',
  taskType = '',
): number {
  let total = Number(rawTotal);
  if (Number.isNaN(total)) total = 5.0;
  const ctx = Number(contextScore) || 0;
  void grammarScore;
  void lexicalScore;

  if (taskType === 'read_aloud') {
    return clampScore(total, 1.0, 9.0);
  }

  // Only cap overall score when the answer is genuinely off-topic / irrelevant (< 3.0)
  if (relevanceLevel === 'irrelevant' || (contextScore != null && ctx < 3.0)) {
    const ceiling = Math.min(3.5, Math.max(1.0, ctx + 0.8));
    if (total > ceiling) total = ceiling;
  }

  return clampScore(total, 1.0, 9.0);
}

function fallbackHeuristicEval({
  transcript,
  pronunciationScores,
  taskType = '',
}: {
  transcript: string;
  pronunciationScores: Partial<PronunciationScores>;
  taskType?: string;
}): AiEvalResult {
  const words = transcript.trim().split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  const rawPron = roundToHalf(
    pronunciationScores.p ??
    pronunciationScores.score_pronunciation ??
    pronunciationScores.accuracy ??
    pronunciationScores.total ??
    6.5,
  );

  if (taskType === 'read_aloud') {
    return {
      score_total: rawPron,
      score_pronunciation: rawPron,
      score_fluency_coherence: null,
      score_lexical: null,
      score_grammar: null,
      score_context: null,
      relevance_level: 'relevant',
      grammar_errors: [],
      feedback_summary: 'Đã hoàn thành đánh giá phát âm đọc to.',
      better_expression: '',
      is_fallback: true,
    };
  }

  // Prefer calibrated 4-pillar scores already computed by the Python backend (WavLM + Local NLP + DeepSeek)
  const hasBackend4Pillars =
    pronunciationScores.fc != null &&
    pronunciationScores.lr != null &&
    pronunciationScores.gra != null;

  const scoreContext = hasBackend4Pillars
    ? roundToHalf(pronunciationScores.fc)
    : roundToHalf(pronunciationScores.fluency ?? (wordCount <= 2 ? 6.0 : 7.0));
  const scoreLexical = hasBackend4Pillars
    ? roundToHalf(pronunciationScores.lr)
    : roundToHalf(wordCount <= 2 ? 6.5 : 7.0);
  const scoreGrammar = hasBackend4Pillars
    ? roundToHalf(pronunciationScores.gra)
    : roundToHalf(wordCount <= 2 ? 6.5 : 7.0);

  const scoreTotal = clampScore((rawPron + scoreContext + scoreLexical + scoreGrammar) / 4, 1.0, 9.0);
  const relevance = wordCount <= 2 ? 'partially_relevant' : 'relevant';
  const summary =
    wordCount <= 2
      ? 'Câu trả lời còn ngắn, bạn nên mở rộng thành câu hoàn chỉnh.'
      : 'Đã đánh giá theo 4 tiêu chuẩn khảo thí IELTS (Phát âm, Mạch lạc, Từ vựng, Ngữ pháp).';

  return {
    score_total: scoreTotal,
    score_pronunciation: rawPron,
    score_fluency_coherence: scoreContext,
    score_lexical: scoreLexical,
    score_grammar: scoreGrammar,
    score_context: scoreContext,
    relevance_level: relevance,
    grammar_errors: [],
    feedback_summary: summary,
    better_expression: '',
    is_fallback: true,
  };
}

export async function evaluateAnswerWithLlm({
  questionText,
  partTitle = '',
  examType = 'general',
  taskType = '',
  referenceText = '',
  imageUrl = null,
  transcript = '',
  pronunciationScores = {},
  gpuUrlFallback = '',
}: {
  questionText: string;
  partTitle?: string;
  examType?: string;
  taskType?: string;
  referenceText?: string;
  imageUrl?: string | null;
  transcript?: string;
  pronunciationScores?: Partial<PronunciationScores>;
  gpuUrlFallback?: string;
}): Promise<AiEvalResult> {
  const runtime = await syncLlmConfigFromSupabase();
  const cleanTranscript = (transcript || '').trim();
  const acc = Number(pronunciationScores.p ?? pronunciationScores.score_pronunciation ?? pronunciationScores.accuracy) || 0;
  const flu = Number(pronunciationScores.fc ?? pronunciationScores.fluency) || 0;
  const pro = Number(pronunciationScores.prosodic) || acc;
  const rawPronTotal = roundToHalf(
    pronunciationScores.p ??
    pronunciationScores.score_pronunciation ??
    pronunciationScores.accuracy ??
    pronunciationScores.total ??
    0,
  );

  if (!cleanTranscript) {
    return {
      score_total: 1.0,
      score_grammar: 1.0,
      score_context: 1.0,
      relevance_level: 'too_short',
      grammar_errors: [],
      feedback_summary: 'Không phát hiện thấy âm thanh câu trả lời hoặc giọng nói quá nhỏ.',
      better_expression: '',
      is_fallback: false,
    };
  }

  const isPictureTask = taskType === 'picture_description' && Boolean(imageUrl);
  const metaParts = [examType.toUpperCase(), partTitle, taskType].filter(Boolean).join(' | ');
  const refLine = referenceText ? `\nRef: """${referenceText}"""` : '';
  const taskRubric = getTaskSpecificRubric(taskType);
  const rubricLine = taskRubric ? `\nRule: ${taskRubric}` : '';

  const userContentText = `[${metaParts}]
Q: "${questionText || 'N/A'}"${refLine}${rubricLine}
A: "${cleanTranscript}"
PR=${rawPronTotal.toFixed(1)}/9.0`;

  const userMessageContent = isPictureTask
    ? [
      { type: 'text', text: userContentText },
      { type: 'image_url', image_url: { url: imageUrl } },
    ]
    : userContentText;

  try {
    const data = await callAiProxy({
      action: 'eval_answer',
      messages: [
        { role: 'system', content: buildExaminerSystemPrompt(taskType) },
        { role: 'user', content: userMessageContent },
      ],
      temperature: 0.2,
      gpuUrlFallback,
    });

    const rawContent = data.content || '';
    const usedModel = data.model || runtime.llmModel;

    let parsed: Record<string, unknown> | null = null;
    try {
      const cleanJson = rawContent.replace(/```json/gi, '').replace(/```/g, '').trim();
      parsed = JSON.parse(cleanJson) as Record<string, unknown>;
    } catch {
      const match = rawContent.match(/\{[\s\S]*\}/);
      if (match) {
        parsed = JSON.parse(match[0]) as Record<string, unknown>;
      } else {
        throw new Error('Phản hồi từ AI không có cấu trúc JSON hợp lệ.');
      }
    }

    const llmGrammar =
      taskType === 'read_aloud' ? null : roundToHalf(parsed.gra ?? parsed.score_grammar, 1.0, 9.0);
    const llmContext =
      taskType === 'read_aloud'
        ? null
        : roundToHalf(parsed.fc ?? parsed.score_fluency_coherence ?? parsed.score_context, 1.0, 9.0);
    const llmLexical =
      taskType === 'read_aloud'
        ? null
        : roundToHalf(parsed.lr ?? parsed.score_lexical ?? parsed.gra ?? parsed.score_grammar, 1.0, 9.0);

    // Unify with Python backend's calibrated 4-pillar pipeline (WavLM + SpeechOcean762 + Local NLP + DeepSeek):
    // - Preserve acoustic fluency contribution on FC (65% LLM coherence + 35% backend acoustic fluency)
    // - Keep 0.5 band steps on all 4 criteria, pure arithmetic mean rounded to 1 decimal for Overall
    const backendFc =
      pronunciationScores.fc != null && !Number.isNaN(Number(pronunciationScores.fc))
        ? Number(pronunciationScores.fc)
        : flu > 0
          ? flu
          : null;

    const scoreGrammar = llmGrammar;
    const scoreContext =
      taskType === 'read_aloud' || llmContext == null
        ? null
        : !isPictureTask && backendFc != null && backendFc >= 1.0
          ? roundToHalf(0.65 * llmContext + 0.35 * backendFc, 1.0, 9.0)
          : llmContext;
    const scoreLexical = llmLexical;
    const relevanceLevel =
      taskType === 'read_aloud'
        ? 'relevant'
        : String(parsed.relevance_level || ((scoreContext ?? 0) < 3.0 ? 'irrelevant' : 'relevant'));

    let scoreTotal: number;
    if (taskType === 'read_aloud') {
      scoreTotal = rawPronTotal;
    } else {
      const rawWeightedTotal =
        rawPronTotal * 0.25 +
        (scoreContext ?? 0) * 0.25 +
        (scoreLexical ?? 0) * 0.25 +
        (scoreGrammar ?? 0) * 0.25;
      scoreTotal = calibrateTotalScoreWithContext(
        rawWeightedTotal,
        scoreContext,
        scoreGrammar,
        scoreLexical,
        relevanceLevel,
        taskType,
      );
    }

    return {
      score_total: scoreTotal,
      score_pronunciation: rawPronTotal,
      score_fluency_coherence: scoreContext,
      score_lexical: scoreLexical,
      score_grammar: scoreGrammar,
      score_context: scoreContext,
      relevance_level: relevanceLevel,
      grammar_errors:
        taskType === 'read_aloud' || !Array.isArray(parsed.grammar_errors)
          ? []
          : (parsed.grammar_errors as AiEvalResult['grammar_errors']),
      feedback_summary: String(parsed.feedback_summary || 'Đã hoàn thành phân tích câu trả lời.'),
      better_expression: String(parsed.better_expression || ''),
      is_fallback: false,
      model_used: usedModel,
    };
  } catch (err) {
    const fb = fallbackHeuristicEval({
      transcript: cleanTranscript,
      pronunciationScores: { ...pronunciationScores, accuracy: acc, fluency: flu, prosodic: pro, total: rawPronTotal },
      taskType,
    });
    fb.is_fallback = true;
    fb.fallback_reason = err instanceof Error ? err.message : String(err);
    return fb;
  }
}

function buildDialogueExaminerSystemPrompt(hasBeIelts4: boolean): string {
  if (hasBeIelts4) {
    return `Giám khảo IELTS Speaking. Điểm 4 tiêu chí (PR/FC/LR/GRA) đã có sẵn — KHÔNG chấm lại điểm.
Chỉ đánh giá Học viên (S), KHÔNG bắt lỗi Giáo viên (T). Trả về DUY NHẤT JSON:
{"conversation_summary":"<2-3 câu tiếng Việt nhận xét điểm mạnh/yếu theo 4 tiêu chí IELTS>","grammar_errors":[{"turn_index":<số lượt S>,"error_text":"...","fix":"...","explanation":"<ngắn gọn VI>"}],"communication_tips":["<gợi ý 1>","<gợi ý 2>"],"better_dialogue_expressions":["<1 câu mẫu nâng cao>"]}`;
  }

  return `Giám khảo IELTS Speaking (Band 1.0-9.0, bước 0.5). PR đã có sẵn. Chỉ đánh giá Học viên (S), KHÔNG bắt lỗi Giáo viên (T).
Trả về DUY NHẤT JSON:
{"fc":<1.0-9.0>,"lr":<1.0-9.0>,"gra":<1.0-9.0>,"conversation_summary":"<2-3 câu tiếng Việt>","grammar_errors":[{"turn_index":<số lượt S>,"error_text":"...","fix":"...","explanation":"<ngắn gọn VI>"}],"communication_tips":["<gợi ý 1>","<gợi ý 2>"],"better_dialogue_expressions":["<1 câu mẫu nâng cao>"]}`;
}

function fallbackConversationHeuristic({
  studentTurns,
  studentFullText,
  pronunciationScores,
}: {
  studentTurns: DialogueTurn[];
  studentFullText: string;
  pronunciationScores: Partial<PronunciationScores>;
}): AiEvalResult {
  void studentTurns;
  const rawPron = clampScore(
    pronunciationScores.p ?? pronunciationScores.accuracy ?? pronunciationScores.total ?? 7.0,
    1.0,
    9.0,
  );
  const fc = clampScore(pronunciationScores.fc ?? pronunciationScores.fluency ?? rawPron, 1.0, 9.0);
  const lr = clampScore(pronunciationScores.lr ?? pronunciationScores.lexical ?? rawPron, 1.0, 9.0);
  const gra = clampScore(pronunciationScores.gra ?? pronunciationScores.grammar ?? rawPron, 1.0, 9.0);

  const total =
    pronunciationScores.total != null &&
    pronunciationScores.fc != null &&
    pronunciationScores.lr != null &&
    pronunciationScores.gra != null
      ? clampScore(pronunciationScores.total, 1.0, 9.0)
      : clampScore((rawPron + fc + lr + gra) / 4.0, 1.0, 9.0);
  const summary = 'Học viên tương tác tự nhiên, phát âm rõ ràng và phản xạ tích cực với giáo viên trong toàn bộ buổi học.';

  const fallbackGrammarErrors: AiEvalResult['grammar_errors'] = [];
  const lowerText = studentFullText.toLowerCase();
  if (/\bi is\b/.test(lowerText)) {
    fallbackGrammarErrors.push({
      error_text: 'I is',
      fix: 'I am',
      explanation: "Đại từ 'I' đi với động từ to be ở hiện tại là 'am', không dùng 'is'.",
    });
  }
  if (/\bi are\b/.test(lowerText)) {
    fallbackGrammarErrors.push({
      error_text: 'I are',
      fix: 'I am',
      explanation: "Đại từ 'I' đi với động từ to be ở hiện tại là 'am', không dùng 'are'.",
    });
  }
  if (/\b(he|she|it) don't\b/.test(lowerText)) {
    fallbackGrammarErrors.push({
      error_text: "don't (với He/She/It)",
      fix: "doesn't",
      explanation: "Chủ ngữ ngôi thứ 3 số ít đi với trợ động từ phủ định 'doesn't'.",
    });
  }
  if (/\bmany people is\b/.test(lowerText)) {
    fallbackGrammarErrors.push({
      error_text: 'many people is',
      fix: 'many people are',
      explanation: "'People' là danh từ số nhiều, đi với động từ to be 'are'.",
    });
  }

  return {
    score_total: total,
    score_pronunciation: rawPron,
    score_fluency_coherence: fc,
    score_lexical: lr,
    score_grammar: gra,
    score_context: fc,
    conversation_summary: summary,
    grammar_errors: fallbackGrammarErrors,
    communication_tips: [
      'Nên mở rộng câu trả lời bằng cách thêm lý do (Because...) hoặc nêu thêm ví dụ cụ thể.',
      'Tiếp tục duy trì phản xạ giao tiếp tự tin và phát huy ngữ điệu tự nhiên.',
    ],
    better_dialogue_expressions: [],
    is_fallback: true,
  };
}

export async function evaluateConversationWithAi({
  dialogueTurns = [],
  pronunciationScores = {},
  gpuUrlFallback = '',
}: {
  dialogueTurns?: DialogueTurn[];
  pronunciationScores?: Partial<PronunciationScores>;
  gpuUrlFallback?: string;
}): Promise<AiEvalResult> {
  const runtime = await syncLlmConfigFromSupabase();
  const hasBeIelts4 =
    pronunciationScores.p != null &&
    pronunciationScores.fc != null &&
    pronunciationScores.lr != null &&
    pronunciationScores.gra != null;
  const rawPronTotal = clampScore(
    pronunciationScores.p ?? pronunciationScores.accuracy ?? pronunciationScores.total ?? 0,
    1.0,
    9.0,
  );
  const beFc = pronunciationScores.fc != null ? clampScore(pronunciationScores.fc, 1.0, 9.0) : null;
  const beLr = pronunciationScores.lr != null ? clampScore(pronunciationScores.lr, 1.0, 9.0) : null;
  const beGra = pronunciationScores.gra != null ? clampScore(pronunciationScores.gra, 1.0, 9.0) : null;
  const beTotal = pronunciationScores.total != null ? clampScore(pronunciationScores.total, 1.0, 9.0) : null;

  const studentTurns = dialogueTurns.filter((t) => t.role === 'student' || t.speaker === 'Student');
  const studentFullText = studentTurns.map((t) => t.transcript || '').join(' ').trim();

  if (!studentFullText) {
    return {
      score_total: 1.0,
      score_pronunciation: 1.0,
      score_fluency_coherence: 1.0,
      score_lexical: 1.0,
      score_grammar: 1.0,
      score_context: 1.0,
      conversation_summary: 'Không phát hiện thấy lượt nói nào của học viên trong đoạn hội thoại.',
      grammar_errors: [],
      communication_tips: ['Cần tích cực tương tác và phản hồi giáo viên trong suốt cuộc hội thoại.'],
      better_dialogue_expressions: [],
      is_fallback: false,
    };
  }

  const conversationTranscript = dialogueTurns
    .map((t, idx) => {
      const tag = t.role === 'teacher' || t.speaker === 'Teacher' ? 'T' : 'S';
      return `${idx + 1}.${tag}: ${(t.transcript || '').trim()}`;
    })
    .join('\n');

  const scoreContextLine = hasBeIelts4
    ? `Scores(1-9): PR=${rawPronTotal.toFixed(1)}, FC=${beFc!.toFixed(1)}, LR=${beLr!.toFixed(1)}, GRA=${beGra!.toFixed(1)}, OV=${(beTotal ?? (rawPronTotal + beFc! + beLr! + beGra!) / 4).toFixed(1)}`
    : `PR=${rawPronTotal.toFixed(1)}/9.0`;

  const userPrompt = `${conversationTranscript}\n${scoreContextLine}`;

  try {
    const data = await callAiProxy({
      action: 'eval_conversation',
      messages: [
        { role: 'system', content: buildDialogueExaminerSystemPrompt(hasBeIelts4) },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.2,
      gpuUrlFallback,
    });

    const rawContent = data.content || '';
    const usedModel = data.model || runtime.llmModel;

    let parsed: Record<string, unknown> | null = null;
    try {
      const cleanJson = rawContent.replace(/```json/gi, '').replace(/```/g, '').trim();
      parsed = JSON.parse(cleanJson) as Record<string, unknown>;
    } catch {
      const match = rawContent.match(/\{[\s\S]*\}/);
      if (match) {
        parsed = JSON.parse(match[0]) as Record<string, unknown>;
      } else {
        throw new Error('Phản hồi từ AI không có cấu trúc JSON hợp lệ.');
      }
    }

    const studentGrammarErrors = Array.isArray(parsed.grammar_errors)
      ? (parsed.grammar_errors as AiEvalResult['grammar_errors'])
      : [];

    // Preserve calibrated per-turn IELTS 4-pillar averages from Backend when available
    const finalPr = rawPronTotal;
    const finalFc = hasBeIelts4
      ? beFc!
      : roundToHalf(parsed.fc ?? parsed.score_fluency_coherence ?? parsed.score_context, 1.0, 9.0);
    const finalLr = hasBeIelts4
      ? beLr!
      : roundToHalf(parsed.lr ?? parsed.score_lexical ?? parsed.gra ?? parsed.score_grammar, 1.0, 9.0);
    const finalGra = hasBeIelts4
      ? beGra!
      : roundToHalf(parsed.gra ?? parsed.score_grammar, 1.0, 9.0);
    const finalTotal = hasBeIelts4
      ? (beTotal ?? clampScore((finalPr + finalFc + finalLr + finalGra) / 4.0, 1.0, 9.0))
      : clampScore((finalPr + finalFc + finalLr + finalGra) / 4.0, 1.0, 9.0);

    return {
      score_total: finalTotal,
      score_pronunciation: finalPr,
      score_fluency_coherence: finalFc,
      score_lexical: finalLr,
      score_grammar: finalGra,
      score_context: finalFc,
      conversation_summary: String(parsed.conversation_summary || 'Đã hoàn thành đánh giá hội thoại.'),
      grammar_errors: studentGrammarErrors,
      communication_tips: Array.isArray(parsed.communication_tips)
        ? (parsed.communication_tips as string[])
        : [],
      better_dialogue_expressions: Array.isArray(parsed.better_dialogue_expressions)
        ? (parsed.better_dialogue_expressions as string[])
        : [],
      is_fallback: false,
      model_used: usedModel,
    };
  } catch (err) {
    const fb = fallbackConversationHeuristic({
      studentTurns,
      studentFullText,
      pronunciationScores,
    });
    fb.is_fallback = true;
    fb.fallback_reason = err instanceof Error ? err.message : String(err);
    return fb;
  }
}


