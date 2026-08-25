// Minimal JS implementation of STFT and Mel Filterbank for 16kHz audio
// Matches the general shape of SpeechBrain's Fbank: 80 bins, 25ms window, 10ms hop.

export function extractFbank(channelData, sampleRate = 16000) {
    const rawData = channelData;
    
    // 0. Audio Normalization (Chuẩn hóa âm lượng)
    let maxAbs = 0;
    for (let i = 0; i < rawData.length; i++) {
        const abs = Math.abs(rawData[i]);
        if (abs > maxAbs) maxAbs = abs;
    }
    const scale = maxAbs > 0 ? (1.0 / maxAbs) : 1.0;
    const channelData = new Float32Array(rawData.length);
    for (let i = 0; i < rawData.length; i++) {
        channelData[i] = rawData[i] * scale;
    }
    
    const winLength = Math.floor(sampleRate * 0.025); // 400 at 16kHz
    const hopLength = Math.floor(sampleRate * 0.010); // 160 at 16kHz
    const nFft = 512;
    const nMels = 80;
    
    const numFrames = Math.floor((channelData.length - winLength) / hopLength) + 1;
    if (numFrames <= 0) return [];

    // Precompute Povey window (Kaldi default)
    const window = new Float32Array(winLength);
    for (let i = 0; i < winLength; i++) {
        window[i] = Math.pow(0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (winLength - 1)), 0.85);
    }

    // Precompute Mel filterbanks
    const melBands = createMelFilterbank(sampleRate, nFft, nMels, 20, 8000);

    // 1. Calculate energy (RMS) for all frames
    const frameEnergies = new Float32Array(numFrames);
    let maxEnergy = 0;
    for (let i = 0; i < numFrames; i++) {
        const start = i * hopLength;
        let energy = 0;
        for (let j = 0; j < winLength; j++) {
            const val = channelData[start + j];
            energy += val * val;
        }
        energy = Math.sqrt(energy / winLength);
        frameEnergies[i] = energy;
        if (energy > maxEnergy) maxEnergy = energy;
    }

    // Reject audio if it's purely background noise
    if (maxEnergy < 0.01) {
        console.warn("Audio is too quiet, rejecting.");
        return { data: new Float32Array(0), frames: 0, bins: nMels };
    }

    // VAD Threshold: 15% of max energy or 0.015 absolute (whichever is higher)
    // Giúp loại bỏ hoàn toàn tiếng thở, tiếng ồn quạt và khoảng lặng
    const vadThreshold = Math.max(0.015, maxEnergy * 0.15);

    const fbanks = []; // Will be array of [numFrames][80]
    let droppedFrames = 0;

    for (let i = 0; i < numFrames; i++) {
        // Voice Activity Detection (VAD): Drop silent frames
        if (frameEnergies[i] < vadThreshold) {
            droppedFrames++;
            continue; 
        }

        const start = i * hopLength;
        const frame = new Float32Array(nFft);
        
        // 1. Get raw frame and remove DC offset
        const rawFrame = new Float32Array(winLength);
        let frameSum = 0;
        for (let j = 0; j < winLength; j++) {
            rawFrame[j] = channelData[start + j] * 32768.0;
            frameSum += rawFrame[j];
        }
        const mean = frameSum / winLength;
        for (let j = 0; j < winLength; j++) {
            rawFrame[j] -= mean;
        }

        // 2. Apply pre-emphasis (0.97) and window
        for (let j = 0; j < winLength; j++) {
            let current = rawFrame[j];
            let prev = (j > 0) ? rawFrame[j - 1] : current; // Kaldi uses first sample as prev
            let preEmphasized = current - 0.97 * prev;
            frame[j] = preEmphasized * window[j];
        }

        // FFT (Magnitude)
        const magSpec = getMagnitudeSpectrum(frame);

        // Apply Mel Filterbank
        const melFrame = new Float32Array(nMels);
        for (let m = 0; m < nMels; m++) {
            let sum = 0;
            for (let k = 0; k < magSpec.length; k++) {
                sum += magSpec[k] * melBands[m][k];
            }
        // Log10, add small epsilon
            melFrame[m] = Math.log(sum + 1e-6);
        }
        fbanks.push(melFrame);
    }
    
    console.log(`VAD: Dropped ${droppedFrames} silent frames out of ${numFrames}. Kept ${fbanks.length} frames.`);

    // Return as flattened Float32Array
    const flattened = new Float32Array(fbanks.length * nMels);
    for (let i = 0; i < fbanks.length; i++) {
        flattened.set(fbanks[i], i * nMels);
    }

    return { data: flattened, frames: fbanks.length, bins: nMels };
}

