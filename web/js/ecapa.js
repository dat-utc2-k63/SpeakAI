import { extractFbank } from './fbank.js';

// Đổi version này khi bạn deploy model mới -> tự động bỏ cache cũ
const MODEL_VERSION = 'v1.0';
const MODEL_CACHE_NAME = `ai-models-cache-${MODEL_VERSION}`;

const MODEL_URLS = {
    ecapa: `./models/ecapa.onnx`,
    vad: `./models/silero_vad.onnx`,
};

// Kích thước ước lượng, chỉ dùng để hiện % tiến trình khi chưa biết content-length
const MODEL_SIZE_ESTIMATE = {
    ecapa: 83 * 1024 * 1024,
    vad: 2.2 * 1024 * 1024,
};

let ecapaSession = null;
let sileroVadSession = null;
let initPromise = null;

/**
 * Tải model, ưu tiên lấy từ Cache Storage của trình duyệt (persist qua các lần
 * truy cập / reload). Nếu chưa có, fetch từ mạng, lưu vào cache song song với
 * việc đọc để báo tiến trình, rồi trả về ArrayBuffer cho ONNX Runtime.
 */
async function loadModel(url, onProgress) {
    const cache = await caches.open(MODEL_CACHE_NAME);
    const cached = await cache.match(url);

    if (cached) {
        const blob = await cached.blob();
        onProgress(blob.size, blob.size);
        return URL.createObjectURL(blob);
    }

    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
    }

    // Lưu vào cache song song, không chặn việc đọc progress bên dưới.
    cache.put(url, response.clone()).catch(err => {
        console.warn(`[ModelCache] Không thể lưu cache cho ${url}:`, err);
    });

    const total = Number(response.headers.get('content-length')) || 0;
    const reader = response.body.getReader();
    const chunks = [];
    let loaded = 0;

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded += value.length;
        onProgress(loaded, total);
    }

    // Gộp chunks thành Blob và tạo URL để tránh tràn bộ nhớ ArrayBuffer ở JS
    const blob = new Blob(chunks);
    return URL.createObjectURL(blob);
}

/**
 * Khởi tạo mô hình ONNX (ưu tiên lấy từ cache trình duyệt nếu đã tải trước đó)
 */
export async function initEcapaModel() {
    if (ecapaSession && sileroVadSession) return true;
    if (initPromise) return initPromise;

    initPromise = (async () => {
        try {
            let ecapaLoaded = 0;
            let vadLoaded = 0;
            let ecapaTotal = MODEL_SIZE_ESTIMATE.ecapa;
            let vadTotal = MODEL_SIZE_ESTIMATE.vad;

            const updateProgress = () => {
                const totalLoaded = ecapaLoaded + vadLoaded;
                const totalSize = ecapaTotal + vadTotal;
                const percent = Math.min(Math.round((totalLoaded / totalSize) * 100), 99);

                if (window.updateAiProgress) {
                    window.updateAiProgress(
                        percent,
                        (totalLoaded / 1024 / 1024).toFixed(1),
                        (totalSize / 1024 / 1024).toFixed(1)
                    );
                }
            };

            const [ecapaBlobUrl, vadBlobUrl] = await Promise.all([
                loadModel(MODEL_URLS.ecapa, (loaded, total) => {
                    ecapaLoaded = loaded;
                    if (total) ecapaTotal = total;
                    updateProgress();
                }),
                loadModel(MODEL_URLS.vad, (loaded, total) => {
                    vadLoaded = loaded;
                    if (total) vadTotal = total;
                    updateProgress();
                }),
            ]);

            if (window.updateAiProgress) {
                const totalMB = ((ecapaTotal + vadTotal) / 1024 / 1024).toFixed(1);
                window.updateAiProgress(100, totalMB, totalMB);
            }

            console.log('Initializing InferenceSessions sequentially from Blob URLs...');

            // Khởi tạo tuần tự để tránh khóa (deadlock) bộ nhớ WebAssembly
            const ecapaRes = await ort.InferenceSession.create(ecapaBlobUrl, {
                executionProviders: ['wasm'],
                graphOptimizationLevel: 'all',
            });
            URL.revokeObjectURL(ecapaBlobUrl); // Giải phóng ngay lập tức

            const vadRes = await ort.InferenceSession.create(vadBlobUrl, {
                executionProviders: ['wasm'],
                graphOptimizationLevel: 'all',
            });
            URL.revokeObjectURL(vadBlobUrl);

            ecapaSession = ecapaRes;
            sileroVadSession = vadRes;

            console.log('AI Models loaded successfully!');
            return true;
        } catch (e) {
            console.error('Failed to load AI models:', e);
            throw e;
        } finally {
            initPromise = null;
        }
    })();

    return initPromise;
}

