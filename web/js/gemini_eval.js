/**
 * SpeakAI – Gemini 3.7 Flash Evaluation Service
 * 
 * Tích hợp API Gemini (RevidAPI / OpenAI-compatible endpoint)
 * URL: https://revidapi.com/v1/chat/completions
 * Model: gemini-3.7-flash
 * Header: x-api-key: YOUR_API_KEY
 * 
 * Chấm điểm Ngữ pháp, Ngữ cảnh và kết hợp với điểm phát âm âm học
 * TUYỆT ĐỐI KHÔNG DÙNG CÔNG THỨC PHẦN TRĂM CỐ ĐỊNH.
 */

export const DEFAULT_GEMINI_ENDPOINT = 'https://revidapi.com/v1/chat/completions';
export const DEFAULT_GEMINI_MODEL = 'gemini-3.7-flash';

/**
 * Lấy cấu hình Gemini API từ cache / globalSettings / localStorage
 */
export function getGeminiConfig() {
  const localKey = (typeof localStorage !== 'undefined') ? localStorage.getItem('speakai_gemini_key') : null;
  const localUrl = (typeof localStorage !== 'undefined') ? localStorage.getItem('speakai_gemini_url') : null;
  const localModel = (typeof localStorage !== 'undefined') ? localStorage.getItem('speakai_gemini_model') : null;

  const windowKey = (typeof window !== 'undefined') ? window.globalGeminiApiKey : null;
  const windowUrl = (typeof window !== 'undefined') ? window.globalGeminiApiUrl : null;
  const windowModel = (typeof window !== 'undefined') ? window.globalGeminiModel : null;

  return {
    apiKey: (windowKey || localKey || '').trim(),
    apiUrl: (windowUrl || localUrl || DEFAULT_GEMINI_ENDPOINT).trim(),
    model: (windowModel || localModel || DEFAULT_GEMINI_MODEL).trim(),
  };
}

/**
 * Lưu cấu hình Gemini API cục bộ
 */
export function saveLocalGeminiConfig({ apiKey, apiUrl, model }) {
  if (typeof localStorage === 'undefined') return;
  if (apiKey !== undefined) localStorage.setItem('speakai_gemini_key', apiKey.trim());
  if (apiUrl !== undefined) localStorage.setItem('speakai_gemini_url', apiUrl.trim());
  if (model !== undefined) localStorage.setItem('speakai_gemini_model', model.trim());
}

/**
 * Kiểm tra kết nối API Key Gemini (Test Connection)
 */
