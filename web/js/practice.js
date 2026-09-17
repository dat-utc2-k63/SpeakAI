import { supabase } from './supabase.js';

// =========================================================
// PRACTICE & EXAM MODULE — Practice & Mock Test Session Logic
// Supports: General, VSTEP, TOEIC, IELTS modes
// =========================================================

/**
 * Lấy danh sách bộ đề đã publish (cho Student)
 */
export async function fetchPublishedSets() {
  const { data, error } = await supabase
    .from('question_sets')
    .select(`
      id, title, description, level, exam_type, time_limit, created_at,
      teacher:profiles!teacher_id(full_name),
      questions(id)
    `)
    .eq('is_published', true)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(qs => ({
    ...qs,
    exam_type: qs.exam_type || 'general',
    time_limit: qs.time_limit || 0,
    teacher_name: qs.teacher?.full_name || 'N/A',
    question_count: qs.questions ? qs.questions.length : 0,
  }));
}

/**
 * Lấy chi tiết bộ đề + câu hỏi (cho Student khi bắt đầu làm bài)
 */
export async function fetchSetWithQuestions(setId) {
  const { data: setData, error: setError } = await supabase
    .from('question_sets')
    .select('id, title, description, level, exam_type, time_limit')
    .eq('id', setId)
    .single();
  if (setError) throw setError;

  const { data: questions, error: qError } = await supabase
    .from('questions')
    .select('*')
    .eq('set_id', setId)
    .order('order_num', { ascending: true });
  if (qError) throw qError;

  return {
    ...setData,
    exam_type: setData.exam_type || 'general',
    time_limit: setData.time_limit || 0,
    questions: (questions || []).map(q => {
      let tType = q.task_type;
      if (!tType && q.hint && typeof q.hint === 'string' && q.hint.startsWith('__META__:')) {
        try {
          const meta = JSON.parse(q.hint.slice(9));
          if (meta.task_type) tType = meta.task_type;
        } catch (e) {}
      }
      return {
        ...q,
        task_type: tType || 'short_qa',
        prep_time: q.prep_time !== undefined && q.prep_time !== null ? q.prep_time : 15,
        response_time: q.response_time !== undefined && q.response_time !== null ? q.response_time : 45,
      };
    })
  };
}

/**
 * Tạo phiên luyện tập hoặc thi thử mới
 * @param {string} studentId
 * @param {string} setId
 * @param {'practice' | 'exam'} mode
 */
