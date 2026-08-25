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
