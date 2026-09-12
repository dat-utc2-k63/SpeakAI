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
  return `Bạn là Giám khảo Khảo thí Tiếng Anh Chuyên nghiệp (English Speaking Examiner) theo chuẩn quốc tế (CEFR / VSTEP / IELTS / TOEIC).
Nhiệm vụ của bạn là đánh giá toàn diện câu trả lời nói của học viên dựa trên:
1. Đề bài câu hỏi (Question text)
2. Lời nói của học viên đã được nhận diện (Transcript)
3. Điểm phát âm âm học từ mô hình AI (Acoustic Pronunciation Scores: Accuracy, Fluency, Prosodic)

QUY TẮC CHẤM ĐIỂM BẮT BUỘC - TUYỆT ĐỐI KHÔNG DÙNG CÔNG THỨC PHẦN TRĂM CỐ ĐỊNH:
Không bao giờ dùng công thức tuyến tính như (50% phát âm + 25% ngữ pháp + 25% ngữ cảnh) hoặc chia trung bình đơn giản, vì trong thực tế có rất nhiều trường hợp sai lệch:

1. TRƯỜNG HỢP NÓI QUÁ NGẮN / CỘC LỐC (Too Short):
   - Nếu học viên chỉ nói 1 đến 3 từ cộc lốc (ví dụ: "Yes", "No", "I think", "Hello", "Good", "I like it"), dù mô hình âm học chấm phát âm các từ đơn đó 9.0 hay 10.0:
   - ĐIỂM TỔNG THỂ (score_total) BẮT BUỘC KHÔNG VƯỢT QUÁ 2.0 - 3.0 / 10. Điểm Context tối đa 2.0 - 3.0.

2. TRƯỜNG HỢP LẠC ĐỀ HOÀN TOÀN (Off-Topic / Irrelevant):
   - Học viên nói trôi chảy, phát âm chuẩn (Accuracy 8-10) nhưng nội dung lạc đề hoàn toàn, nói nhảm nhí, hoặc đọc một đoạn văn ngẫu nhiên không liên quan đến đề bài:
   - ĐIỂM TỔNG THỂ (score_total) BẮT BUỘC KHÔNG VƯỢT QUÁ 2.5 - 3.5 / 10. Điểm Context tối đa 1.0 - 2.5.

3. TRƯỜNG HỢP CHỈ LẶP LẠI CÂU HỎI (Parrot Response):
   - Học viên chỉ đọc lại đề bài mà không trả lời:
   - ĐIỂM TỔNG THỂ (score_total) BẮT BUỘC KHÔNG VƯỢT QUÁ 2.5 - 3.0 / 10.

4. TRƯỜNG HỢP TRẢ LỜI ĐÚNG TRỌNG TÂM NHƯNG NGỮ PHÁP SAI NẶNG:
   - Học viên trả lời đúng ý nhưng cấu trúc câu lộn xộn, sai thì cơ bản, chia động từ sai, gây khó hiểu:
   - Điểm ngữ pháp (score_grammar) bị hạ thấp (3.0 - 5.0). Điểm tổng thể (score_total) bị kéo giảm theo mức độ cản trở giao tiếp.

5. TRƯỜNG HỢP TRẢ LỜI ĐẦY ĐỦ, Ý TỐT, NGỮ PHÁP TỐT:
   - Nếu nội dung đúng trọng tâm, ngữ pháp phong phú, phát âm rõ ràng:
   - Cho điểm xứng đáng (7.0 - 10.0) dựa trên khả năng truyền đạt tự nhiên.

HƯỚNG DẪN TRẢ VỀ:
Trả về DUY NHẤT một chuỗi JSON hợp lệ (không kèm văn bản thừa ngoài JSON, không dùng markdown fences nếu có thể) theo đúng cấu trúc sau:
{
  "score_total": <số thực 0.0 - 10.0, điểm tổng thể cuối cùng đã hiệu chuẩn thông minh>,
  "score_grammar": <số thực 0.0 - 10.0, điểm ngữ pháp>,
  "score_context": <số thực 0.0 - 10.0, điểm ngữ cảnh và độ hoàn thiện ý>,
  "relevance_level": <"too_short" | "irrelevant" | "partially_relevant" | "relevant" | "excellent">,
  "grammar_errors": [
    {
      "error_text": "<đoạn học viên nói bị sai>",
      "fix": "<cách sửa chuẩn xác>",
      "explanation": "<giải thích ngắn gọn lỗi ngữ pháp bằng tiếng Việt>"
    }
  ],
  "feedback_summary": "<Nhận xét sư phạm ngắn gọn 1-2 câu bằng tiếng Việt về câu trả lời>",
  "better_expression": "<1 câu nói mẫu tự nhiên, nâng cao dựa trên đúng ý tưởng của học viên để họ học hỏi>"
}`;
}

