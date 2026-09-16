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
  return `Bạn là Giám khảo Speaking (CEFR/IELTS/VSTEP/TOEIC). Đánh giá bài nói của học viên và trả về DUY NHẤT 1 JSON.

QUY TẮC CHẤM ĐIỂM (NON-LINEAR):
1. Ngữ cảnh là điều kiện tiên quyết (Gatekeeper):
   - Lạc đề (irrelevant) hoặc cộc lốc (1-3 từ): score_context <= 2.5, score_total BẮT BUỘC <= 3.5. Điểm ngữ pháp TUYỆT ĐỐI KHÔNG được kéo điểm tổng lên dù câu đúng ngữ pháp.
   - Đạt một phần (score_context 3.0-4.5): score_total BẮT BUỘC <= 4.5.
   - Đúng trọng tâm (score_context >= 5.0): Ngữ pháp và phát âm phát huy trọn vẹn để nâng điểm tổng (6.0-10.0).
2. Nói vấp / từ đệm / ngập ngừng ban đầu ("um, uh, well, wait..."):
   - Phản xạ tự nhiên, TUYỆT ĐỐI KHÔNG trừ điểm Grammar hay Context nếu câu chính phía sau đúng.
3. Chấm điểm theo Rubric chuyên biệt của từng Dạng bài (Task Type):
   - Luôn tuân thủ tuyệt đối tiêu chí riêng của dạng bài được cấp trong prompt người dùng.
4. Ngữ pháp (score_grammar 0-10): Đánh giá cấu trúc, thì, trật tự từ của câu trả lời chính.
5. Điểm tổng thể (score_total 0-10): Kết hợp Điểm tổng phát âm âm học (gốc từ SpeechOcean) + Ngữ pháp + Ngữ cảnh theo các mức trần trên (TUYỆT ĐỐI KHÔNG tự tính lại hoặc chia trung bình điểm âm học). Tận dụng các chỉ số chi tiết (Acc, Flu, Pro) để nhận xét sâu sắc trong feedback_summary.

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
 * Trả về Rubric khảo thí chuyên biệt ngắn gọn (3-5 dòng) theo từng dạng bài
 * Giúp Gemini chấm chính xác trọng tâm sư phạm mà tiết kiệm tối đa token.
 */
export function getTaskSpecificRubric(taskType = '', examType = '', referenceText = '') {
  const normType = (taskType || '').trim().toLowerCase();

  switch (normType) {
    case 'read_aloud':
      return `- Dạng Đọc to (Read Aloud): Đề bài đã cho sẵn văn bản chuẩn.
- Ngữ pháp & Ngữ cảnh: HOÀN TOÀN KHÔNG ÁP DỤNG (score_grammar = null, score_context = null). Dạng bài này 100% chỉ đánh giá Phát âm và Ngữ điệu âm học, TUYỆT ĐỐI KHÔNG chấm hay đưa ngữ pháp và ngữ cảnh vào tính điểm.
- Điểm tổng (score_total): Giữ nguyên 100% điểm phát âm âm học (Avg).
- Nhận xét: Nhận xét ngắn gọn về ngắt nghỉ đúng cụm nghĩa (pausing), ngữ điệu (intonation), trọng âm từ và nối âm.`;

    case 'picture_description':
      return `- Dạng Miêu tả tranh (Picture Description - PHÂN TÍCH THỊ GIÁC TRỰC TIẾP TỪ ẢNH THẬT):
- Bức ảnh thật của đề thi được đính kèm trực tiếp. AI là chuyên gia thị giác (Vision AI), hãy QUAN SÁT TRỰC TIẾP bức ảnh thật này (TUYỆT ĐỐI KHÔNG dùng hay đòi hỏi mô tả văn bản thủ công từ giáo viên).
- Ngữ cảnh (score_context): Đối chiếu từng chi tiết trong lời nói học viên với các yếu tố THỰC TẾ trong ảnh:
  + Đúng người, hành động, bối cảnh không gian, trang phục, đồ vật, vị trí có thật trong ảnh -> Cho điểm ngữ cảnh cao (8.0 - 10.0).
  + Tả sai sự thật có trong ảnh (nhầm người, bịa đặt đồ vật, nói sai hành động/màu sắc/bối cảnh) -> Trừ điểm score_context và chỉ rõ chi tiết học viên nói sai so với ảnh trong feedback_summary.
