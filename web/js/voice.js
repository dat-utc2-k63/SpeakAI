import { supabase } from './supabase.js';

// =========================================================
// VOICE ENROLLMENT MODULE
// =========================================================

// 5 câu ghi âm được define sẵn
export const ENROLLMENT_SENTENCES = [
  "Hello, how are you today?",
  "I am learning English right now.",
  "Good morning to everyone.",
  "Thank you very much.",
  "Goodbye and see you later.",
];

/**
 * Upload audio file lên Supabase Storage
 * @param {string} userId
 * @param {Blob|File} audioBlob
 * @param {string} filename
 */
export async function uploadVoiceSample(userId, audioBlob, filename = 'voice_sample.webm') {
  const path = `voice_samples/${userId}/${filename}`;
  const { error: uploadError } = await supabase.storage
    .from('speakai-audio')
    .upload(path, audioBlob, { upsert: true, contentType: audioBlob.type || 'audio/webm' });
  if (uploadError) throw uploadError;

  const { data: urlData } = supabase.storage.from('speakai-audio').getPublicUrl(path);
  return urlData.publicUrl;
}

/**
 * Đánh dấu user đã enroll giọng thành công
 */
export async function markVoiceEnrolled(userId, voiceUrl) {
  const { error } = await supabase
    .from('profiles')
    .update({ voice_sample_url: voiceUrl, voice_enrolled: true })
    .eq('id', userId);
  if (error) throw error;
}

/**
 * Lấy URL của backend từ Global API
 */
export function getBackendUrl() {
  if (window.globalApiUrl) {
    let url = window.globalApiUrl.trim();
    if (url.endsWith('/')) url = url.slice(0, -1);
    return url;
  }
  return localStorage.getItem('backendUrl') || "https://YOUR_NAMED_TUNNEL_DOMAIN";
}

/**
 * Tính Cosine Similarity giữa 2 vector
 */
export function cosineSimilarity(vecA, vecB) {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Gửi Audio lên Kaggle API để lấy Embedding (ERes2Net)
 */
export async function fetchEmbeddingFromBackend(audioBlob) {
  const backendUrl = getBackendUrl();
  const formData = new FormData();
  formData.append("audio", audioBlob, "voice_sample.wav");
  
  const response = await fetch(`${backendUrl}/extract_embedding`, {
    method: "POST",
    body: formData
  });
  
  if (!response.ok) {
    throw new Error(`Lỗi API Kaggle: ${response.status}`);
  }
  
  const data = await response.json();
  if (!data.success) {
    throw new Error(data.error || "Lỗi trích xuất embedding");
  }
  
  return data.embedding;
}