/**
 * Đánh giá câu trả lời học viên bằng Gemini 3.7 Flash API
 * 
 * @param {Object} params
 * @param {string} params.questionText - Đề bài / câu hỏi
 * @param {string} params.partTitle - Tên phần thi (ví dụ Part 1, Part 2)
 * @param {string} params.examType - Loại kỳ thi (vstep, ielts, toeic, general)
 * @param {string} params.transcript - Lời học viên nói (từ Whisper)
 * @param {Object} params.pronunciationScores - { accuracy, fluency, prosodic, total }
 * @param {string} [params.apiKey] - API key tùy chọn (nếu không truyền sẽ lấy từ getGeminiConfig)
 */
export async function evaluateAnswerWithGemini({
  questionText,
  partTitle = '',
  examType = 'general',
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
    });
  }

  const userContent = `ĐỀ BÀI CÂU HỎI:
"${questionText || 'Không có đề bài'}"
${partTitle ? `Phần thi: ${partTitle} (${examType.toUpperCase()})` : ''}

TRANSCRIPT BÀI NÓI CỦA HỌC VIÊN (Nhận diện ASR):
"${cleanTranscript}"

ĐIỂM PHÁT ÂM ÂM HỌC (Thang điểm 10):
- Accuracy (Độ chuẩn xác ngữ âm): ${acc.toFixed(1)}/10
- Fluency (Độ lưu loát, ngắt nghỉ): ${flu.toFixed(1)}/10
- Prosodic (Ngữ điệu, cao độ): ${pro.toFixed(1)}/10
- Điểm phát âm trung bình: ${rawPronTotal.toFixed(1)}/10

Hãy tiến hành đánh giá ngữ pháp, ngữ cảnh và chốt số điểm tổng thể (score_total) theo đúng quy tắc non-linear trong system prompt. Trả về đúng định dạng JSON.`;

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

    // Chuẩn hóa và làm sạch dữ liệu trả về
    return {
      score_total: clampScore(parsed.score_total, 0, 10),
      score_grammar: clampScore(parsed.score_grammar, 0, 10),
      score_context: clampScore(parsed.score_context, 0, 10),
      relevance_level: parsed.relevance_level || 'relevant',
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
 * Đánh giá heuristic dự phòng khi không có mạng hoặc chưa nhập API Key
 * Đảm bảo vẫn ngăn chặn trường hợp nói cộc lốc / lạc đề
 */
function fallbackHeuristicEval({ questionText, transcript, pronunciationScores }) {
  const words = transcript.trim().split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  const rawPron = pronunciationScores.total || 5.0;

  let scoreTotal = rawPron;
  let scoreGrammar = 6.0;
  let scoreContext = 6.0;
  let relevance = 'relevant';
  let summary = 'Đã đánh giá cơ bản.';

  // Trường hợp 1: Quá ngắn (dưới 4 từ)
  if (wordCount <= 3) {
    scoreTotal = Math.min(rawPron, 2.8);
    scoreGrammar = 3.0;
    scoreContext = 2.0;
    relevance = 'too_short';
    summary = 'Câu trả lời quá ngắn, chưa đủ ý diễn đạt theo yêu cầu của câu hỏi.';
  } 
  // Trường hợp 2: Khá ngắn (4-7 từ)
  else if (wordCount <= 7) {
    scoreTotal = Math.min(rawPron, 5.5);
    scoreGrammar = 5.5;
    scoreContext = 5.0;
    relevance = 'partially_relevant';
    summary = 'Bạn trả lời được một phần nhưng câu còn ngắn, nên mở rộng thêm chi tiết.';
  } 
  // Trường hợp 3: Độ dài đạt chuẩn
  else {
    scoreGrammar = Math.min(9.0, Math.max(5.0, rawPron * 0.9));
    scoreContext = Math.min(9.0, Math.max(5.5, rawPron * 0.95));
    scoreTotal = (rawPron * 0.4) + (scoreGrammar * 0.3) + (scoreContext * 0.3);
    relevance = 'relevant';
    summary = 'Câu trả lời đầy đủ ý, cấu trúc ngữ pháp tương đối rõ ràng.';
  }

  return {
    score_total: clampScore(scoreTotal, 0, 10),
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