- Ngữ pháp (score_grammar): Đánh giá việc sử dụng thì Hiện tại tiếp diễn (is/are + V-ing) khi tả hành động, cụm từ chỉ vị trí không gian (in the foreground/background, on the left/right, next to...) và cấu trúc "There is/are".`;

    case 'short_qa':
      return `- Dạng Trả lời ngắn (Short Q&A):
- Ngữ cảnh: Trả lời trực diện vào câu hỏi cá nhân, sở thích, thói quen (Wh-questions). TUYỆT ĐỐI KHÔNG chỉ trả lời cộc lốc 1-2 từ (Yes/No); yêu cầu mở rộng thêm 1-2 câu giải thích lý do hoặc ví dụ.
- Ngữ pháp: Sử dụng đúng thì Hiện tại đơn, trạng từ chỉ tần suất (always, often, rarely...) và liên từ cơ bản.`;

    case 'information_qa':
      return `- Dạng Trả lời dựa trên thông tin (Information-based Q&A - BẮT BUỘC FACT-CHECKING):
- Ngữ cảnh: ĐỐI CHIẾU TRỰC TIẾP với dữ liệu/lịch trình đã cho. Nếu thí sinh nói sai thời gian, ngày tháng, địa điểm, tên người hoặc chi phí -> BẮT BUỘC trừ nặng score_context <= 4.0.
- Ngữ pháp: Sử dụng chuẩn xác giới từ thời gian/nơi chốn (at, on, in), thì hiện tại hoặc tương lai (will take place, is scheduled at...).`;

    case 'description':
      return `- Dạng Miêu tả chi tiết (Description - Person, Place, Object, Event):
- Ngữ cảnh: Miêu tả sinh động, cụ thể, giàu chi tiết về đối tượng được yêu cầu. Tránh liệt kê khô khan.
- Ngữ pháp: Sử dụng đa dạng tính từ mô tả, mệnh đề quan hệ (who, which, where) và chia thì nhất quán (Hiện tại đơn nếu tả thói quen/đặc điểm, Quá khứ đơn nếu tả sự kiện đã diễn ra).`;

    case 'experience_future':
      return `- Dạng Trải nghiệm / Tương lai (Experience / Future):
- Ngữ pháp: Kiểm soát chính xác thì Quá khứ (Past Simple/Continuous, Present Perfect) khi kể lại trải nghiệm; và thì Tương lai/cấu trúc dự đoán (will, be going to, plan to, would like to) khi nói về kế hoạch.
- Ngữ cảnh: Trình tự thời gian (timeline) rõ ràng, nêu bật cảm xúc, bài học hoặc mục tiêu cá nhân.`;

    case 'opinion':
      return `- Dạng Bày tỏ quan điểm (Opinion):
- Ngữ cảnh: Nêu rõ lập trường/quan điểm dứt khoát ngay từ đầu (I strongly agree/disagree, In my view...). Đưa ra ít nhất 1-2 luận cứ xác đáng kèm ví dụ thực tế minh họa.
- Ngữ pháp: Sử dụng từ nối lập luận và chuyển tiếp (Firstly, Furthermore, In addition, For instance, Therefore...), cấu trúc câu phức logic.`;

    case 'problem_solution':
      return `- Dạng Tình huống & Giải pháp (Problem / Solution):
- Ngữ cảnh: Xác định rõ bản chất vấn đề, đề xuất ít nhất 2 giải pháp khả thi, so sánh ưu/nhược điểm và chọn ra giải pháp tối ưu nhất.
- Ngữ pháp: Sử dụng cấu trúc câu điều kiện (If... then...), động từ khuyết thiếu (should, ought to, must, could), cấu trúc đề xuất giải pháp (I propose, A viable solution would be...).`;

    case 'long_turn':
      return `- Dạng Nói dài / Cue Card (Long Turn):
