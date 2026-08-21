/**
 * WaveParty Audio Engine
 * Web Audio API 合成器，支持：
 *  - 多种波形 (sine, square, sawtooth, triangle)
 *  - 自定义 ADSR 包络（由贝塞尔曲线生成）
 *  - 自定义音色（PeriodicWave 谐波）
 *  - 每轨道独立 GainNode + StereoPanner
 */

window.AudioEngine = (function () {
    'use strict';

    const SAMPLE_RATE = 44100;

    let ctx = null;
    let masterGain = null;
    let analyserNode = null;
    // Map: trackId -> { gainNode, panNode, vuData }
    const trackNodes = new Map();
    // Currently playing notes: Map<noteKey, { osc, envGain, scheduled }>
    const activeNotes = new Map();
    // Spectrogram pre-rendered buffers: Map<trackId, { buffer, baseFreq }>
    const spectrogramBuffers = new Map();
    // Imported audio sample buffers: Map<trackId, { buffer, baseFreq, fileName }>
    const sampleBuffers = new Map();

    // ===== Drum Synthesizer =====
    let _drumNoiseBuf = null;
    function _getDrumNoiseBuf() {
        if (_drumNoiseBuf) return _drumNoiseBuf;
        ensureContext();
        const len = SAMPLE_RATE * 2;
        const buf = ctx.createBuffer(1, len, SAMPLE_RATE);
        const d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        _drumNoiseBuf = buf;
        return buf;
    }

    function playDrumNote(trackId, midiNote, instrument, duration) {
        ensureContext();
        const t = ctx.currentTime;
        const dur = duration || 0.3;
        const track = getOrCreateTrackNodes(trackId);
        // Kick: 36/35
        if (midiNote === 36 || midiNote === 35) {
            const o = ctx.createOscillator();
            const g = ctx.createGain();
            o.type = 'sine';
            o.frequency.setValueAtTime(160, t);
            o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
            g.gain.setValueAtTime(1.0, t);
            g.gain.exponentialRampToValueAtTime(0.001, t + Math.max(dur, 0.3));
            o.connect(g); g.connect(track.gainNode);
            o.start(t); o.stop(t + Math.max(dur, 0.35));
            return;
        }
        // Snare: 38/40
        if (midiNote === 38 || midiNote === 40) {
            const nBuf = _getDrumNoiseBuf();
            // noise
            const ns = ctx.createBufferSource(); ns.buffer = nBuf;
            const nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 3000; nf.Q.value = 1.5;
            const ng = ctx.createGain();
            ns.connect(nf); nf.connect(ng); ng.connect(track.gainNode);
            ng.gain.setValueAtTime(0.8, t);
            ng.gain.exponentialRampToValueAtTime(0.001, t + Math.min(dur, 0.2));
            ns.start(t); ns.stop(t + Math.min(dur, 0.25) + 0.05);
            // body
            const o = ctx.createOscillator();
            const og = ctx.createGain();
            o.type = 'triangle';
            o.frequency.setValueAtTime(200, t);
            o.frequency.exponentialRampToValueAtTime(100, t + 0.08);
            og.gain.setValueAtTime(0.6, t);
            og.gain.exponentialRampToValueAtTime(0.001, t + Math.min(dur, 0.15));
            o.connect(og); og.connect(track.gainNode);
            o.start(t); o.stop(t + Math.min(dur, 0.2) + 0.05);
            return;
        }
        // Hi-hat: 42(closed) / 46(open)
        if (midiNote === 42 || midiNote === 46) {
            const nBuf = _getDrumNoiseBuf();
            const isOpen = midiNote === 46;
            const ns = ctx.createBufferSource(); ns.buffer = nBuf;
            const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7000;
            const g = ctx.createGain();
            ns.connect(hp); hp.connect(g); g.connect(track.gainNode);
            const vol = isOpen ? 0.35 : 0.25;
            const hd = isOpen ? Math.min(dur, 0.4) : Math.min(dur, 0.08);
            g.gain.setValueAtTime(vol, t);
            g.gain.exponentialRampToValueAtTime(0.001, t + hd);
            ns.start(t); ns.stop(t + hd + 0.05);
            return;
        }
        // Tom: 41/43/45/47-50
        if (midiNote >= 41 && midiNote <= 50) {
            const freqMap = { 41:130, 43:110, 45:90, 47:70, 48:60, 50:50 };
            const freq = freqMap[midiNote] || 100;
            const o = ctx.createOscillator();
            const g = ctx.createGain();
            o.type = 'sine';
            o.frequency.setValueAtTime(freq * 2, t);
            o.frequency.exponentialRampToValueAtTime(freq, t + 0.06);
            g.gain.setValueAtTime(0.8, t);
            g.gain.exponentialRampToValueAtTime(0.001, t + Math.min(dur, 0.3));
            o.connect(g); g.connect(track.gainNode);
            o.start(t); o.stop(t + Math.min(dur, 0.35) + 0.05);
            return;
        }
        // Cymbal/Ride: 49/51/52/57
        if (midiNote === 49 || midiNote === 51 || midiNote === 52 || midiNote === 57) {
            const nBuf = _getDrumNoiseBuf();
            const ns = ctx.createBufferSource(); ns.buffer = nBuf;
            const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 5000;
            const g = ctx.createGain();
            ns.connect(hp); hp.connect(g); g.connect(track.gainNode);
            g.gain.setValueAtTime(0.3, t);
            g.gain.exponentialRampToValueAtTime(0.001, t + Math.min(dur, 0.6));
            ns.start(t); ns.stop(t + Math.min(dur, 0.65) + 0.05);
            return;
        }
        // fallback
        const freq = 100 + (midiNote - 36) * 20;
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'sine'; o.frequency.value = freq;
        o.connect(g); g.connect(track.gainNode);
        g.gain.setValueAtTime(0.5, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + Math.min(dur, 0.15));
        o.start(t); o.stop(t + Math.min(dur, 0.2) + 0.05);
    }

    function scheduleDrumNote(trackId, midiNote, instrument, startAudioTime, durationSec) {
        ensureContext();
        const t = startAudioTime;
        const dur = durationSec || 0.3;
        const track = getOrCreateTrackNodes(trackId);
        // Kick: 36/35
        if (midiNote === 36 || midiNote === 35) {
            const o = ctx.createOscillator();
            const g = ctx.createGain();
            o.type = 'sine';
            o.frequency.setValueAtTime(160, t);
            o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
            g.gain.setValueAtTime(1.0, t);
            g.gain.exponentialRampToValueAtTime(0.001, t + Math.max(dur, 0.3));
            o.connect(g); g.connect(track.gainNode);
            o.start(t); o.stop(t + Math.max(dur, 0.35));
            return;
        }
        // Snare: 38/40
        if (midiNote === 38 || midiNote === 40) {
            const nBuf = _getDrumNoiseBuf();
            const ns = ctx.createBufferSource(); ns.buffer = nBuf;
            const nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 3000; nf.Q.value = 1.5;
            const ng = ctx.createGain();
            ns.connect(nf); nf.connect(ng); ng.connect(track.gainNode);
            ng.gain.setValueAtTime(0.8, t);
            ng.gain.exponentialRampToValueAtTime(0.001, t + Math.min(dur, 0.2));
            ns.start(t); ns.stop(t + Math.min(dur, 0.25) + 0.05);
            const o = ctx.createOscillator();
            const og = ctx.createGain();
            o.type = 'triangle';
            o.frequency.setValueAtTime(200, t);
            o.frequency.exponentialRampToValueAtTime(100, t + 0.08);
            og.gain.setValueAtTime(0.6, t);
            og.gain.exponentialRampToValueAtTime(0.001, t + Math.min(dur, 0.15));
            o.connect(og); og.connect(track.gainNode);
            o.start(t); o.stop(t + Math.min(dur, 0.2) + 0.05);
            return;
        }
        // Hi-hat: 42/46
        if (midiNote === 42 || midiNote === 46) {
            const nBuf = _getDrumNoiseBuf();
            const isOpen = midiNote === 46;
            const ns = ctx.createBufferSource(); ns.buffer = nBuf;
            const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7000;
            const g = ctx.createGain();
            ns.connect(hp); hp.connect(g); g.connect(track.gainNode);
            const vol = isOpen ? 0.35 : 0.25;
            const hd = isOpen ? Math.min(dur, 0.4) : Math.min(dur, 0.08);
            g.gain.setValueAtTime(vol, t);
            g.gain.exponentialRampToValueAtTime(0.001, t + hd);
            ns.start(t); ns.stop(t + hd + 0.05);
            return;
        }
        // Tom: 41-50
        if (midiNote >= 41 && midiNote <= 50) {
            const freqMap = { 41:130, 43:110, 45:90, 47:70, 48:60, 50:50 };
            const freq = freqMap[midiNote] || 100;
            const o = ctx.createOscillator();
            const g = ctx.createGain();
            o.type = 'sine';
            o.frequency.setValueAtTime(freq * 2, t);
            o.frequency.exponentialRampToValueAtTime(freq, t + 0.06);
            g.gain.setValueAtTime(0.8, t);
            g.gain.exponentialRampToValueAtTime(0.001, t + Math.min(dur, 0.3));
            o.connect(g); g.connect(track.gainNode);
            o.start(t); o.stop(t + Math.min(dur, 0.35) + 0.05);
            return;
        }
        // Cymbal/Ride: 49/51/52/57
        if (midiNote === 49 || midiNote === 51 || midiNote === 52 || midiNote === 57) {
            const nBuf = _getDrumNoiseBuf();
            const ns = ctx.createBufferSource(); ns.buffer = nBuf;
            const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 5000;
            const g = ctx.createGain();
            ns.connect(hp); hp.connect(g); g.connect(track.gainNode);
            g.gain.setValueAtTime(0.3, t);
            g.gain.exponentialRampToValueAtTime(0.001, t + Math.min(dur, 0.6));
            ns.start(t); ns.stop(t + Math.min(dur, 0.65) + 0.05);
            return;
        }
        // fallback
        const freq = 100 + (midiNote - 36) * 20;
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'sine'; o.frequency.value = freq;
        o.connect(g); g.connect(track.gainNode);
        g.gain.setValueAtTime(0.5, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + Math.min(dur, 0.15));
        o.start(t); o.stop(t + Math.min(dur, 0.2) + 0.05);
    }

    function ensureContext() {
        if (!ctx) {
            ctx = new (window.AudioContext || window.webkitAudioContext)();
            masterGain = ctx.createGain();
            masterGain.gain.value = 0.8;
            analyserNode = ctx.createAnalyser();
            analyserNode.fftSize = 256;
            masterGain.connect(analyserNode);
            analyserNode.connect(ctx.destination);
        }
        if (ctx.state === 'suspended') ctx.resume();
        return ctx;
    }

    function getOrCreateTrackNodes(trackId) {
        if (trackNodes.has(trackId)) return trackNodes.get(trackId);
        ensureContext();
        const gain = ctx.createGain();
        gain.gain.value = 0.75;
        const pan = ctx.createStereoPanner();
        pan.pan.value = 0;
        gain.connect(pan);
        pan.connect(masterGain);
        const node = { gainNode: gain, panNode: pan };
        trackNodes.set(trackId, node);
        return node;
    }

    /** 删除轨道时清理相关音频节点 */
    function removeTrackNodes(trackId) {
        const node = trackNodes.get(trackId);
        if (node) {
            try { node.gainNode.disconnect(); } catch (e) { /* ignore */ }
            try { node.panNode.disconnect(); } catch (e) { /* ignore */ }
            trackNodes.delete(trackId);
        }
        // 清理预渲染的语谱图 buffer
        if (spectrogramBuffers.has(trackId)) {
            spectrogramBuffers.delete(trackId);
        }
        // 清理导入的音频采样 buffer
        if (sampleBuffers.has(trackId)) {
            sampleBuffers.delete(trackId);
        }
    }

    /**
     * Build PeriodicWave from a timbre curve.
     * curve: Float32Array or array of values [0..1], length = harmonics count
     */
    function buildPeriodicWave(timbrecurve) {
        ensureContext();
        const N = Math.min(timbrecurve.length, 32);
        const real = new Float32Array(N + 1);
        const imag = new Float32Array(N + 1);
        real[0] = 0;
        for (let i = 0; i < N; i++) {
            // Odd harmonics more weight for interesting timbres
            real[i + 1] = timbrecurve[i] * (1 / (i + 1));
        }
        return ctx.createPeriodicWave(real, imag, { disableNormalization: false });
    }

    /**
     * Apply ADSR envelope to gain node
     * adsr: { attack, decay, sustain, release } in seconds
     * Curves: attackCurve[], decayCurve[] are optional arrays [0..1] for setValueCurveAtTime
     */
    function applyEnvelope(gainNode, adsr, startTime) {
        const g = gainNode.gain;
        const A = Math.max(0.001, adsr.attack);
        const D = Math.max(0.001, adsr.decay);
        const S = Math.max(0, Math.min(1, adsr.sustain));
        const R = Math.max(0.001, adsr.release);

        g.cancelScheduledValues(startTime);
        g.setValueAtTime(0, startTime);

        if (adsr.attackCurve && adsr.attackCurve.length > 1) {
            const curve = new Float32Array(adsr.attackCurve);
            g.setValueCurveAtTime(curve, startTime, A);
        } else {
            g.linearRampToValueAtTime(1.0, startTime + A);
        }

        if (adsr.decayCurve && adsr.decayCurve.length > 1) {
            const curve = new Float32Array(adsr.decayCurve.map(v => v * (1 - S) + S * (1 - v) + S * v));
            // decay from 1 to S
            const decayCurve = new Float32Array(adsr.decayCurve.map(v => 1 - v * (1 - S)));
            g.setValueCurveAtTime(decayCurve, startTime + A, D);
        } else {
            g.linearRampToValueAtTime(S, startTime + A + D);
        }

        return { sustainLevel: S, releaseTime: R };
    }

    /**
     * Build a pre-rendered AudioBuffer from spectrogram data at reference pitch.
     * Uses harmonic additive synthesis where the spectrogram's spectral envelope
     * drives the amplitude of each harmonic over time.
     */
    function buildSpectrogramBuffer(trackId, specData) {
        ensureContext();
        const { ampData, canvasW, canvasH, duration, minFreq, maxFreq } = specData;

        // 找语谱图中最低有效频率作为"基频参考"
        let baseFreq = 261.6256; // 默认 C4
        const colMid = Math.floor(canvasW / 2);
        for (let y = canvasH - 1; y >= 0; y--) {
            const idx = y * canvasW + colMid;
            if (ampData[idx] > 0.01) {
                const t = 1 - y / canvasH;
                baseFreq = minFreq * Math.pow(maxFreq / minFreq, t);
                // 量化到最近的音高
                const midi = Math.round(69 + 12 * Math.log2(baseFreq / 440));
                baseFreq = 440 * Math.pow(2, (midi - 69) / 12);
                break;
            }
        }

        const numHarmonics = 40;
        const numSamples = Math.floor(duration * SAMPLE_RATE);
        const output = new Float32Array(numSamples);

        // 对每个时间列，提取频谱包络并映射到泛音列
        const hopSize = 256;
        const frameSize = 1024;
        const numFrames = Math.ceil(numSamples / hopSize);
        const hann = new Float32Array(frameSize);
        for (let i = 0; i < frameSize; i++) {
            hann[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (frameSize - 1)));
        }

        const colStep = canvasW / 32;

        for (let frame = 0; frame < numFrames; frame++) {
            const t = frame * hopSize / SAMPLE_RATE;
            const col = Math.min(canvasW - 1, Math.floor((t / duration) * canvasW));

            // 从语谱图当前列提取 32 频带的振幅（频谱包络）
            const envelope = new Float32Array(32);
            for (let b = 0; b < 32; b++) {
                let sum = 0, count = 0;
                const y0 = Math.floor(b * canvasH / 32);
                const y1 = Math.floor((b + 1) * canvasH / 32);
                for (let y = y0; y < y1; y++) {
                    sum += ampData[y * canvasW + col];
                    count++;
                }
                envelope[b] = count > 0 ? sum / count : 0;
            }

            // 用频谱包络驱动泛音列振幅
            const partials = [];
            for (let h = 1; h <= numHarmonics; h++) {
                // 泛音 h 对应频率 = baseFreq * h
                const freq = baseFreq * h;
                if (freq > maxFreq) break;
                // 在频谱包络中插值该频率的振幅
                const t_freq = Math.log(freq / minFreq) / Math.log(maxFreq / minFreq);
                const bIdx = t_freq * 31; // 0..31
                const bLo = Math.floor(bIdx);
                const bHi = Math.min(31, bLo + 1);
                const frac = bIdx - bLo;
                const amp = envelope[bLo] * (1 - frac) + envelope[bHi] * frac;
                if (amp > 0.001) {
                    partials.push({ freq, amp, phase: Math.random() * Math.PI * 2 });
                }
            }

            // 帧内正弦加性合成
            for (let i = 0; i < frameSize; i++) {
                const globalIdx = frame * hopSize + i;
                if (globalIdx >= numSamples) break;
                const sampleTime = globalIdx / SAMPLE_RATE;
                let sample = 0;
                for (const p of partials) {
                    sample += p.amp * Math.sin(2 * Math.PI * p.freq * sampleTime + p.phase);
                }
                const norm = Math.max(1, partials.length);
                output[globalIdx] += hann[i] * sample / norm;
            }
        }

        // 全局峰值归一化
        let peak = 0;
        for (let i = 0; i < output.length; i++) {
            if (Math.abs(output[i]) > peak) peak = Math.abs(output[i]);
        }
        if (peak > 0.001) {
            const scale = 0.85 / peak;
            for (let i = 0; i < output.length; i++) output[i] *= scale;
        }

        // 创建 AudioBuffer
        const buffer = ctx.createBuffer(1, numSamples, SAMPLE_RATE);
        buffer.copyToChannel(output, 0);
        spectrogramBuffers.set(trackId, { buffer, baseFreq, duration });
    }

    function getSpectrogramBuffer(trackId) {
        return spectrogramBuffers.get(trackId) || null;
    }

    function hasSpectrogramTimbre(instrument) {
        return instrument && instrument.timbreMode === 'spectrogram' && instrument.spectrogramData;
    }

    // ── Imported Audio Sample support ──

    function hasSampleTimbre(instrument) {
        return instrument && instrument.timbreMode === 'sample' && instrument.sampleData;
    }

    /**
     * Store an imported AudioBuffer as a track's sound source.
     * @param {string}  trackId
     * @param {AudioBuffer} audioBuffer  — decoded PCM audio
     * @param {number}  baseFreq          — reference pitch in Hz (default C4 = 261.6256)
     * @param {string}  fileName          — original file name for display
     */
    function loadSampleBuffer(trackId, audioBuffer, baseFreq, fileName) {
        sampleBuffers.set(trackId, {
            buffer: audioBuffer,
            baseFreq: baseFreq || 261.6256,
            fileName: fileName || 'imported.wav'
        });
    }

    function getSampleBuffer(trackId) {
        return sampleBuffers.get(trackId) || null;
    }

    /** Play a note using imported audio sample (BufferSource + playbackRate) */
    function playSampleNote(trackId, midiNote, instrument, noteDuration) {
        ensureContext();
        const track = getOrCreateTrackNodes(trackId);
        const samp = sampleBuffers.get(trackId);
        if (!samp) return;

        const noteFreq = midiToFreq(midiNote);
        const now = ctx.currentTime;
        const playbackRate = noteFreq / samp.baseFreq;

        const existing = activeNotes.get(midiNote);
        if (existing) _stopSampleNote(existing, now);

        const source = ctx.createBufferSource();
        source.buffer = samp.buffer;
        source.playbackRate.value = playbackRate;

        const envGain = ctx.createGain();
        envGain.gain.value = 0;
        source.connect(envGain);
        envGain.connect(track.gainNode);

        const adsr = (instrument && instrument.adsr) || { attack: 0.01, decay: 0.1, sustain: 0.7, release: 0.2 };
        const A = Math.max(0.001, adsr.attack);
        const D = Math.max(0.001, adsr.decay);
        const S = Math.max(0, Math.min(1, adsr.sustain));
        const R = Math.max(0.001, adsr.release);
        const sampDur = samp.buffer.duration / playbackRate;

        envGain.gain.cancelScheduledValues(now);
        envGain.gain.setValueAtTime(0.0001, now);

        if (adsr.attackCurve && adsr.attackCurve.length >= 2) {
            const c = new Float32Array(adsr.attackCurve);
            try { envGain.gain.setValueCurveAtTime(c, now, A); } catch(e) { envGain.gain.linearRampToValueAtTime(1.0, now + A); }
        } else {
            envGain.gain.linearRampToValueAtTime(1.0, now + A);
        }

        if (adsr.decayCurve && adsr.decayCurve.length >= 2) {
            const decayCurve = new Float32Array(adsr.decayCurve.map(v => 1 - v * (1 - S)));
            try { envGain.gain.setValueCurveAtTime(decayCurve, now + A, D); } catch(e) { envGain.gain.linearRampToValueAtTime(S, now + A + D); }
        } else {
            envGain.gain.linearRampToValueAtTime(S, now + A + D);
        }

        if (noteDuration !== undefined && noteDuration > 0) {
            const dur = Math.max(A + D + 0.001, noteDuration);
            envGain.gain.setValueAtTime(S, now + dur);
            envGain.gain.exponentialRampToValueAtTime(0.0001, now + dur + R);
            source.start(now);
            source.stop(now + dur + R + 0.1);
        } else {
            // 键盘演奏模式：循环播放，直到松开按键才停止
            source.loop = true;
            // 设置合理的循环点（避免 pop）
            if (samp.buffer.length > 0) {
                // 默认循环整个 buffer；用户可后续自定义 loopStart/loopEnd
            }
            source.start(now);
            const noteObj = { source, envGain, startTime: now, adsr, S, R, type: 'sample' };
            activeNotes.set(midiNote, noteObj);
        }
    }

    function _stopSampleNote(noteObj, when) {
        if (!noteObj) return;
        const { source, envGain, S, R } = noteObj;
        const t = when || ctx.currentTime;
        try {
            // 先关闭循环，防止继续播放
            if (source.loop) source.loop = false;

            // 确保最小释放时间（避免 R=0 时产生爆音）
            const effectiveR = Math.max(R, 0.03);

            envGain.gain.cancelScheduledValues(t);
            envGain.gain.setValueAtTime(S, t);
            envGain.gain.exponentialRampToValueAtTime(0.0001, t + effectiveR);
            source.stop(t + effectiveR + 0.05);
        } catch(e) {}
    }

    function scheduleSampleNote(trackId, midiNote, instrument, startAudioTime, durationSec) {
        ensureContext();
        const track = getOrCreateTrackNodes(trackId);
        const samp = sampleBuffers.get(trackId);
        if (!samp) return;

        const noteFreq = midiToFreq(midiNote);
        const playbackRate = noteFreq / samp.baseFreq;
        const now = startAudioTime;

        const source = ctx.createBufferSource();
        source.buffer = samp.buffer;
        source.playbackRate.value = playbackRate;

        const envGain = ctx.createGain();
        envGain.gain.value = 0;
        source.connect(envGain);
        envGain.connect(track.gainNode);

        const adsr = instrument.adsr || { attack: 0.01, decay: 0.1, sustain: 0.7, release: 0.2 };
        const A = Math.max(0.001, adsr.attack);
        const D = Math.max(0.001, adsr.decay);
        const S = Math.max(0, Math.min(1, adsr.sustain));
        const R = Math.max(0.001, adsr.release);
        const dur = Math.max(A + D + 0.001, durationSec);

        envGain.gain.setValueAtTime(0.0001, now);
        envGain.gain.linearRampToValueAtTime(1.0, now + A);
        envGain.gain.linearRampToValueAtTime(S, now + A + D);
        envGain.gain.setValueAtTime(S, now + dur);
        envGain.gain.exponentialRampToValueAtTime(0.0001, now + dur + R);

        source.start(now);
        source.stop(now + dur + R + 0.05);
    }

    /**
     * Play a note using spectrogram-based synthesis
     */

    /**
     * Fallback: play using PeriodicWave from timbre harmonics
     */
    function _playTimbreFallback(trackId, midiNote, instrument, noteDuration) {
        ensureContext();
        const track = getOrCreateTrackNodes(trackId);
        const freq = midiToFreq(midiNote);
        const now = ctx.currentTime;

        const osc = ctx.createOscillator();
        const envGain = ctx.createGain();
        envGain.gain.value = 0;

        // Build PeriodicWave from timbre harmonics
        if (instrument && instrument.timbre && instrument.timbre.length > 0) {
            try { osc.setPeriodicWave(buildPeriodicWave(instrument.timbre)); }
            catch(e) { osc.type = 'sine'; }
        } else {
            osc.type = (instrument && instrument.waveform) || 'sine';
        }
        osc.frequency.value = freq;

        // Overlay custom wave (wave designer)
        let extraSources = [];
        if (instrument && instrument.useCustomWave && instrument.waveDesign && instrument.waveDesign.oscillators) {
            instrument.waveDesign.oscillators.forEach(oscData => {
                if (!oscData.enabled) return;
                const o2 = ctx.createOscillator();
                const g2 = ctx.createGain();
                g2.gain.value = 0;
                const harmonics = oscData.harmonics;
                const N = Math.min(harmonics.length, 32);
                const real = new Float32Array(N + 1);
                const imag = new Float32Array(N + 1);
                real[0] = 0;
                for (let i = 0; i < N; i++) { imag[i + 1] = harmonics[i] || 0; }
                try {
                    const pw = ctx.createPeriodicWave(real, imag, { disableNormalization: false });
                    o2.setPeriodicWave(pw);
                } catch(e) { o2.type = 'sine'; }
                o2.frequency.value = freq;
                if (oscData.detune) o2.detune.value = oscData.detune;
                const vol = (oscData.gain || 0.5) * 0.3;
                g2.gain.setValueAtTime(0.0001, now);
                g2.gain.linearRampToValueAtTime(vol, now + 0.02);
                g2.gain.setValueAtTime(vol, now + noteDuration * 0.8);
                g2.gain.exponentialRampToValueAtTime(0.0001, now + noteDuration + 0.15);
                o2.connect(g2); g2.connect(track.gainNode);
                o2.start(now); o2.stop(now + noteDuration + 0.2);
                extraSources.push({ source: o2, gain: g2 });
            });
        }

        osc.connect(envGain);
        envGain.connect(track.gainNode);

        const adsr = instrument.adsr || { attack: 0.01, decay: 0.1, sustain: 0.7, release: 0.2 };
        const A = Math.max(0.001, adsr.attack);
        const D = Math.max(0.001, adsr.decay);
        const S = Math.max(0, Math.min(1, adsr.sustain));
        const R = Math.max(0.001, adsr.release);
        const dur = Math.max(A + D + 0.001, noteDuration);

        envGain.gain.setValueAtTime(0.0001, now);
        envGain.gain.linearRampToValueAtTime(1.0, now + A);
        envGain.gain.linearRampToValueAtTime(S, now + A + D);
        envGain.gain.setValueAtTime(S, now + dur);
        envGain.gain.exponentialRampToValueAtTime(0.0001, now + dur + R);

        osc.start(now);
        osc.stop(now + dur + R + 0.05);

        // 叠加 Noise 振荡器
        if (instrument && instrument.waveDesign && instrument.waveDesign.noise && instrument.waveDesign.noise.enabled) {
            const noiseVol = instrument.waveDesign.noise.gain * 0.2;
            const noiseLen = ctx.sampleRate * noteDuration;
            const noiseBuf = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
            const noiseData = noiseBuf.getChannelData(0);
            for (let i = 0; i < noiseLen; i++) noiseData[i] = Math.random() * 2 - 1;
            const noiseSource = ctx.createBufferSource();
            noiseSource.buffer = noiseBuf;
            const nGain = ctx.createGain();
            nGain.gain.setValueAtTime(0.0001, now);
            nGain.gain.linearRampToValueAtTime(noiseVol, now + 0.02);
            nGain.gain.setValueAtTime(noiseVol, now + noteDuration * 0.7);
            nGain.gain.exponentialRampToValueAtTime(0.0001, now + noteDuration);
            const hpf = ctx.createBiquadFilter();
            hpf.type = 'highpass'; hpf.frequency.value = 3000;
            noiseSource.connect(hpf); hpf.connect(nGain); nGain.connect(track.gainNode);
            noiseSource.start(now); noiseSource.stop(now + noteDuration + 0.05);
        }
        // 叠加 Sub 振荡器
        if (instrument && instrument.waveDesign && instrument.waveDesign.sub && instrument.waveDesign.sub.enabled) {
            const subVol = instrument.waveDesign.sub.gain * 0.5;
            const subOsc = ctx.createOscillator();
            const sGain = ctx.createGain();
            sGain.gain.value = 0;
            subOsc.type = 'sine';
            subOsc.frequency.value = freq / 2;
            sGain.gain.setValueAtTime(0.0001, now);
            sGain.gain.linearRampToValueAtTime(subVol, now + 0.03);
            sGain.gain.setValueAtTime(subVol, now + noteDuration * 0.8);
            sGain.gain.exponentialRampToValueAtTime(0.0001, now + noteDuration);
            subOsc.connect(sGain); sGain.connect(track.gainNode);
            subOsc.start(now); subOsc.stop(now + noteDuration + 0.05);
        }

        const noteObj = { source: osc, envGain, startTime: now, adsr, S, R, type: 'timbre-fallback', extraSources };
        activeNotes.set(midiNote, noteObj);
        return noteObj;
    }

    function playSpectrogramNote(trackId, midiNote, instrument, noteDuration) {
        ensureContext();
        const track = getOrCreateTrackNodes(trackId);
        const specBuf = spectrogramBuffers.get(trackId);
        // FALLBACK: if no pre-rendered buffer, use PeriodicWave from timbre
        if (!specBuf) {
            return _playTimbreFallback(trackId, midiNote, instrument, noteDuration);
        }

        const noteFreq = midiToFreq(midiNote);
        const now = ctx.currentTime;
        const playbackRate = noteFreq / specBuf.baseFreq;

        // 停止同音高的已有音符
        const existing = activeNotes.get(midiNote);
        if (existing) _stopSpectrogramNote(existing, now);

        const source = ctx.createBufferSource();
        source.buffer = specBuf.buffer;
        source.playbackRate.value = playbackRate;

        const envGain = ctx.createGain();
        envGain.gain.value = 0;
        source.connect(envGain);
        envGain.connect(track.gainNode);

        const adsr = (instrument && instrument.adsr) || { attack: 0.01, decay: 0.1, sustain: 0.7, release: 0.2 };
        const A = Math.max(0.001, adsr.attack);
        const D = Math.max(0.001, adsr.decay);
        const S = Math.max(0, Math.min(1, adsr.sustain));
        const R = Math.max(0.001, adsr.release);
        const specDur = specBuf.duration / playbackRate;

        envGain.gain.cancelScheduledValues(now);
        envGain.gain.setValueAtTime(0.0001, now);

        if (adsr.attackCurve && adsr.attackCurve.length >= 2) {
            const c = new Float32Array(adsr.attackCurve);
            try { envGain.gain.setValueCurveAtTime(c, now, A); } catch(e) { envGain.gain.linearRampToValueAtTime(1.0, now + A); }
        } else {
            envGain.gain.linearRampToValueAtTime(1.0, now + A);
        }

        if (adsr.decayCurve && adsr.decayCurve.length >= 2) {
            const decayCurve = new Float32Array(adsr.decayCurve.map(v => 1 - v * (1 - S)));
            try { envGain.gain.setValueCurveAtTime(decayCurve, now + A, D); } catch(e) { envGain.gain.linearRampToValueAtTime(S, now + A + D); }
        } else {
            envGain.gain.linearRampToValueAtTime(S, now + A + D);
        }

        if (noteDuration !== undefined && noteDuration > 0) {
            const dur = Math.max(A + D + 0.001, noteDuration);
            envGain.gain.setValueAtTime(S, now + dur);
            envGain.gain.exponentialRampToValueAtTime(0.0001, now + dur + R);
            source.start(now);
            source.stop(now + dur + R + 0.1);
        } else {
            // 键盘演奏模式：循环播放
            source.loop = true;
            source.start(now);
            const noteObj = { source, envGain, startTime: now, adsr, S, R, type: 'spectrogram' };
            activeNotes.set(midiNote, noteObj);
        }
    }

    function _stopSpectrogramNote(noteObj, when) {
        if (!noteObj) return;
        const { source, envGain, S, R } = noteObj;
        const t = when || ctx.currentTime;
        try {
            // 先关闭循环
            if (source.loop) source.loop = false;

            const effectiveR = Math.max(R, 0.03);

            envGain.gain.cancelScheduledValues(t);
            envGain.gain.setValueAtTime(S, t);
            envGain.gain.exponentialRampToValueAtTime(0.0001, t + effectiveR);
            source.stop(t + effectiveR + 0.05);
        } catch(e) {}
    }

    /**
     * Play a note immediately
     */
    function playNote(trackId, midiNote, instrument, duration) {
        // 导入音频采样模式 → 采样器播放
        if (hasSampleTimbre(instrument)) {
            return playSampleNote(trackId, midiNote, instrument, duration);
        }
        // 语谱图音色模式 → 走专用合成路径
        if (hasSpectrogramTimbre(instrument)) {
            return playSpectrogramNote(trackId, midiNote, instrument, duration);
        }

        // 鼓合成器
        if (instrument && instrument.id === 'drums') {
            return playDrumNote(trackId, midiNote, instrument, duration);
        }

        ensureContext();
        const track = getOrCreateTrackNodes(trackId);
        const freq = midiToFreq(midiNote);
        const now = ctx.currentTime;

        // Stop any already-playing note with same midi
        const existing = activeNotes.get(midiNote);
        if (existing) _stopNoteObj(existing, now);

        const osc = ctx.createOscillator();
        const envGain = ctx.createGain();
        envGain.gain.value = 0;

        // Set waveform
        // 优先使用自定义波形（波形设计器）
        if (instrument && instrument.useCustomWave && instrument.waveDesign) {
            try {
                const waveData = instrument.waveDesign;
                // 使用第一个启用的振荡器
                if (waveData.oscillators && waveData.oscillators.length > 0) {
                    const oscData = waveData.oscillators[0];
                    if (oscData.enabled) {
                        const harmonics = oscData.harmonics;
                        const N = Math.min(harmonics.length, 32);
                        const real = new Float32Array(N + 1);
                        const imag = new Float32Array(N + 1);
                        real[0] = 0;
                        for (let i = 0; i < N; i++) {
                            imag[i + 1] = harmonics[i] || 0;
                        }
                        const pw = ctx.createPeriodicWave(real, imag, { disableNormalization: false });
                        osc.setPeriodicWave(pw);
                        // 应用失谐
                        if (oscData.detune) {
                            osc.detune.value = oscData.detune;
                        }
                    }
                }
            } catch(e) {
                osc.type = 'sine';
            }
        } else if (instrument && instrument.timbre && instrument.timbre.length > 0) {
            try {
                osc.setPeriodicWave(buildPeriodicWave(instrument.timbre));
            } catch(e) {
                osc.type = 'sine';
            }
        } else {
            osc.type = (instrument && instrument.waveform) || 'sine';
        }
        osc.frequency.value = freq;

        osc.connect(envGain);
        envGain.connect(track.gainNode);

        const adsr = (instrument && instrument.adsr) || { attack: 0.01, decay: 0.1, sustain: 0.7, release: 0.2 };
        const A = Math.max(0.001, adsr.attack);
        const D = Math.max(0.001, adsr.decay);
        const S = Math.max(0, Math.min(1, adsr.sustain));
        const R = Math.max(0.001, adsr.release);

        envGain.gain.cancelScheduledValues(now);
        envGain.gain.setValueAtTime(0.0001, now);

        // Attack
        if (adsr.attackCurve && adsr.attackCurve.length >= 2) {
            const c = new Float32Array(adsr.attackCurve);
            try { envGain.gain.setValueCurveAtTime(c, now, A); } catch(e) { envGain.gain.linearRampToValueAtTime(1.0, now + A); }
        } else {
            envGain.gain.linearRampToValueAtTime(1.0, now + A);
        }

        // Decay
        if (adsr.decayCurve && adsr.decayCurve.length >= 2) {
            const decayCurve = new Float32Array(adsr.decayCurve.map(v => 1 - v * (1 - S)));
            try { envGain.gain.setValueCurveAtTime(decayCurve, now + A, D); } catch(e) { envGain.gain.linearRampToValueAtTime(S, now + A + D); }
        } else {
            envGain.gain.linearRampToValueAtTime(S, now + A + D);
        }

        // Hold at sustain
        if (duration !== undefined && duration > 0) {
            const dur = Math.max(A + D + 0.001, duration);
            envGain.gain.setValueAtTime(S, now + dur);
            // Release
            if (adsr.releaseCurve && adsr.releaseCurve.length >= 2) {
                const relCurve = new Float32Array(adsr.releaseCurve.map(v => S * (1 - v)));
                try { envGain.gain.setValueCurveAtTime(relCurve, now + dur, R); } catch(e) { envGain.gain.exponentialRampToValueAtTime(0.0001, now + dur + R); }
            } else {
                envGain.gain.exponentialRampToValueAtTime(0.0001, now + dur + R);
            }
            osc.start(now);
            osc.stop(now + dur + R + 0.1);
            return;
        } else {
            osc.start(now);
        }

        const noteObj = { osc, envGain, startTime: now, adsr, S, R };
        activeNotes.set(midiNote, noteObj);
        return noteObj;
    }

    function _stopNoteObj(noteObj, when) {
        if (!noteObj) return;
        const { osc, envGain, S, R } = noteObj;
        const t = when || ctx.currentTime;
        try {
            // 确保最小释放时间
            const effectiveR = Math.max(R, 0.03);

            envGain.gain.cancelScheduledValues(t);
            envGain.gain.setValueAtTime(S, t);
            envGain.gain.exponentialRampToValueAtTime(0.0001, t + effectiveR);
            osc.stop(t + effectiveR + 0.05);
        } catch(e) {}
    }

    /** Stop by MIDI note number */
    function stopNote(midiNote, when) {
        const noteObj = activeNotes.get(midiNote);
        if (noteObj) {
            if (noteObj.type === 'spectrogram' || noteObj.type === 'sample') {
                // BufferSource-based: spectrogram or sample
                if (noteObj.type === 'spectrogram') {
                    _stopSpectrogramNote(noteObj, when);
                } else {
                    _stopSampleNote(noteObj, when);
                }
            } else {
                _stopNoteObj(noteObj, when);
            }
            activeNotes.delete(midiNote);
        }
    }

    // ===== Tuning System (non-12TET support) =====
    /**
     * 音律系统：支持非十二平均律
     * - tuningMode: '12tet' | 'custom'
     * - customCents: Map<midiNote % 12, centOffset>  (e.g., Arabic 1/4 tone: {1: 50, 3: 50, ...})
     * - tuningName: string (for display)
     */
    let tuningMode = '12tet';
    let customCents = new Map(); // pc (0-11) -> cent offset
    let tuningName = '十二平均律';

    /** 预定义音律 */
    const TUNING_PRESETS = {
        '12tet': {
            name: '十二平均律',
            desc: 'Western standard 12-Tone Equal Temperament',
            cents: {}
        },
        'arabic_24': {
            name: '阿拉伯 24 平均律',
            desc: 'Arabic 24-TET, quarter tones on E/F/B',
            cents: { 1: 50, 3: 50, 6: 50, 8: 50, 10: 50 } // C#, D#, F#, G#, A#
        },
        'indian_22': {
            name: '印度 22 Shruti',
            desc: 'Approximate Indian 22 Shruti system',
            cents: { 1: 42, 3: 38, 6: 42, 8: 38, 10: 42 } // approximate
        },
        'chinese_pure': {
            name: '中国古琴纯律',
            desc: 'Chinese Guqin just intonation',
            cents: { 1: -14, 3: -16, 6: -12, 8: -14, 10: -16 } // approximate
        },
        'indonesian_s': {
            name: '印尼 Slendro',
            desc: 'Javanese Slendro pentatonic (approximate)',
            cents: { 2: -30, 4: -20, 7: -30, 9: -20 } // flatter thirds/fourths
        }
    };

    /** 设置音律 */
    function setTuning(presetKey, customCentsMap) {
        console.log('[AudioEngine.setTuning] called:', { presetKey, customCentsMap });
        if (presetKey && TUNING_PRESETS[presetKey]) {
            const preset = TUNING_PRESETS[presetKey];
            tuningName = preset.name;
            // 判断该预设是否真的有音分偏差
            const centsObj = preset.cents || {};
            const centKeys = Object.keys(centsObj);
            if (centKeys.length > 0) {
                tuningMode = 'custom';
                customCents = new Map();
                for (const key of centKeys) {
                    customCents.set(parseInt(key), centsObj[key]);
                }
            } else {
                // 十二平均律预设：清空自定义音律
                tuningMode = '12tet';
                customCents = new Map();
            }
            console.log('[AudioEngine.setTuning] preset applied:', { tuningMode, tuningName, customCents: Object.fromEntries(customCents) });
        } else if (customCentsMap) {
            tuningMode = 'custom';
            tuningName = '自定义音律';
            customCents = new Map();
            for (const [key, val] of customCentsMap) {
                customCents.set(Number(key), val);
            }
            console.log('[AudioEngine.setTuning] custom applied:', { tuningMode, customCents: Object.fromEntries(customCents) });
        } else {
            tuningMode = '12tet';
            tuningName = '十二平均律';
            customCents = new Map();
            console.log('[AudioEngine.setTuning] reset to 12TET');
        }
    }

    /** 获取当前音律信息 */
    function getTuning() {
        return {
            mode: tuningMode,
            name: tuningName,
            cents: Object.fromEntries(customCents),
            presets: Object.keys(TUNING_PRESETS)
        };
    }

    /**
     * 动态添加自定义音律预设
     * @param {string} key - 预设唯一键，如 'custom_my_tuning'
     * @param {Object} preset - { name: string, desc: string, cents: { pc: cents } }
     * @returns {boolean}
     */
    function addTuningPreset(key, preset) {
        if (!key || !preset || typeof preset.name !== 'string' || !preset.cents) {
            console.error('[AudioEngine.addTuningPreset] Invalid arguments:', { key, preset });
            return false;
        }
        if (TUNING_PRESETS[key]) {
            console.warn('[AudioEngine.addTuningPreset] Preset already exists, overwriting:', key);
        }
        TUNING_PRESETS[key] = {
            name: preset.name,
            desc: preset.desc || '',
            cents: { ...preset.cents }
        };
        console.log('[AudioEngine.addTuningPreset] Preset saved:', key, TUNING_PRESETS[key]);
        return true;
    }

    /** 获取所有音律预设（供外部读取） */
    function getTuningPresets() {
        return TUNING_PRESETS;
    }

    function midiToFreq(midi) {
        const baseFreq = 440 * Math.pow(2, (midi - 69) / 12);
        if (tuningMode === '12tet' || customCents.size === 0) {
            console.log('[AudioEngine.midiToFreq]', { midi, baseFreq, tuningMode, note: '12TET (no custom cents)' });
            return baseFreq;
        }
        // Apply cent offset for this pitch class
        const pc = midi % 12;
        const cents = customCents.get(pc) || 0;
        const freq = baseFreq * Math.pow(2, cents / 1200);
        console.log('[AudioEngine.midiToFreq]', { midi, pc, cents, baseFreq, freq, tuningMode });
        return freq;
    }

    function setMasterVolume(v) {
        ensureContext();
        masterGain.gain.value = v / 100;
    }

    function setTrackVolume(trackId, v) {
        const t = trackNodes.get(trackId);
        if (t) t.gainNode.gain.value = v / 100;
    }

    function setTrackPan(trackId, p) {
        const t = trackNodes.get(trackId);
        if (t) t.panNode.pan.value = p / 100;
    }

    function getAnalyser() {
        ensureContext();
        return analyserNode;
    }

    /**
     * Schedule a note at a specific audio context time
     */
    function scheduleNote(trackId, midiNote, instrument, startAudioTime, durationSec) {
        // 导入音频采样模式 → 采样器调度
        if (hasSampleTimbre(instrument)) {
            scheduleSampleNote(trackId, midiNote, instrument, startAudioTime, durationSec);
            return;
        }
        // 语谱图音色模式 → 走专用合成
        if (hasSpectrogramTimbre(instrument)) {
            scheduleSpectrogramNote(trackId, midiNote, instrument, startAudioTime, durationSec);
            return;
        }

        // 鼓合成器调度
        if (instrument && instrument.id === 'drums') {
            scheduleDrumNote(trackId, midiNote, instrument, startAudioTime, durationSec);
            return;
        }

        ensureContext();
        const track = getOrCreateTrackNodes(trackId);
        const freq = midiToFreq(midiNote);
        const now = startAudioTime;

        const osc = ctx.createOscillator();
        const envGain = ctx.createGain();
        envGain.gain.value = 0;

        if (instrument && instrument.useCustomWave && instrument.waveDesign) {
            try {
                const waveData = instrument.waveDesign;
                if (waveData.oscillators && waveData.oscillators.length > 0) {
                    const oscData = waveData.oscillators[0];
                    if (oscData.enabled) {
                        const harmonics = oscData.harmonics;
                        const N = Math.min(harmonics.length, 32);
                        const real = new Float32Array(N + 1);
                        const imag = new Float32Array(N + 1);
                        real[0] = 0;
                        for (let i = 0; i < N; i++) {
                            imag[i + 1] = harmonics[i] || 0;
                        }
                        const pw = ctx.createPeriodicWave(real, imag, { disableNormalization: false });
                        osc.setPeriodicWave(pw);
                        if (oscData.detune) osc.detune.value = oscData.detune;
                    }
                }
            } catch(e) {
                osc.type = 'sine';
            }
        } else if (instrument.timbre && instrument.timbre.length > 0) {
            try { osc.setPeriodicWave(buildPeriodicWave(instrument.timbre)); } catch(e) { osc.type = 'sine'; }
        } else {
            osc.type = instrument.waveform || 'sine';
        }
        osc.frequency.value = freq;
        osc.connect(envGain);
        envGain.connect(track.gainNode);

        const adsr = instrument.adsr || { attack: 0.01, decay: 0.1, sustain: 0.7, release: 0.2 };
        const A = Math.max(0.001, adsr.attack);
        const D = Math.max(0.001, adsr.decay);
        const S = Math.max(0, Math.min(1, adsr.sustain));
        const R = Math.max(0.001, adsr.release);
        const dur = Math.max(A + D + 0.001, durationSec);

        envGain.gain.setValueAtTime(0.0001, now);
        envGain.gain.linearRampToValueAtTime(1.0, now + A);
        envGain.gain.linearRampToValueAtTime(S, now + A + D);
        envGain.gain.setValueAtTime(S, now + dur);
        envGain.gain.exponentialRampToValueAtTime(0.0001, now + dur + R);

        osc.start(now);
        osc.stop(now + dur + R + 0.05);
    }

    function scheduleSpectrogramNote(trackId, midiNote, instrument, startAudioTime, durationSec) {
        ensureContext();
        const track = getOrCreateTrackNodes(trackId);
        const specBuf = spectrogramBuffers.get(trackId);
        // FALLBACK: if no pre-rendered buffer, schedule PeriodicWave from timbre
        if (!specBuf) {
            _scheduleTimbreFallback(trackId, midiNote, instrument, startAudioTime, durationSec);
            return;
        }

        const noteFreq = midiToFreq(midiNote);
        const playbackRate = noteFreq / specBuf.baseFreq;
        const now = startAudioTime;

        const source = ctx.createBufferSource();
        source.buffer = specBuf.buffer;
        source.playbackRate.value = playbackRate;

        const envGain = ctx.createGain();
        envGain.gain.value = 0;
        source.connect(envGain);
        envGain.connect(track.gainNode);

        const adsr = instrument.adsr || { attack: 0.01, decay: 0.1, sustain: 0.7, release: 0.2 };
        const A = Math.max(0.001, adsr.attack);
        const D = Math.max(0.001, adsr.decay);
        const S = Math.max(0, Math.min(1, adsr.sustain));
        const R = Math.max(0.001, adsr.release);
        const dur = Math.max(A + D + 0.001, durationSec);

        envGain.gain.setValueAtTime(0.0001, now);
        envGain.gain.linearRampToValueAtTime(1.0, now + A);
        envGain.gain.linearRampToValueAtTime(S, now + A + D);
        envGain.gain.setValueAtTime(S, now + dur);
        envGain.gain.exponentialRampToValueAtTime(0.0001, now + dur + R);

        source.start(now);
        source.stop(now + dur + R + 0.05);
    }

    function getCurrentTime() {
        ensureContext();
        return ctx.currentTime;
    }

    /**
     * 试听指定频率和波形
     * waveData: { oscillators: [{ enabled, gain, detune, harmonics }] }
     */
    function playPreview(freq, waveData, duration) {
        ensureContext();
        const dur = duration || 0.5;
        const t = ctx.currentTime;
        const now = t;

        if (!waveData || !waveData.oscillators) {
            // 无波形数据，用正弦波
            const osc = ctx.createOscillator();
            const g = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.value = freq;
            g.gain.setValueAtTime(0.0001, t);
            g.gain.linearRampToValueAtTime(0.3, t + 0.02);
            g.gain.setValueAtTime(0.3, t + dur * 0.8);
            g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
            osc.connect(g); g.connect(masterGain);
            osc.start(t); osc.stop(t + dur + 0.05);
            return;
        }

        // 叠加所有启用的振荡器
        const adsr = { attack: 0.02, decay: 0.1, sustain: 0.5, release: 0.15 };
        waveData.oscillators.forEach(oscData => {
            if (!oscData.enabled) return;
            const osc = ctx.createOscillator();
            const g = ctx.createGain();
            g.gain.value = 0;

            // 构建 PeriodicWave
            const harmonics = oscData.harmonics;
            const N = Math.min(harmonics.length, 32);
            const real = new Float32Array(N + 1);
            const imag = new Float32Array(N + 1);
            real[0] = 0;
            for (let i = 0; i < N; i++) {
                imag[i + 1] = harmonics[i] || 0;
            }
            try {
                const pw = ctx.createPeriodicWave(real, imag, { disableNormalization: false });
                osc.setPeriodicWave(pw);
            } catch(e) {
                osc.type = 'sine';
            }
            osc.frequency.value = freq;
            if (oscData.detune) osc.detune.value = oscData.detune;

            // ADSR
            const A = adsr.attack, D = adsr.decay, S = adsr.sustain, R = adsr.release;
            const vol = (oscData.gain || 0.5) * 0.3;
            g.gain.setValueAtTime(0.0001, t);
            g.gain.linearRampToValueAtTime(vol, t + A);
            g.gain.linearRampToValueAtTime(vol * S, t + A + D);
            g.gain.setValueAtTime(vol * S, t + dur);
            g.gain.exponentialRampToValueAtTime(0.0001, t + dur + R);

            osc.connect(g); g.connect(masterGain);
            osc.start(t); osc.stop(t + dur + R + 0.05);
        });
    }


    /**
     * Fallback for scheduled notes: use OscillatorNode + PeriodicWave
     */
    function _scheduleTimbreFallback(trackId, midiNote, instrument, startAudioTime, durationSec) {
        ensureContext();
        const track = getOrCreateTrackNodes(trackId);
        const freq = midiToFreq(midiNote);
        const now = startAudioTime;

        const osc = ctx.createOscillator();
        const envGain = ctx.createGain();
        envGain.gain.value = 0;

        if (instrument && instrument.timbre && instrument.timbre.length > 0) {
            try { osc.setPeriodicWave(buildPeriodicWave(instrument.timbre)); }
            catch(e) { osc.type = 'sine'; }
        } else {
            osc.type = (instrument && instrument.waveform) || 'sine';
        }
        osc.frequency.value = freq;
        osc.connect(envGain);
        envGain.connect(track.gainNode);

        const adsr = instrument.adsr || { attack: 0.01, decay: 0.1, sustain: 0.7, release: 0.2 };
        const A = Math.max(0.001, adsr.attack);
        const D = Math.max(0.001, adsr.decay);
        const S = Math.max(0, Math.min(1, adsr.sustain));
        const R = Math.max(0.001, adsr.release);
        const dur = Math.max(A + D + 0.001, durationSec);

        envGain.gain.setValueAtTime(0.0001, now);
        envGain.gain.linearRampToValueAtTime(1.0, now + A);
        envGain.gain.linearRampToValueAtTime(S, now + A + D);
        envGain.gain.setValueAtTime(S, now + dur);
        envGain.gain.exponentialRampToValueAtTime(0.0001, now + dur + R);

        osc.start(now);
        osc.stop(now + dur + R + 0.05);
    }

    return {
        ensureContext,
        playNote,
        stopNote,
        scheduleNote,
        setMasterVolume,
        setTrackVolume,
        setTrackPan,
        getAnalyser,
        midiToFreq,
        getCurrentTime,
        buildSpectrogramBuffer,
        getSpectrogramBuffer,
        removeTrackNodes,
        loadSampleBuffer,
        getSampleBuffer,
        getCtx: () => ctx,
        hasSampleTimbre,
        // Tuning system (non-12TET support)
        setTuning,
        getTuning,
        addTuningPreset,
        getTuningPresets,
        // Preview custom wave
        playPreview
    };
})();