export async function testGeminiConnection(apiKey, apiUrl = DEFAULT_GEMINI_ENDPOINT, model = DEFAULT_GEMINI_MODEL) {
  const cleanKey = (apiKey || '').trim();
  if (!cleanKey) {
    throw new Error('Chưa cung cấp API Key!');
  }

  const res = await fetch(apiUrl.trim(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': cleanKey,
    },
    body: JSON.stringify({
      model: model.trim(),
      messages: [
        { role: 'user', content: 'Ping test. Reply with "OK".' }
      ],
      max_tokens: 10,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`API Lỗi HTTP ${res.status}: ${errText.slice(0, 200) || res.statusText}`);
  }

  const data = await res.json();
  const reply = data.choices?.[0]?.message?.content || '';
  return {
    success: true,
    model: data.model || model,
    reply: reply.trim(),
  };
}

/**
 * System Prompt chuyên gia Khảo thí Ngôn ngữ Anh quốc tế
 */
function buildExaminerSystemPrompt() {
  return `Bạn là Giám khảo Speaking (CEFR/IELTS/VSTEP). Đánh giá bài nói của học viên và trả về DUY NHẤT 1 JSON.

QUY TẮC CHẤM ĐIỂM (NON-LINEAR):
1. Ngữ cảnh là điều kiện tiên quyết (Gatekeeper):
   - Lạc đề (irrelevant) hoặc cộc lốc (1-3 từ): score_context <= 2.5, score_total BẮT BUỘC <= 3.5. Điểm ngữ pháp TUYỆT ĐỐI KHÔNG được kéo điểm tổng lên dù câu nói đúng ngữ pháp.
   - Đạt một phần (score_context 3.0-4.5): score_total BẮT BUỘC <= 4.5.
   - Đúng trọng tâm (score_context >= 5.0): Ngữ pháp và phát âm phát huy trọn vẹn để nâng điểm tổng (6.0-10.0).
2. Nói vấp / từ đệm / ngập ngừng ban đầu ("um, uh, well, wait..."):
   - Phản xạ tự nhiên, TUYỆT ĐỐI KHÔNG trừ điểm Grammar hay Context nếu câu chính phía sau đúng.
3. Tiêu chí theo Dạng đề (Task Type):
   - read_aloud: Đọc to chính xác đoạn văn cho sẵn. Chấm độ khớp văn bản gốc và phát âm, KHÔNG đòi hỏi nêu ý kiến riêng.
   - picture_description: Miêu tả chi tiết hình ảnh (không gian, hành động, đồ vật, trang phục).
   - short_qa: Trả lời trực diện vào câu hỏi cá nhân, sở thích, thói quen.
   - information_qa: Cung cấp thông tin chính xác dựa theo dữ liệu cho sẵn.
   - description / experience_future: Miêu tả chi tiết, dùng đúng thì (quá khứ, tương lai/dự đoán).
   - opinion / problem_solution: Bày tỏ quan điểm rõ ràng, đưa ra giải pháp/lập luận kèm lý lẽ thuyết phục.
   - long_turn / discussion: Phát triển ý mạch lạc, cấu trúc bài nói hoàn chỉnh (mở-thân-kết), thảo luận sâu sắc.
4. Ngữ pháp (score_grammar 0-10): Đánh giá cấu trúc, thì, trật tự từ của câu trả lời chính.
5. Điểm tổng thể (score_total 0-10): Kết hợp Phát âm + Ngữ pháp + Ngữ cảnh theo các mức trần trên.

OUTPUT JSON FORMAT:
{
  "score_total": <float 0-10>,
  "score_grammar": <float 0-10>,
  "score_context": <float 0-10>,
  "relevance_level": "too_short" | "irrelevant" | "partially_relevant" | "relevant" | "excellent",
  "grammar_errors": [{"error_text": "...", "fix": "...", "explanation": "..."}],
  "feedback_summary": "<Nhận xét sư phạm 1-2 câu tiếng Việt>",
  "better_expression": "<1 câu nói mẫu tự nhiên, nâng cao>"
}`;
}

/**
 * Đánh giá câu trả lời học viên bằng Gemini 3.7 Flash API
 * 
 * @param {Object} params
 * @param {string} params.questionText - Đề bài / câu hỏi
 * @param {string} params.partTitle - Tên phần thi (ví dụ Part 1, Part 2)
 * @param {string} params.examType - Loại kỳ thi (vstep, ielts, toeic, general)
 * @param {string} params.taskType - Dạng đề (read_aloud, picture_description, short_qa, ...)
 * @param {string} params.transcript - Lời học viên nói (từ Whisper)
 * @param {Object} params.pronunciationScores - { accuracy, fluency, prosodic, total }
 * @param {string} [params.apiKey] - API key tùy chọn (nếu không truyền sẽ lấy từ getGeminiConfig)
 */
export async function evaluateAnswerWithGemini({
  questionText,
  partTitle = '',
  examType = 'general',
  taskType = '',
  transcript = '',
  pronunciationScores = {},
  apiKey = null,
}) {
  const config = getGeminiConfig();
  const effectiveKey = (apiKey || config.apiKey || '').trim();
  const endpoint = config.apiUrl || DEFAULT_GEMINI_ENDPOINT;
  const model = config.model || DEFAULT_GEMINI_MODEL;

  const cleanTranscript = (transcript || '').trim();
  const acc = Number(pronunciationScores.accuracy) || 0;
  const flu = Number(pronunciationScores.fluency) || 0;
  const pro = Number(pronunciationScores.prosodic) || 0;
  const rawPronTotal = Number(pronunciationScores.total) || ((acc + flu + pro) / 3);

  // Nếu không có transcript hoặc quá ngắn rỗng
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

  // Nếu chưa cấu hình API Key, dùng bộ phân tích heuristic an toàn (fallback)
  if (!effectiveKey) {
    console.warn('⚠️ Gemini API Key chưa được cấu hình. Áp dụng đánh giá heuristic dự phòng.');
    return fallbackHeuristicEval({
      questionText,
      transcript: cleanTranscript,
      pronunciationScores: { accuracy: acc, fluency: flu, prosodic: pro, total: rawPronTotal },
      taskType,
    });
  }

  const taskTag = taskType ? ` [Dạng bài: ${taskType}]` : '';
  const userContent = `Đề: "${questionText || 'N/A'}"${partTitle ? ` [${partTitle}]` : ''}${taskTag} [${examType.toUpperCase()}]
Bài nói: "${cleanTranscript}"
Phát âm âm học: Acc=${acc.toFixed(1)}, Flu=${flu.toFixed(1)}, Pro=${pro.toFixed(1)}, Avg=${rawPronTotal.toFixed(1)}
Đánh giá ngữ pháp, ngữ cảnh (theo dạng bài) và chốt score_total. Trả về đúng JSON.`;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': effectiveKey,
      },
      body: JSON.stringify({
        model: model,
        messages: [
          { role: 'system', content: buildExaminerSystemPrompt() },
          { role: 'user', content: userContent },
        ],
        temperature: 0.2,
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Gemini API HTTP ${response.status}: ${errText.slice(0, 150)}`);
    }

    const data = await response.json();
    const rawContent = data.choices?.[0]?.message?.content || '';

    // Parse JSON an toàn (xử lý cả trường hợp markdown code blocks \`\`\`json ... \`\`\`)
    let parsed = null;
    try {
      const cleanJson = rawContent.replace(/```json/gi, '').replace(/```/g, '').trim();
      parsed = JSON.parse(cleanJson);
    } catch (parseErr) {
      console.warn('Không thể parse trực tiếp JSON từ Gemini, trích xuất bằng regex:', rawContent);
      const match = rawContent.match(/\{[\s\S]*\}/);
      if (match) {
        parsed = JSON.parse(match[0]);
      } else {
        throw new Error('Phản hồi từ Gemini không có cấu trúc JSON hợp lệ.');
      }
    }

    // Chuẩn hóa điểm ngữ pháp & ngữ cảnh
    const scoreGrammar = clampScore(parsed.score_grammar, 0, 10);
    const scoreContext = clampScore(parsed.score_context, 0, 10);
    const relevanceLevel = parsed.relevance_level || (scoreContext < 3.0 ? 'irrelevant' : 'relevant');

    // Hiệu chuẩn điểm tổng thể: Nếu ngữ cảnh đã không phù hợp, điểm ngữ pháp không được can thiệp nhiều vào điểm tổng
    const scoreTotal = calibrateTotalScoreWithContext(parsed.score_total, scoreContext, scoreGrammar, relevanceLevel);

    return {
      score_total: scoreTotal,
      score_grammar: scoreGrammar,
      score_context: scoreContext,
      relevance_level: relevanceLevel,
      grammar_errors: Array.isArray(parsed.grammar_errors) ? parsed.grammar_errors : [],
      feedback_summary: parsed.feedback_summary || 'Đã hoàn thành phân tích câu trả lời.',
      better_expression: parsed.better_expression || '',
      is_fallback: false,
      model_used: model,
    };

  } catch (err) {
    console.error('❌ Lỗi gọi Gemini Evaluator API:', err);
    // Khi gặp lỗi mạng hoặc API Key hết hạn, fallback an toàn để không chặn học viên
    const fb = fallbackHeuristicEval({
      questionText,
      transcript: cleanTranscript,
      pronunciationScores: { accuracy: acc, fluency: flu, prosodic: pro, total: rawPronTotal },
    });
    fb.is_fallback = true;
    fb.fallback_reason = err.message;
    return fb;
  }
}

/**
 * Hiệu chuẩn điểm tổng thể theo nguyên tắc Gatekeeper của Ngữ Cảnh:
 * Nếu ngữ cảnh đã không phù hợp (lạc đề, quá cộc lốc), điểm ngữ pháp
 * tuyệt đối không được can thiệp nhiều để kéo điểm tổng lên.
 */
function calibrateTotalScoreWithContext(rawTotal, contextScore, grammarScore, relevanceLevel) {
  let total = Number(rawTotal);
  if (isNaN(total)) total = 5.0;
  const ctx = Number(contextScore) || 0;
  const gram = Number(grammarScore) || 0;

  // Trường hợp 1: Ngữ cảnh lạc đề hoàn toàn hoặc cộc lốc vô nghĩa
  // (relevance là 'irrelevant' / 'too_short' hoặc context < 3.0)
  if (relevanceLevel === 'irrelevant' || relevanceLevel === 'too_short' || ctx < 3.0) {
    // Ngữ pháp chỉ can thiệp tối đa tượng trưng (dưới 10%), không được kéo điểm tổng vượt quá trần
    const ceiling = Math.min(3.5, Math.max(1.0, ctx + 0.8));
    if (total > ceiling) {
      total = ceiling;
    }
  }
  // Trường hợp 2: Ngữ cảnh chưa phù hợp / lạc đề một phần (context >= 3.0 && context < 4.5)
  else if (ctx < 4.5 || relevanceLevel === 'partially_relevant') {
    // Điểm tổng bị chặn trần không quá 4.5 để điểm ngữ pháp không kéo lên cao
    const ceiling = Math.min(4.5, Math.max(2.5, ctx + 0.6));
    if (total > ceiling) {
      total = ceiling;
    }
  }

  return clampScore(total, 0, 10);
}

/**
 * Đánh giá heuristic dự phòng khi không có mạng hoặc chưa nhập API Key
 * Đảm bảo vẫn ngăn chặn trường hợp nói cộc lốc / lạc đề
 */
function fallbackHeuristicEval({ questionText, transcript, pronunciationScores, taskType = '' }) {
  const words = transcript.trim().split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  const rawPron = pronunciationScores.total || 5.0;

  let scoreGrammar = 6.0;
  let scoreContext = 6.0;
  let relevance = 'relevant';
  let summary = 'Đã đánh giá cơ bản theo tiêu chuẩn khảo thí.';

  // Trường hợp đặc thù dạng Read Aloud: đối chiếu trực tiếp văn bản đề bài
  if (taskType === 'read_aloud' && questionText) {
    const qWords = questionText.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean);
    const tWords = transcript.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean);
    if (tWords.length <= 2) {
      scoreGrammar = 3.0;
      scoreContext = 2.0;
      relevance = 'too_short';
      summary = 'Chưa đọc trọn vẹn đoạn văn yêu cầu.';
    } else {
      const matchCount = tWords.filter(w => qWords.includes(w)).length;
      const matchRatio = qWords.length > 0 ? (matchCount / Math.min(qWords.length, tWords.length)) : 0.8;
      scoreContext = clampScore(matchRatio * 10, 1.0, 9.5);
      scoreGrammar = clampScore(rawPron, 1.0, 9.5);
      relevance = matchRatio >= 0.7 ? 'relevant' : (matchRatio >= 0.4 ? 'partially_relevant' : 'irrelevant');
      summary = matchRatio >= 0.7 ? 'Đã đọc bám sát và chính xác văn bản cho sẵn.' : 'Đoạn đọc còn thiếu hoặc sai lệch so với văn bản gốc.';
    }
  }
  // Trường hợp 1: Quá ngắn (dưới 4 từ)
  else if (wordCount <= 3) {
    scoreGrammar = 3.0;
    scoreContext = 2.0;
    relevance = 'too_short';
    summary = 'Câu trả lời quá ngắn, chưa đủ ý diễn đạt theo yêu cầu của câu hỏi.';
  } 
  // Trường hợp 2: Khá ngắn (4-7 từ)
  else if (wordCount <= 7) {
    scoreGrammar = 5.5;
    scoreContext = 4.5;
    relevance = 'partially_relevant';
    summary = 'Bạn trả lời được một phần nhưng câu còn ngắn, nên mở rộng thêm chi tiết.';
  } 
  // Trường hợp 3: Độ dài đạt chuẩn
  else {
    scoreGrammar = Math.min(9.0, Math.max(5.0, rawPron * 0.9));
    scoreContext = Math.min(9.0, Math.max(5.5, rawPron * 0.95));
    relevance = 'relevant';
    summary = 'Câu trả lời đầy đủ ý, cấu trúc ngữ pháp tương đối rõ ràng.';
  }

  // Nếu ngữ cảnh không phù hợp, điểm ngữ pháp không can thiệp nhiều vào điểm tổng
  let rawCalculatedTotal = (rawPron * 0.4) + (scoreGrammar * 0.3) + (scoreContext * 0.3);
  const scoreTotal = calibrateTotalScoreWithContext(rawCalculatedTotal, scoreContext, scoreGrammar, relevance);

  return {
    score_total: scoreTotal,
    score_grammar: clampScore(scoreGrammar, 0, 10),
    score_context: clampScore(scoreContext, 0, 10),
    relevance_level: relevance,
    grammar_errors: [],
    feedback_summary: summary,
    better_expression: '',
    is_fallback: true,
  };
}

function clampScore(val, min = 0, max = 10) {
  const num = Number(val);
  if (isNaN(num)) return 5.0;
  return Math.round(Math.max(min, Math.min(max, num)) * 10) / 10;
}

/**
 * System Prompt Giám khảo Khảo thí Đánh giá Hội thoại (Spoken Dialogue)
 */
function buildDialogueExaminerSystemPrompt() {
  return `Bạn là Giám khảo Khảo thí Hội thoại Speaking (CEFR/IELTS). Phân tích đoạn hội thoại giữa Giáo viên và Học viên, trả về DUY NHẤT 1 JSON.

QUY TẮC CHẤM ĐIỂM:
1. Ngữ cảnh & Phản xạ (score_context 0-10 - Gatekeeper):
   - Đánh giá khả năng hiểu và phản hồi ăn khớp với câu hỏi của giáo viên.
   - Cộc lốc (1-2 từ) hoặc lạc đề (score_context < 4.5): score_total BẮT BUỘC <= 3.5 - 4.5. Điểm ngữ pháp KHÔNG ĐƯỢC can thiệp kéo điểm tổng lên.
2. Ngữ pháp & Từ vựng (score_grammar 0-10): Đánh giá cấu trúc, chia thì. Nói vấp/từ đệm đầu lượt không bị trừ điểm.
3. Điểm tổng thể (score_total 0-10): Kết hợp Phát âm + Ngữ pháp + Ngữ cảnh theo trần trên.

OUTPUT JSON FORMAT:
{
  "score_total": <float 0-10>,
  "score_grammar": <float 0-10>,
  "score_context": <float 0-10>,
  "conversation_summary": "<Nhận xét sư phạm 2-3 câu tiếng Việt>",
  "grammar_errors": [{"turn_index": <int>, "error_text": "...", "fix": "...", "explanation": "..."}],
  "communication_tips": ["<lời khuyên 1>", "<lời khuyên 2>"],
  "better_dialogue_expressions": ["<1 câu mẫu nâng cao>"]
}`;
}

/**
 * Đánh giá toàn bộ cuộc hội thoại bằng AI Evaluator API
 */
export async function evaluateConversationWithAi({
  dialogueTurns = [],
  pronunciationScores = {},
  apiKey = null,
}) {
  const config = getGeminiConfig();
  const effectiveKey = (apiKey || config.apiKey || '').trim();
  const endpoint = config.apiUrl || DEFAULT_GEMINI_ENDPOINT;
  const model = config.model || DEFAULT_GEMINI_MODEL;

  const acc = Number(pronunciationScores.accuracy) || 0;
  const flu = Number(pronunciationScores.fluency) || 0;
  const pro = Number(pronunciationScores.prosodic) || 0;
  const rawPronTotal = Number(pronunciationScores.total) || ((acc + flu + pro) / 3);

  // Thu thập các lượt nói của Student & Teacher
  const studentTurns = dialogueTurns.filter(t => t.role === 'student' || t.speaker === 'Student');
  const studentFullText = studentTurns.map(t => t.transcript || '').join(' ').trim();

  // Nếu học viên không có lượt nói nào
  if (!studentFullText) {
    return {
      score_total: 1.0,
      score_grammar: 1.0,
      score_context: 1.0,
      conversation_summary: 'Không phát hiện thấy lượt nói nào của học viên trong đoạn hội thoại.',
      grammar_errors: [],
      communication_tips: ['Cần tích cực tương tác và phản hồi giáo viên trong suốt cuộc hội thoại.'],
      better_dialogue_expressions: [],
      is_fallback: false,
    };
  }

  // Nếu chưa có key thì chạy heuristic fallback
  if (!effectiveKey) {
    console.warn('⚠️ Gemini API Key chưa được cấu hình cho đánh giá hội thoại. Áp dụng fallback heuristic.');
    return fallbackConversationHeuristic({
      studentTurns,
      studentFullText,
      pronunciationScores: { accuracy: acc, fluency: flu, prosodic: pro, total: rawPronTotal }
    });
  }

  // Xây dựng hội thoại text có kèm số thứ tự lượt
  const conversationTranscript = dialogueTurns.map((t, idx) => {
    const roleName = (t.role === 'teacher' || t.speaker === 'Teacher') ? 'Teacher' : 'Student';
    return `[Lượt ${idx + 1}] ${roleName}: "${(t.transcript || '').trim()}"`;
  }).join('\n');

  const userPrompt = `HỘI THOẠI:
${conversationTranscript}

ĐIỂM PHÁT ÂM HỌC VIÊN: Acc=${acc.toFixed(1)}, Flu=${flu.toFixed(1)}, Pro=${pro.toFixed(1)}, Avg=${rawPronTotal.toFixed(1)}
Đánh giá toàn diện năng lực hội thoại của Học viên (Student), hiệu chuẩn score_total theo quy tắc. Trả về đúng JSON.`;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': effectiveKey,
      },
      body: JSON.stringify({
        model: model,
        messages: [
          { role: 'system', content: buildDialogueExaminerSystemPrompt() },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.2,
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`API HTTP ${response.status}: ${errText.slice(0, 150)}`);
    }

    const data = await response.json();
    const rawContent = data.choices?.[0]?.message?.content || '';

    let parsed = null;
    try {
      const cleanJson = rawContent.replace(/```json/gi, '').replace(/```/g, '').trim();
      parsed = JSON.parse(cleanJson);
    } catch (parseErr) {
      const match = rawContent.match(/\{[\s\S]*\}/);
      if (match) {
        parsed = JSON.parse(match[0]);
      } else {
        throw new Error('Phản hồi từ AI không có cấu trúc JSON hợp lệ.');
      }
    }

    const scoreGrammar = clampScore(parsed.score_grammar, 0, 10);
    const scoreContext = clampScore(parsed.score_context, 0, 10);
    let scoreTotal = clampScore(parsed.score_total, 0, 10);

    // Hiệu chuẩn hội thoại: Nếu ngữ cảnh không phù hợp, điểm ngữ pháp không can thiệp nhiều vào điểm tổng
    if (scoreContext < 3.0) {
      scoreTotal = Math.min(scoreTotal, Math.max(1.0, scoreContext + 0.8), 3.5);
    } else if (scoreContext < 4.5) {
      scoreTotal = Math.min(scoreTotal, Math.max(2.5, scoreContext + 0.6), 4.5);
    }

    return {
      score_total: scoreTotal,
      score_grammar: scoreGrammar,
      score_context: scoreContext,
      conversation_summary: parsed.conversation_summary || 'Đã hoàn thành đánh giá hội thoại.',
      grammar_errors: Array.isArray(parsed.grammar_errors) ? parsed.grammar_errors : [],
      communication_tips: Array.isArray(parsed.communication_tips) ? parsed.communication_tips : [],
      better_dialogue_expressions: Array.isArray(parsed.better_dialogue_expressions) ? parsed.better_dialogue_expressions : [],
      is_fallback: false,
      model_used: model,
    };
  } catch (err) {
    console.error('❌ Lỗi gọi AI Evaluator cho hội thoại:', err);
    const fb = fallbackConversationHeuristic({
      studentTurns,
      studentFullText,
      pronunciationScores: { accuracy: acc, fluency: flu, prosodic: pro, total: rawPronTotal }
    });
    fb.is_fallback = true;
    fb.fallback_reason = err.message;
    return fb;
  }
}

/**
 * Fallback Heuristic cho hội thoại khi không có mạng/key
 */
function fallbackConversationHeuristic({ studentTurns, studentFullText, pronunciationScores }) {
  const words = studentFullText.trim().split(/\s+/).filter(Boolean);
  const totalWords = words.length;
  const turnCount = studentTurns.length || 1;
  const avgWordsPerTurn = totalWords / turnCount;
  const rawPron = pronunciationScores.total || 5.0;

  let gram = 6.0;
  let ctx = 6.0;
  let total = rawPron;
  let summary = 'Học viên tham gia hội thoại đầy đủ các lượt.';

  if (avgWordsPerTurn <= 2) {
    gram = 4.0;
    ctx = 2.5;
    summary = 'Học viên trả lời các lượt nói còn quá ngắn (cộc lốc), chưa phát triển được ngữ cảnh hội thoại.';
  } else if (avgWordsPerTurn <= 5) {
    gram = 5.5;
    ctx = 4.5;
    summary = 'Học viên phản xạ tương đối tốt, câu trả lời đủ ý nhưng nên dùng thêm các liên từ kết nối.';
  } else {
    gram = Math.min(9.0, Math.max(5.5, rawPron * 0.9));
    ctx = Math.min(9.0, Math.max(6.0, rawPron * 0.95));
    summary = 'Khả năng phản xạ và duy trì hội thoại tốt, từ vựng và ngữ pháp tương đối linh hoạt.';
  }

  total = (rawPron * 0.4) + (gram * 0.3) + (ctx * 0.3);
  // Nếu ngữ cảnh không phù hợp, điểm ngữ pháp không can thiệp nhiều vào điểm tổng
  if (ctx < 3.0) {
    total = Math.min(total, Math.max(1.0, ctx + 0.8), 3.5);
  } else if (ctx < 4.5) {
    total = Math.min(total, Math.max(2.5, ctx + 0.6), 4.5);
  }

  return {
    score_total: clampScore(total, 0, 10),
    score_grammar: clampScore(gram, 0, 10),
    score_context: clampScore(ctx, 0, 10),
    conversation_summary: summary,
    grammar_errors: [],
    communication_tips: ['Nên sử dụng thêm các từ nối như "Because", "However", "In my experience" để kéo dài lượt nói tự nhiên.'],
    better_dialogue_expressions: [],
    is_fallback: true,
  };
}
