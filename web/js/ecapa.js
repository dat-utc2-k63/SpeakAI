import { extractFbank } from './fbank.js';

let ecapaSession = null;
let initPromise = null;

/**
 * Khởi tạo mô hình ONNX
 */
export async function initEcapaModel() {
    if (ecapaSession) return true;
    if (initPromise) return initPromise;
    
    initPromise = (async () => {
        try {
            console.log("Loading ECAPA ONNX model...");
            // This expects ecapa.onnx to be in /models/ecapa.onnx
            ecapaSession = await ort.InferenceSession.create('./models/ecapa.onnx', {
                executionProviders: ['wasm'],
                graphOptimizationLevel: 'all'
            });
            console.log("ECAPA ONNX model loaded successfully!");
            return true;
        } catch (e) {
            console.error("Failed to load ECAPA ONNX model:", e);
            throw e;
        } finally {
            initPromise = null;
        }
    })();
    
    return initPromise;
}

/**
 * Trích xuất Embedding từ Blob Audio
 */
export async function getEmbedding(audioBlob) {
    if (!ecapaSession) {
        await initEcapaModel();
    }

    // 1. Decode Audio to 16kHz AudioBuffer
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
    const arrayBuffer = await audioBlob.arrayBuffer();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

    // 2. Extract Fbank
    const fbank = extractFbank(audioBuffer);
    if (fbank.frames === 0) throw new Error("Không phát hiện tiếng nói (hoặc âm lượng quá nhỏ)!");

    // Lặp (tile) hoặc cắt (truncate) frames cho đúng 300 (do lúc export bằng TorchScript bắt buộc shape cố định)
    const TARGET_FRAMES = 300;
    const paddedData = new Float32Array(TARGET_FRAMES * fbank.bins);
    for (let i = 0; i < TARGET_FRAMES; i++) {
        const origFrameIdx = i % fbank.frames; // Lặp lại nếu thiếu
        for (let j = 0; j < fbank.bins; j++) {
            paddedData[i * fbank.bins + j] = fbank.data[origFrameIdx * fbank.bins + j];
        }
    }

    // 3. Chuẩn bị Tensor [1, 300, 80]
    const tensor = new ort.Tensor('float32', paddedData, [1, TARGET_FRAMES, fbank.bins]);

    // 4. Chạy mô hình
    const feeds = { fbank: tensor }; // The input name in ONNX is 'fbank'
    const results = await ecapaSession.run(feeds);
    
    const embedding = results.embedding.data; // Float32Array(192)
    return embedding;
}

/**
 * Tính Cosine Similarity giữa 2 vectors
 */
export function cosineSimilarity(vecA, vecB) {
    if (vecA.length !== vecB.length) return 0;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < vecA.length; i++) {
        dot += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
