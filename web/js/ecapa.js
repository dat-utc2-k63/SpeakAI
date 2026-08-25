import { extractFbank } from './fbank.js';

let ecapaSession = null;
let sileroVadSession = null;
let initPromise = null;

async function downloadModelWithProgress(url, onProgress) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', url, true);
        xhr.responseType = 'arraybuffer';
        
        xhr.onprogress = (event) => {
            if (event.lengthComputable) {
                if (onProgress) onProgress(event.loaded, event.total);
            } else {
                // Nếu server không trả về Content-Length (fallback)
                if (onProgress) onProgress(event.loaded, 0);
            }
        };
        
        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                resolve(xhr.response);
            } else {
                reject(new Error(`Failed to load ${url}: ${xhr.statusText}`));
            }
        };
        
        xhr.onerror = () => reject(new Error(`Network error while downloading ${url}`));
        xhr.send();
    });
}

/**
 * Khởi tạo mô hình ONNX
 */
export async function initEcapaModel() {
    if (ecapaSession) return true;
    if (initPromise) return initPromise;
    
    initPromise = (async () => {
        try {
            console.log("Downloading ECAPA and Silero VAD ONNX models...");
            let ecapaLoaded = 0;
            let vadLoaded = 0;
            let ecapaTotal = 83 * 1024 * 1024; // fallback size
            let vadTotal = 2.2 * 1024 * 1024;
            
            const updateProgress = () => {
                const totalLoaded = ecapaLoaded + vadLoaded;
                const totalSize = ecapaTotal + vadTotal;
                const percent = Math.round((totalLoaded / totalSize) * 100);
                const loadedMB = (totalLoaded / 1024 / 1024).toFixed(1);
                const totalMB = (totalSize / 1024 / 1024).toFixed(1);
                
                if (window.updateAiProgress) {
                    window.updateAiProgress(Math.min(percent, 99), loadedMB, totalMB);
                }
            };

            const [ecapaBuffer, vadBuffer] = await Promise.all([
                downloadModelWithProgress('./models/ecapa.onnx', (loaded, total) => {
                    ecapaLoaded = loaded;
                    if (total) ecapaTotal = total;
                    updateProgress();
                }),
                downloadModelWithProgress('./models/silero_vad.onnx', (loaded, total) => {
                    vadLoaded = loaded;
                    if (total) vadTotal = total;
                    updateProgress();
                })
            ]);
            
            if (window.updateAiProgress) window.updateAiProgress(100, 85.2, 85.2);
            
            console.log("Initializing InferenceSessions from memory sequentially...");
            
            // Khởi tạo từng model tuần tự để tránh quá tải bộ nhớ WebAssembly
            const ecapaRes = await ort.InferenceSession.create(ecapaBuffer, {
                executionProviders: ['wasm'],
                graphOptimizationLevel: 'all'
            });
            
            const vadRes = await ort.InferenceSession.create(vadBuffer, {
                executionProviders: ['wasm'],
                graphOptimizationLevel: 'all'
            });
            
            ecapaSession = ecapaRes;
            sileroVadSession = vadRes;
            
            console.log("AI Models loaded successfully!");
            return true;
        } catch (e) {
            console.error("Failed to load AI models:", e);
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
        
        const feeds = {
            input: inputTensor,
            state: stateTensor,
            sr: srTensor
        };
        
        const results = await sileroVadSession.run(feeds);
        const prob = results.output.data[0];
        state = results.stateN.data;
        
        if (prob > 0.5) {
            cleanAudio.push(chunk);
            keptChunks++;
        }
    }
    
    console.log(`Silero VAD: Kept ${keptChunks} / ${numChunks} chunks (${Math.round(keptChunks/numChunks*100)}%)`);
    if (cleanAudio.length === 0) {
        console.warn("Silero VAD dropped all audio! Returning original.");
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