export async function startSession(studentId, setId, mode = 'practice') {
  const { data, error } = await supabase
    .from('practice_sessions')
    .insert({
      student_id: studentId,
      set_id: setId,
      mode: mode || 'practice',
      status: 'in_progress',
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Tìm phiên luyện tập đang dở dang (in_progress) của học viên cho 1 bộ đề
 */
export async function fetchActiveSession(studentId, setId, mode = 'practice') {
  try {
    const { data, error } = await supabase
      .from('practice_sessions')
      .select(`
        id, mode, status, started_at,
        practice_answers (
          id, question_id, audio_url, transcript, score_total, score_accuracy, score_fluency, score_prosodic, score_grammar, score_context, score_lexical, result_json, created_at
        )
      `)
      .eq('student_id', studentId)
      .eq('set_id', setId)
      .eq('mode', mode)
      .eq('status', 'in_progress')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      console.warn('Lỗi kiểm tra phiên làm dở:', error);
      return null;
    }
    return data;
  } catch (e) {
    console.warn('Lỗi fetchActiveSession:', e);
    return null;
  }
}

/**
 * Đóng hoặc kết thúc phiên làm bài cũ (khi người dùng chọn làm lại từ đầu)
 */
export async function cancelSession(sessionId) {
  if (!sessionId) return;
  try {
    await supabase
      .from('practice_sessions')
      .delete()
      .eq('id', sessionId);
  } catch (e) {
    console.warn('Lỗi cancelSession:', e);
  }
}

/**
 * Lưu câu trả lời + điểm cho 1 câu hỏi (tự động cập nhật nếu đã từng làm câu này)
 */
export async function saveAnswer(sessionId, questionId, {
  audio_url,
  transcript,
  score_total,
  score_accuracy,
  score_fluency,
  score_prosodic,
  score_grammar,
  score_context,
  score_lexical,
  result_json
}) {
  // Kiểm tra xem câu hỏi này đã có câu trả lời trong session chưa
  const { data: existing } = await supabase
    .from('practice_answers')
    .select('id')
    .eq('session_id', sessionId)
    .eq('question_id', questionId)
    .maybeSingle();

  const payload = {
    audio_url,
    transcript,
    score_total,
    score_accuracy,
    score_fluency,
    score_prosodic,
    score_grammar: score_grammar != null ? score_grammar : null,
    score_context: score_context != null ? score_context : null,
    score_lexical: score_lexical != null ? score_lexical : null,
    result_json,
  };

  if (existing && existing.id) {
    const { data, error } = await supabase
      .from('practice_answers')
      .update({
        ...payload,
        created_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  const { data, error } = await supabase
    .from('practice_answers')
    .insert({
      session_id: sessionId,
      question_id: questionId,
      ...payload,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Quy đổi điểm trung bình (0 - 10) sang Band điểm chuẩn theo từng kỳ thi
 */
export function calculateBandScore(score10, examType = 'general') {
  const s = Math.max(0, Math.min(10, score10 || 0));
  
  if (examType === 'ielts') {
    // Thang điểm IELTS Speaking Band 0 - 9.0
    let band = 0;
    if (s >= 9.2) band = 9.0;
    else if (s >= 8.5) band = 8.5;
    else if (s >= 7.8) band = 8.0;
    else if (s >= 7.2) band = 7.5;
    else if (s >= 6.5) band = 7.0;
    else if (s >= 5.8) band = 6.5;
    else if (s >= 5.0) band = 6.0;
    else if (s >= 4.2) band = 5.5;
    else if (s >= 3.5) band = 5.0;
    else if (s >= 2.8) band = 4.5;
    else band = 4.0;

    let desc = 'Good User';
    if (band >= 8.0) desc = 'Very Good / Expert';
    else if (band >= 7.0) desc = 'Good User';
    else if (band >= 6.0) desc = 'Competent User';
    else if (band >= 5.0) desc = 'Modest User';
    else desc = 'Limited User';

    return {
      band: `Band ${band.toFixed(1)}`,
      badgeClass: band >= 7.0 ? 'badge-ielts-high' : band >= 6.0 ? 'badge-ielts-mid' : 'badge-ielts-low',
      title: 'IELTS Speaking',
      description: desc,
      rawBand: band
    };
  }

  if (examType === 'vstep') {
    // Chuẩn VSTEP 3 bậc (B1 - B2 - C1 theo Khung năng lực ngoại ngữ 6 bậc Việt Nam)
    // Thang điểm VSTEP Speaking quy đổi từ 0 - 10
    let level = 'A2';
    let desc = 'Sơ cấp (Chưa đạt B1)';
    let badgeClass = 'badge-vstep-a2';

    if (s >= 8.5) {
      level = 'Bậc 5 / C1';
      desc = 'Cao cấp (C1 - Thành thạo)';
      badgeClass = 'badge-vstep-c1';
    } else if (s >= 6.5) {
      level = 'Bậc 4 / B2';
      desc = 'Trung cấp cao (B2 - Đạt chuẩn)';
      badgeClass = 'badge-vstep-b2';
    } else if (s >= 4.0) {
      level = 'Bậc 3 / B1';
      desc = 'Trung cấp (B1 - Đạt chuẩn)';
      badgeClass = 'badge-vstep-b1';
    }

    return {
      band: `VSTEP ${level}`,
      badgeClass,
      title: 'VSTEP Speaking (B1-B2-C1)',
      description: desc,
      rawBand: level
    };
  }

  if (examType === 'toeic') {
    // TOEIC Speaking: thang điểm 0 - 200, 8 levels
    let toeicScore = Math.round((s / 10) * 200);
    // Làm tròn đến bội số của 10
    toeicScore = Math.round(toeicScore / 10) * 10;
    let level = 1;
    let desc = '';

    if (toeicScore >= 190) { level = 8; desc = 'Level 8 (190-200) - Xuất sắc'; }
    else if (toeicScore >= 160) { level = 7; desc = 'Level 7 (160-180) - Tốt'; }
    else if (toeicScore >= 130) { level = 6; desc = 'Level 6 (130-150) - Khá'; }
    else if (toeicScore >= 110) { level = 5; desc = 'Level 5 (110-120) - Trung bình'; }
    else if (toeicScore >= 80) { level = 4; desc = 'Level 4 (80-100) - Cơ bản'; }
    else { level = 3; desc = 'Level 1-3 (0-70) - Cần cải thiện'; }

    return {
      band: `${toeicScore}/200 (Level ${level})`,
      badgeClass: level >= 7 ? 'badge-toeic-high' : level >= 5 ? 'badge-toeic-mid' : 'badge-toeic-low',
      title: 'TOEIC Speaking',
      description: desc,
      rawBand: toeicScore
    };
  }

  // General / Tiếng Anh giao tiếp
  let rank = 'Elementary';
  if (s >= 8.5) rank = 'Advanced (Xuất sắc)';
  else if (s >= 7.0) rank = 'Upper-Intermediate (Tốt)';
  else if (s >= 5.0) rank = 'Intermediate (Khá)';
  else rank = 'Elementary (Cần rèn luyện)';

  return {
    band: `${s.toFixed(1)} / 10`,
    badgeClass: s >= 7.0 ? 'badge-general-high' : s >= 5.0 ? 'badge-general-mid' : 'badge-general-low',
    title: 'Đánh giá chung',
    description: rank,
    rawBand: s
  };
}

/**
 * Hoàn thành phiên luyện tập / thi — tính điểm trung bình & lưu band điểm
 */
export async function completeSession(sessionId, examBand = null) {
  // Lấy tất cả answers
  const { data: answers, error: aErr } = await supabase
    .from('practice_answers')
    .select('score_total, score_accuracy, score_fluency, score_prosodic, score_grammar, score_context, score_lexical')
    .eq('session_id', sessionId);
  if (aErr) throw aErr;

  const count = (answers || []).filter(a => a.score_total != null).length;
  let avgTotal = 0, avgAcc = 0, avgFlu = 0, avgPro = 0, avgGrammar = 0, avgContext = 0, avgLexical = 0;
  let countGrammar = 0, countContext = 0, countLexical = 0;

  if (count > 0) {
    for (const a of answers) {
      avgTotal += a.score_total || 0;
      avgAcc += a.score_accuracy || 0;
      avgFlu += a.score_fluency || 0;
      avgPro += a.score_prosodic || 0;
      if (a.score_grammar != null) {
        avgGrammar += a.score_grammar;
        countGrammar++;
      }
      if (a.score_context != null) {
        avgContext += a.score_context;
        countContext++;
      }
      if (a.score_lexical != null) {
        avgLexical += a.score_lexical;
        countLexical++;
      }
    }
    avgTotal /= count;
    avgAcc /= count;
    avgFlu /= count;
    avgPro /= count;
    avgGrammar = countGrammar > 0 ? (avgGrammar / countGrammar) : 0;
    avgContext = countContext > 0 ? (avgContext / countContext) : 0;
    avgLexical = countLexical > 0 ? (avgLexical / countLexical) : 0;
  }

  const updates = {
    status: 'completed',
    score_total: avgTotal,
    score_accuracy: avgAcc,
    score_fluency: avgFlu,
    score_prosodic: avgPro,
    score_grammar: avgGrammar > 0 ? avgGrammar : null,
    score_context: avgContext > 0 ? avgContext : null,
    score_lexical: avgLexical > 0 ? avgLexical : null,
    completed_at: new Date().toISOString(),
  };

  if (examBand) {
    updates.exam_band = examBand;
  }

  const { error } = await supabase
    .from('practice_sessions')
    .update(updates)
    .eq('id', sessionId);
  if (error) throw error;

  return {
    score_total: avgTotal,
    score_accuracy: avgAcc,
    score_fluency: avgFlu,
    score_prosodic: avgPro,
    score_grammar: avgGrammar,
    score_context: avgContext,
    score_lexical: avgLexical,
    exam_band: examBand,
  };
}

/**
 * Lấy lịch sử luyện tập / thi của student
 */
export async function fetchSessionHistory(studentId) {
  const { data, error } = await supabase
    .from('practice_sessions')
    .select(`
      id, mode, status, score_total, score_accuracy, score_fluency, score_prosodic, score_grammar, score_context, score_lexical, exam_band,
      started_at, completed_at,
      question_set:question_sets(id, title, level, exam_type)
    `)
    .eq('student_id', studentId)
    .eq('status', 'completed')
    .order('completed_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

/**
 * Lấy chi tiết 1 phiên luyện tập / thi (gồm câu trả lời)
 */
export async function fetchSessionDetail(sessionId) {
  const { data: session, error: sErr } = await supabase
    .from('practice_sessions')
    .select(`
      id, mode, status, score_total, score_accuracy, score_fluency, score_prosodic, score_grammar, score_context, score_lexical, exam_band,
      started_at, completed_at,
      question_set:question_sets(id, title, level, exam_type, description)
    `)
    .eq('id', sessionId)
    .single();
  if (sErr) throw sErr;

  const { data: answers, error: aErr } = await supabase
    .from('practice_answers')
    .select(`
      id, audio_url, transcript, score_total, score_accuracy, score_fluency, score_prosodic, score_grammar, score_context, score_lexical, result_json, created_at,
      question:questions(id, order_num, part_title, question_text, prep_time, response_time)
    `)
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true });
  if (aErr) throw aErr;

  return { ...session, answers: answers || [] };
}

/**
 * Upload audio luyện tập / thi lên Supabase Storage
 */
export async function uploadPracticeAudio(studentId, audioBlob, filename) {
  const path = `practice/${studentId}/${Date.now()}_${filename}`;
  const { error } = await supabase.storage
    .from('speakai-audio')
    .upload(path, audioBlob, { upsert: false, contentType: audioBlob.type || 'audio/webm' });
  if (error) throw error;
  const { data: urlData } = supabase.storage.from('speakai-audio').getPublicUrl(path);
  return urlData.publicUrl;
}

/**
 * Voice Activity Detection (VAD) client-side sử dụng Web Audio API.
 * Phân tích năng lượng âm thanh (Short-Time RMS & Peak Amplitude) để xác định
 * có tiếng người nói thực sự hay không trước khi gửi sang mô hình Whisper.
 *
 * @param {Blob} audioBlob - Dữ liệu audio ghi âm từ MediaRecorder
 * @param {Object} [options]
 * @param {number} [options.minSpeechDuration=0.35] - Tổng thời lượng tiếng nói tối thiểu (giây)
 * @param {number} [options.speechRmsThreshold=0.012] - Ngưỡng RMS xác định frame có tiếng người
 * @param {number} [options.minPeakAmp=0.025] - Biên độ đỉnh tối thiểu của toàn bộ file
 * @returns {Promise<{hasVoice: boolean, speechDurationSec: number, totalDurationSec: number, maxRms: number, avgRms: number, peakAmp: number, reason: string}>}
 */
export async function detectVoiceActivity(audioBlob, options = {}) {
  const minSpeechDuration = options.minSpeechDuration ?? 0.35;
  const speechRmsThreshold = options.speechRmsThreshold ?? 0.012;
  const minPeakAmp = options.minPeakAmp ?? 0.025;

  if (!audioBlob || audioBlob.size === 0) {
    return { hasVoice: false, speechDurationSec: 0, totalDurationSec: 0, maxRms: 0, avgRms: 0, peakAmp: 0, reason: 'File ghi âm rỗng' };
  }

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    return { hasVoice: true, speechDurationSec: 1.0, totalDurationSec: 1.0, maxRms: 0.1, avgRms: 0.05, peakAmp: 0.1, reason: 'Web Audio API không hỗ trợ, cho phép pass' };
  }

  const audioCtx = new AudioContextClass();
  try {
    const arrayBuffer = await audioBlob.arrayBuffer();
    const audioBuffer = await new Promise((resolve, reject) => {
      audioCtx.decodeAudioData(arrayBuffer, resolve, reject);
    });

    const sampleRate = audioBuffer.sampleRate;
    const totalDurationSec = audioBuffer.duration;

    if (totalDurationSec < 0.4) {
      return {
        hasVoice: false,
        speechDurationSec: 0,
        totalDurationSec: Number(totalDurationSec.toFixed(2)),
        maxRms: 0,
        avgRms: 0,
        peakAmp: 0,
        reason: 'Thời lượng ghi âm quá ngắn (< 0.4s)'
      };
    }

    const channelData = audioBuffer.getChannelData(0);
    const frameSamples = Math.floor(sampleRate * 0.025); // 25ms
    const hopSamples = Math.floor(sampleRate * 0.010);   // 10ms
    const hopSec = hopSamples / sampleRate;

    let speechFrames = 0;
    let totalFrames = 0;
    let maxRms = 0;
    let sumRms = 0;
    let peakAmp = 0;

    for (let i = 0; i <= channelData.length - frameSamples; i += hopSamples) {
      let sumSq = 0;
      for (let j = 0; j < frameSamples; j++) {
        const s = channelData[i + j];
        sumSq += s * s;
        const absVal = Math.abs(s);
        if (absVal > peakAmp) peakAmp = absVal;
      }
      const rms = Math.sqrt(sumSq / frameSamples);
      if (rms > maxRms) maxRms = rms;
      sumRms += rms;
      totalFrames++;

      if (rms >= speechRmsThreshold) {
        speechFrames++;
      }
    }

    const avgRms = totalFrames > 0 ? sumRms / totalFrames : 0;
    const speechDurationSec = speechFrames * hopSec;

    const hasVoice = (peakAmp >= minPeakAmp) &&
                     (maxRms >= speechRmsThreshold * 1.25) &&
                     (speechDurationSec >= minSpeechDuration);

    let reason = hasVoice ? 'Phát hiện giọng nói hợp lệ' : 'Không phát hiện giọng nói';
    if (!hasVoice) {
      if (peakAmp < minPeakAmp) {
        reason = 'Âm lượng mic quá nhỏ hoặc micro bị tắt tiếng (mute)';
      } else if (speechDurationSec < minSpeechDuration) {
        reason = `Thời lượng tiếng người quá ngắn (${speechDurationSec.toFixed(2)}s)`;
      } else {
        reason = 'Năng lượng âm thanh dưới ngưỡng giọng nói người';
      }
    }

    return {
      hasVoice,
      speechDurationSec: Number(speechDurationSec.toFixed(2)),
      totalDurationSec: Number(totalDurationSec.toFixed(2)),
      maxRms: Number(maxRms.toFixed(4)),
      avgRms: Number(avgRms.toFixed(4)),
      peakAmp: Number(peakAmp.toFixed(4)),
      reason
    };
  } catch (err) {
    console.warn('[VAD] Lỗi giải mã audio buffer, cho phép bỏ qua VAD:', err);
    return { hasVoice: true, speechDurationSec: 1.0, totalDurationSec: 1.0, maxRms: 0.1, avgRms: 0.05, peakAmp: 0.1, reason: 'Lỗi giải mã audio' };
  } finally {
    try {
      await audioCtx.close();
    } catch (_) {}
  }
}

/**
 * Gọi API backend để chấm điểm phát âm 1 câu
 */
export async function assessSingleAnswer(apiUrl, audioBlob, studentEmbeddings, options = {}) {
  const formData = new FormData();
  formData.append('audio', audioBlob, 'practice_answer.webm');
  formData.append('teacher_embeddings_json', JSON.stringify(studentEmbeddings || []));
  formData.append('student_embeddings_json', JSON.stringify(studentEmbeddings || []));
  formData.append('score_teacher', 'false');
  formData.append('skip_feedback', 'true');
  formData.append('diarize', 'false');
  if (options.taskType) {
    formData.append('task_type', options.taskType);
  }
  if (options.referenceText) {
    formData.append('reference_text', options.referenceText);
  }

  const startRes = await fetch(`${apiUrl.replace(/\/$/, '')}/assess_start`, {
    method: 'POST',
    body: formData,
  });
  if (!startRes.ok) throw new Error(`API Error: ${startRes.status}`);

  const startData = await startRes.json();
  if (!startData.success) throw new Error(startData.error || 'API Error');

  const taskId = startData.task_id;

  // Poll for result
  while (true) {
    await new Promise(r => setTimeout(r, 2000));
    const statusRes = await fetch(`${apiUrl.replace(/\/$/, '')}/assess_status/${taskId}`);
    if (!statusRes.ok) throw new Error('Network error polling status');
    const statusData = await statusRes.json();
    if (!statusData.success) throw new Error(statusData.error || 'Status error');

    const task = statusData.data;
    if (task.status === 'completed') {
      return task.result;
    }
    if (task.status === 'error') {
      throw new Error(task.error || 'Assessment error');
    }
  }
}

/**
 * Lấy lịch sử của học viên thuộc teacher
 */
export async function fetchStudentPracticeSessions(studentId) {
  const { data, error } = await supabase
    .from('practice_sessions')
    .select(`
      id, mode, status, score_total, score_accuracy, score_fluency, score_prosodic, score_grammar, score_context, score_lexical, exam_band,
      started_at, completed_at,
      question_set:question_sets(id, title, level, exam_type),
      student:profiles!student_id(full_name)
    `)
    .eq('student_id', studentId)
    .eq('status', 'completed')
    .order('started_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

/**
 * Âm thanh hiệu lệnh phát bằng Web Audio API (không cần tải file ngoài)
 */
let audioCtx = null;
function getAudioContext() {
  if (!audioCtx) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) audioCtx = new AudioContext();
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

export function playBeep(freq = 880, duration = 0.2, type = 'sine') {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  } catch (e) {
    console.warn('Audio Beep not supported:', e);
  }
}

export function playStartTone() {
  // Beep đôi cao vang báo hiệu bắt đầu nói
  playBeep(880, 0.15);
  setTimeout(() => playBeep(1174, 0.25), 180);
}

export function playEndTone() {
  // Âm trầm báo hiệu hết giờ
  playBeep(440, 0.35, 'triangle');
}