/**
 * Chạy Silero VAD để lọc tiếng ồn
 */
async function runSileroVAD(channelData, sampleRate = 16000) {
    if (!sileroVadSession) return channelData;

    const windowSize = 512;
    const numChunks = Math.floor(channelData.length / windowSize);
    if (numChunks === 0) return channelData;

    let state = new Float32Array(2 * 1 * 128).fill(0);
    const srTensor = new ort.Tensor('int64', new BigInt64Array([BigInt(sampleRate)]), []);

    const cleanAudio = [];
    let keptChunks = 0;

    for (let i = 0; i < numChunks; i++) {
        const chunk = channelData.slice(i * windowSize, (i + 1) * windowSize);
        const inputTensor = new ort.Tensor('float32', chunk, [1, windowSize]);
        const stateTensor = new ort.Tensor('float32', state, [2, 1, 128]);

        const feeds = { input: inputTensor, state: stateTensor, sr: srTensor };

        const results = await sileroVadSession.run(feeds);
        const prob = results.output.data[0];
        state = results.stateN.data;

        if (prob > 0.5) {
            cleanAudio.push(chunk);
            keptChunks++;
        }
    }

    console.log(`Silero VAD: Kept ${keptChunks} / ${numChunks} chunks (${Math.round((keptChunks / numChunks) * 100)}%)`);

    if (cleanAudio.length === 0) {
        console.warn('Silero VAD dropped all audio! Returning original.');
        return channelData;
    }

    const finalAudio = new Float32Array(cleanAudio.length * windowSize);
    for (let i = 0; i < cleanAudio.length; i++) {
        finalAudio.set(cleanAudio[i], i * windowSize);
    }
    return finalAudio;
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

    // 2. Silero VAD: Keep only speech
    let channelData = audioBuffer.getChannelData(0);
    channelData = await runSileroVAD(channelData, 16000);

    // 3. Extract Fbank
    const fbank = extractFbank(channelData, 16000);
    if (fbank.frames === 0) throw new Error('Không phát hiện tiếng nói (hoặc âm lượng quá nhỏ)!');

    // Lặp (tile) hoặc cắt (truncate) frames cho đúng 300 (do lúc export bằng TorchScript bắt buộc shape cố định)
    const TARGET_FRAMES = 300;
    const paddedData = new Float32Array(TARGET_FRAMES * fbank.bins);
    for (let i = 0; i < TARGET_FRAMES; i++) {
        const origFrameIdx = i % fbank.frames; // Lặp lại nếu thiếu
        for (let j = 0; j < fbank.bins; j++) {
            paddedData[i * fbank.bins + j] = fbank.data[origFrameIdx * fbank.bins + j];
        }
    }

    // 4. Chuẩn bị Tensor [1, 300, 80]
    const tensor = new ort.Tensor('float32', paddedData, [1, TARGET_FRAMES, fbank.bins]);

    // 5. Chạy mô hình
    const feeds = { fbank: tensor };
    const results = await ecapaSession.run(feeds);

    return results.embedding.data; // Float32Array(192)
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