- Ngữ cảnh: BẮT BUỘC bao quát đầy đủ các gợi ý trong Cue Card (You should say...). Bài nói có cấu trúc 3 phần rõ ràng: Mở bài dẫn dắt - Thân bài phát triển các gợi ý - Kết bài tóm lược. Dung lượng nói đầy đặn, không ngắt quãng quá sớm.
- Ngữ pháp & Từ vựng: Đa dạng cấu trúc câu (phức, ghép, bị động), sử dụng linh hoạt discourse markers (To begin with, Moving on to, Speaking of which, All in all...).`;

    case 'discussion':
      return `- Dạng Thảo luận chuyên sâu (Discussion):
- Ngữ cảnh: Thảo luận vấn đề ở góc nhìn vĩ mô (xã hội, văn hóa, công nghệ, tương lai). Tư duy phản biện đa chiều (nêu cả mặt tích cực và tiêu cực), tránh chỉ nói về bản thân một cách hạn hẹp.
- Ngữ pháp & Từ vựng: Dùng từ vựng học thuật cao cấp (B2/C1), cấu trúc bị động khách quan (It is believed that...), cấu trúc giả định hoặc suy đoán.`;

    default:
      return '';
  }
}

/**
 * Đánh giá câu trả lời học viên bằng Gemini 3.7 Flash API
 * 
 * @param {Object} params
 * @param {string} params.questionText - Đề bài / câu hỏi
 * @param {string} params.partTitle - Tên phần thi (ví dụ Part 1, Part 2)
 * @param {string} params.examType - Loại kỳ thi (vstep, ielts, toeic, general)
 * @param {string} params.taskType - Dạng đề (read_aloud, picture_description, short_qa, ...)
 * @param {string} params.referenceText - Dữ liệu tham khảo / Văn bản gốc / Cue Card
 * @param {string} params.transcript - Lời học viên nói (từ Whisper)
 * @param {Object} params.pronunciationScores - { accuracy, fluency, prosodic, total }
 * @param {string} [params.apiKey] - API key tùy chọn (nếu không truyền sẽ lấy từ getGeminiConfig)
 */
export async function evaluateAnswerWithGemini({
  questionText,
  partTitle = '',
  examType = 'general',
  taskType = '',
  referenceText = '',
  imageUrl = null,
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
  const rawPronTotal = (pronunciationScores.total != null && !isNaN(Number(pronunciationScores.total)))
    ? Number(pronunciationScores.total)
    : 0;

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
      referenceText,
    });
  }

  const isPictureTask = (taskType === 'picture_description') && Boolean(imageUrl);
  const taskTag = taskType ? ` [Dạng bài: ${taskType}]` : '';
  const refTag = referenceText ? `\nDữ liệu tham khảo / Văn bản gốc / Cue Card gợi ý:\n"""\n${referenceText}\n"""` : '';
  const taskRubric = getTaskSpecificRubric(taskType, examType, referenceText);
  const rubricTag = taskRubric ? `\nTIÊU CHÍ KHẢO THÍ DÀNH RIÊNG CHO DẠNG BÀI NÀY:\n${taskRubric}\n` : '';

  const imagePromptNotice = isPictureTask
    ? `\nLƯU Ý THỊ GIÁC: Bức ảnh thật của đề thi được đính kèm ở trên. AI hãy trực tiếp quan sát bức ảnh thật này để đối chiếu chi tiết bài nói của học viên ("${cleanTranscript}") xem có đúng với các đối tượng, hành động, sự vật, bối cảnh thực tế trong tranh hay không (KHÔNG dùng mô tả văn bản thủ công).`
    : '';

  const userContentText = `Đề: "${questionText || 'N/A'}"${partTitle ? ` [${partTitle}]` : ''}${taskTag} [${examType.toUpperCase()}]${refTag}${rubricTag}${imagePromptNotice}