function hzToMel(hz) {
    return 2595 * Math.log10(1 + hz / 700);
}

function melToHz(mel) {
    return 700 * (Math.pow(10, mel / 2595) - 1);
}

function createMelFilterbank(sampleRate, nFft, nMels, fMin, fMax) {
    const melMin = hzToMel(fMin);
    const melMax = hzToMel(fMax);
    const melPoints = new Float32Array(nMels + 2);
    for (let i = 0; i < melPoints.length; i++) {
        melPoints[i] = melMin + (i * (melMax - melMin)) / (nMels + 1);
    }

    const hzPoints = new Float32Array(melPoints.length);
    for (let i = 0; i < melPoints.length; i++) {
        hzPoints[i] = melToHz(melPoints[i]);
    }

    const binPoints = new Int32Array(hzPoints.length);
    for (let i = 0; i < hzPoints.length; i++) {
        binPoints[i] = Math.floor(((nFft + 1) * hzPoints[i]) / sampleRate);
    }

    const filters = [];
    for (let m = 1; m <= nMels; m++) {
        const filter = new Float32Array(Math.floor(nFft / 2) + 1);
        const left = binPoints[m - 1];
        const center = binPoints[m];
        const right = binPoints[m + 1];

        for (let k = left; k < center; k++) {
            filter[k] = (k - left) / (center - left);
        }
        for (let k = center; k < right; k++) {
            filter[k] = (right - k) / (right - center);
        }
        filters.push(filter);
    }
    return filters;
}

function getMagnitudeSpectrum(frame) {
    // Basic Radix-2 FFT is complex. We use a simple O(N^2) DFT for small N=512, 
    // or a simple recursive FFT. Here is a simple recursive FFT.
    const N = frame.length;
    
    // Bit reversal
    const outReal = new Float32Array(N);
    const outImag = new Float32Array(N);
    for (let i = 0; i < N; i++) outReal[i] = frame[i];

    let j = 0;
    for (let i = 0; i < N - 1; i++) {
        if (i < j) {
            let tr = outReal[i];
            outReal[i] = outReal[j];
            outReal[j] = tr;
        }
        let m = N >> 1;
        while (m <= j) {
            j -= m;
            m >>= 1;
        }
        j += m;
    }

    // Cooley-Tukey
    for (let size = 2; size <= N; size *= 2) {
        const halfSize = size / 2;
        const tabStep = N / size;
        for (let i = 0; i < N; i += size) {
            for (let k = 0, tab = 0; k < halfSize; k++, tab += tabStep) {
                const angle = (-2 * Math.PI * k) / size;
                const cos = Math.cos(angle);
                const sin = Math.sin(angle);
                
                const tReal = outReal[i + k + halfSize] * cos - outImag[i + k + halfSize] * sin;
                const tImag = outReal[i + k + halfSize] * sin + outImag[i + k + halfSize] * cos;
                
                outReal[i + k + halfSize] = outReal[i + k] - tReal;
                outImag[i + k + halfSize] = outImag[i + k] - tImag;
                outReal[i + k] += tReal;
                outImag[i + k] += tImag;
            }
        }
    }

    // Power spectrum (Kaldi fbank default is use_power=true)
    const powerSpec = new Float32Array(N / 2 + 1);
    for (let i = 0; i < powerSpec.length; i++) {
        powerSpec[i] = (outReal[i] * outReal[i] + outImag[i] * outImag[i]);
    }
    return powerSpec;
}