Bài nói học viên: "${cleanTranscript}"
Phát âm âm học (SpeechOcean): Điểm tổng=${rawPronTotal.toFixed(1)}/10 [Chi tiết: Accuracy=${acc.toFixed(1)}, Fluency=${flu.toFixed(1)}, Prosody=${pro.toFixed(1)}]
Đánh giá ngữ pháp, ngữ cảnh theo đúng yêu cầu dạng bài; kết hợp Điểm tổng phát âm với Ngữ pháp & Ngữ cảnh để chốt score_total (KHÔNG tự tính lại điểm âm học); tận dụng các chỉ số Acc, Flu, Pro để nhận xét sư phạm sắc bén trong feedback_summary. Trả về đúng JSON.`;

  // Xây dựng message content: Multimodal (Text + Image) nếu có ảnh, ngược lại String
  let userMessageContent;
  if (isPictureTask) {
    userMessageContent = [
      {
        type: 'text',
        text: userContentText,
      },
      {
        type: 'image_url',
        image_url: {
          url: imageUrl,
        },
      },
    ];
  } else {
    userMessageContent = userContentText;
  }

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
          { role: 'user', content: userMessageContent },
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
    let scoreGrammar = taskType === 'read_aloud' ? null : clampScore(parsed.score_grammar, 0, 10);
    let scoreContext = taskType === 'read_aloud' ? null : clampScore(parsed.score_context, 0, 10);
    const relevanceLevel = taskType === 'read_aloud' ? 'relevant' : (parsed.relevance_level || (scoreContext < 3.0 ? 'irrelevant' : 'relevant'));

    // Hiệu chuẩn điểm tổng thể: Với read_aloud, điểm tổng thuần túy là điểm phát âm âm học
    const scoreTotal = taskType === 'read_aloud'
      ? clampScore(rawPronTotal, 0, 10)
      : calibrateTotalScoreWithContext(parsed.score_total, scoreContext, scoreGrammar, relevanceLevel, taskType);

    return {
      score_total: scoreTotal,
      score_grammar: scoreGrammar, // null đối với read_aloud
      score_context: scoreContext, // null đối với read_aloud
      relevance_level: relevanceLevel,
      grammar_errors: taskType === 'read_aloud' ? [] : (Array.isArray(parsed.grammar_errors) ? parsed.grammar_errors : []),
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
      taskType,
      referenceText,
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
function calibrateTotalScoreWithContext(rawTotal, contextScore, grammarScore, relevanceLevel, taskType = '') {
  let total = Number(rawTotal);
  if (isNaN(total)) total = 5.0;
  const ctx = Number(contextScore) || 0;
  const gram = Number(grammarScore) || 0;

  // Trường hợp đặc thù cho Read Aloud:
  // Ngữ pháp của bài đọc không phải do học viên tạo ra mà là văn bản đề thi
  if (taskType === 'read_aloud') {
    if (relevanceLevel === 'too_short' || ctx < 3.0) {
      return clampScore(Math.min(total, 3.5), 0, 10);
    }
    if (ctx < 5.0 || relevanceLevel === 'partially_relevant') {
      return clampScore(Math.min(total, 5.0), 0, 10);
    }
    // Khi đã đọc đầy đủ văn bản, điểm tổng chính là điểm phát âm âm học
    return clampScore(total, 0, 10);
  }

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
function fallbackHeuristicEval({ questionText, transcript, pronunciationScores, taskType = '', referenceText = '' }) {
  const words = transcript.trim().split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  const rawPron = pronunciationScores.total || 5.0;

  let scoreGrammar = 6.0;
  let scoreContext = 6.0;
  let relevance = 'relevant';
  let summary = 'Đã đánh giá cơ bản theo tiêu chuẩn khảo thí.';

  // Trường hợp đặc thù dạng Read Aloud: chỉ tính điểm phát âm âm học
  if (taskType === 'read_aloud') {
    return {
      score_total: clampScore(rawPron, 0, 10),
      score_grammar: null, // Read Aloud hoàn toàn không tính điểm ngữ pháp
      score_context: null, // Read Aloud hoàn toàn không tính điểm ngữ cảnh
      relevance_level: 'relevant',
      grammar_errors: [],
      feedback_summary: 'Đã hoàn thành đánh giá phát âm đọc to.',
      better_expression: '',
      is_fallback: true,
    };
  }

  // Trường hợp 1: Quá ngắn (dưới 4 từ)
  if (wordCount <= 3) {
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
    // Dạng Long turn yêu cầu nói dài hơn
    if (taskType === 'long_turn' && wordCount < 30) {
      scoreGrammar = Math.min(7.5, Math.max(5.0, rawPron * 0.85));
      scoreContext = 4.5;
      relevance = 'partially_relevant';
      summary = 'Dạng Cue Card / Long Turn yêu cầu bài nói dài và bao quát các ý gợi ý. Bạn nên phát triển thêm chi tiết.';
    } else {
      scoreGrammar = Math.min(9.0, Math.max(5.0, rawPron * 0.9));
      scoreContext = Math.min(9.0, Math.max(5.5, rawPron * 0.95));
      relevance = 'relevant';
      summary = 'Câu trả lời đầy đủ ý, cấu trúc ngữ pháp tương đối rõ ràng.';
    }
  }

  // Nếu ngữ cảnh không phù hợp, điểm ngữ pháp không can thiệp nhiều vào điểm tổng
  let rawCalculatedTotal = (rawPron * 0.4) + (scoreGrammar * 0.3) + (scoreContext * 0.3);
  const scoreTotal = calibrateTotalScoreWithContext(rawCalculatedTotal, scoreContext, scoreGrammar, relevance, taskType);

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

4. Phạm vi đánh giá:
   - Toàn bộ điểm số, nhận xét (conversation_summary), grammar_errors, tips và better_dialogue_expressions CHỈ dành riêng cho Học viên (Student).
   - TUYỆT ĐỐI KHÔNG bắt lỗi, không sửa lỗi, không đưa lời khuyên hay nhận xét tiêu cực cho Giáo viên (Teacher).

OUTPUT JSON FORMAT:
{
  "score_total": <float 0-10>,
  "score_grammar": <float 0-10>,
  "score_context": <float 0-10>,
  "conversation_summary": "<Nhận xét sư phạm 2-3 câu tiếng Việt dành riêng cho Học viên>",
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
  const rawPronTotal = (pronunciationScores.total != null && !isNaN(Number(pronunciationScores.total)))
    ? Number(pronunciationScores.total)
    : 0;

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

ĐIỂM PHÁT ÂM HỌC VIÊN (SpeechOcean): Điểm tổng=${rawPronTotal.toFixed(1)}/10 [Chi tiết: Accuracy=${acc.toFixed(1)}, Fluency=${flu.toFixed(1)}, Prosody=${pro.toFixed(1)}]
Đánh giá toàn diện năng lực hội thoại của Học viên (Student); kết hợp Điểm tổng phát âm với Ngữ pháp & Ngữ cảnh để chốt score_total (KHÔNG tự tính lại điểm âm học); dùng các chỉ số chi tiết để nhận xét sâu sắc. Trả về đúng JSON.`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': effectiveKey,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: model,
        messages: [
          { role: 'system', content: buildDialogueExaminerSystemPrompt() },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.2,
      }),
    }).finally(() => clearTimeout(timeoutId));

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

    // Đảm bảo chỉ giữ lại lỗi ngữ pháp của Học viên
    const rawGrammarErrors = Array.isArray(parsed.grammar_errors) ? parsed.grammar_errors : [];
    const studentGrammarErrors = rawGrammarErrors.filter(ge => {
      if (ge && ge.turn_index != null) {
        const turn = dialogueTurns[ge.turn_index - 1] || dialogueTurns[ge.turn_index];
        if (turn && (turn.role === 'teacher' || turn.speaker === 'Teacher')) {
          return false;
        }
      }
      return true;
    });

    return {
      score_total: scoreTotal,
      score_grammar: scoreGrammar,
      score_context: scoreContext,
      conversation_summary: parsed.conversation_summary || 'Đã hoàn thành đánh giá hội thoại.',
      grammar_errors: studentGrammarErrors,
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
