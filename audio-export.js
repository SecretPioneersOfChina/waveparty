/**
 * WaveParty Audio Export v3 (完整重构)
 *
 * 数据结构说明：
 *   track.notes   → 旧版兼容，通常为空 []
 *   track.clips   → 乐段数组 [{ id, startBeat, length, name, notes }]
 *   clip.notes    → 实际音符 [{ pitch, beat, duration, velocity }]
 *                    其中 beat 是相对于 clip 起始的拍数（从 0 开始）
 *
 * 导出时需要：收集所有 clip 的 notes，加上 clip.startBeat 偏移量
 */
window.AudioExport = (function () {
    'use strict';

    const SAMPLE_RATE = 44100;

    /* ============================================================
     *  公共 API
     * ============================================================ */
    async function exportToWAV(tracks, tempo) {
        if (!tracks || tracks.length === 0) {
            alert('没有轨道可导出');
            return;
        }

        const beatDur = 60 / (tempo || 120);

        // ── 第一步：从所有轨道的所有 clips 中收集音符 ──
        const schedNotes = []; // { trackIdx, pitch, absBeat, duration, velocity, instrument, volume }
        let maxAbsBeat = 0;

        tracks.forEach((track, ti) => {
            if (track.muted) return;

            const clips = (track.clips && track.clips.length > 0)
                ? track.clips
                : [{ notes: track.notes || [], startBeat: 0, length: track.length || 8 }];

            clips.forEach(clip => {
                const notes = clip.notes;
                if (!notes || !Array.isArray(notes) || notes.length === 0) return;

                const offset = clip.startBeat || 0;
                const clipLen = clip.length || 4;
                notes.forEach(note => {
                    const absBeat = (note.beat || 0) + offset;
                    const dur = note.duration || 0.25;
                    schedNotes.push({
                        trackIdx: ti,
                        pitch: note.pitch,
                        absBeat: absBeat,
                        duration: dur,
                        velocity: note.velocity || 80,
                        instrument: track.instrument || null,
                        trackVolume: track.volume || 75,
                        trackPan: track.pan || 0,
                        // Clip 音量渐变
                        volEnvelope: clip.volumeEnvelope || null,
                        clipStartBeat: offset,
                        clipLength: clipLen,
                        // 语谱图/采样数据引用
                        spectrogramData: (track.instrument && track.instrument.timbreMode === 'spectrogram')
                            ? track.instrument.spectrogramData : null,
                        sampleData: (track.instrument && track.instrument.timbreMode === 'sample')
                            ? track.instrument.sampleData : null,
                    });
                    if (absBeat + dur > maxAbsBeat) maxAbsBeat = absBeat + dur;
                });
            });
        });

        console.log('[AudioExport v3] 收集到', schedNotes.length, '个音符, maxAbsBeat=', maxAbsBeat.toFixed(2));

        if (schedNotes.length === 0) {
            alert('没有找到可导出的音符（请在钢琴卷帘中添加音符）');
            return;
        }

        // ── 第二步：创建 OfflineAudioContext 并渲染 ──
        const totalDuration = Math.max(maxAbsBeat * beatDur + 1, 4); // 至少 4 秒 + 1 秒余量
        console.log('[AudioExport v3] totalDuration=', totalDuration.toFixed(2) + 's');

        showProgress('正在渲染音频...');

        let offlineCtx;
        try {
            offlineCtx = new OfflineAudioContext(2, Math.ceil(SAMPLE_RATE * totalDuration), SAMPLE_RATE);
        } catch (e) {
            hideProgress();
            alert('无法创建离线音频上下文: ' + e.message);
            console.error('[AudioExport v3] OfflineAudioContext 创建失败:', e);
            return;
        }

        // 主输出增益
        const masterGain = offlineCtx.createGain();
        masterGain.gain.value = 0.8;
        masterGain.connect(offlineCtx.destination);

        // ── 第三步：调度每个音符 ──
        let scheduledCount = 0;

        for (let i = 0; i < schedNotes.length; i++) {
            const sn = schedNotes[i];
            try {
                const ok = _scheduleNote(offlineCtx, masterGain, sn, beatDur);
                if (ok) scheduledCount++;
            } catch (e) {
                console.error('[AudioExport v3] 音符调度异常 [', i, ']:', e);
            }
        }

        console.log('[AudioExport v3] 成功调度', scheduledCount, '/', schedNotes.length, '个音符');

        // ── 第四步：渲染并导出 WAV ──
        try {
            showProgress('正在离线渲染（可能需要几秒）...');
            const audioBuffer = await offlineCtx.startRendering();

            // 检查峰值
            let peakL = 0, peakR = 0;
            const ch0 = audioBuffer.getChannelData(0);
            for (let j = 0; j < ch0.length; j++) {
                const v = Math.abs(ch0[j]);
                if (v > peakL) peakL = v;
            }
            if (audioBuffer.numberOfChannels >= 2) {
                const ch1 = audioBuffer.getChannelData(1);
                for (let j = 0; j < ch1.length; j++) {
                    const v = Math.abs(ch1[j]);
                    if (v > peakR) peakR = v;
                }
            }
            console.log('[AudioExport v3] 渲染完成 — 长度:', audioBuffer.length,
                '峰值 L:', peakL.toFixed(6), 'R:', peakR.toFixed(6));

            if (audioBuffer.length === 0) {
                hideProgress();
                alert('渲染结果为空');
                return;
            }

            // 编码为 WAV
            showProgress('正在编码 WAV...');
            const wavBlob = _encodeWav(audioBuffer);
            console.log('[AudioExport v3] WAV 大小:', (wavBlob.size / 1024).toFixed(1), 'KB');

            _downloadBlob(wavBlob, 'WaveParty_' + _timestamp() + '.wav');
            hideProgress();
            console.log('[AudioExport v3] 导出成功!');

        } catch (err) {
            hideProgress();
            alert('导出失败: ' + err.message);
            console.error('[AudioExport v3] 渲染/编码异常:', err);
        }
    }

    /* ============================================================
     *  内部：调度单个音符到 OfflineAudioContext
     * ============================================================ */
    function _scheduleNote(offlineCtx, destGain, sn, beatDur) {
        const freq = _midiToFreq(sn.pitch);
        const startTime = sn.absBeat * beatDur;
        const durSec = Math.max(0.02, sn.duration * beatDur);

        // ADSR 包络
        const adsr = (sn.instrument && sn.instrument.adsr) || { attack: 0.01, decay: 0.1, sustain: 0.7, release: 0.3 };
        const A = Math.max(0.001, adsr.attack);
        const D = Math.max(0.001, adsr.decay);
        const S = Math.min(1, Math.max(0, adsr.sustain));
        const R = Math.max(0.005, adsr.release);
        const totalLen = Math.max(A + D + 0.05, durSec) + R;

        // 音符音量 (velocity / 127)
        const velGain = Math.max(0, Math.min(1, (sn.velocity || 80) / 100));
        const trackVol = Math.max(0, Math.min(1, (sn.trackVolume || 75) / 100));

        // ── 音量计算（含 Clip 级音量渐变）──
        let baseVol = velGain * trackVol;
        let clipEnvNode = null;  // 可选：clip 包络 gain 节点
        if (sn.volEnvelope && sn.volEnvelope.length >= 2 && sn.clipLength > 0) {
            clipEnvNode = offlineCtx.createGain();
            clipEnvNode.gain.value = 0;
            clipEnvNode.connect(noteGain);
            // noteGain 保持为 ADSR 节点，音频源连接到 clipEnvNode

            // 计算音符在 clip 内的相对时间位置 [0..1]
            const noteT = Math.max(0, Math.min(1,
                (sn.absBeat - sn.clipStartBeat) / sn.clipLength));
            const noteTEnd = Math.max(0, Math.min(1,
                (sn.absBeat + sn.duration * beatDur - sn.clipStartBeat) / (sn.clipLength * beatDur)));

            // 在包络曲线上插值采样
            const _veAt = function(t) {
                var env = sn.volEnvelope;
                for (var i = 0; i < env.length - 1; i++) {
                    if (t >= env[i].t && t <= env[i + 1].t) {
                        var seg = env[i + 1].t - env[i].t;
                        return seg <= 0 ? env[i].v : env[i].v + (env[i + 1].v - env[i].v) * ((t - env[i].t) / seg);
                    }
                }
                return env[env.length - 1].v;
            };
            var veStart = _veAt(noteT);
            var veEnd   = _veAt(noteTEnd);

            // 设置 clip 包络增益（从 veStart 到 veEnd）
            baseVol *= veStart;
            var endVol = velGain * trackVol * Math.max(0.0001, veEnd);

            // 用 linearRamp 实现平滑过渡
            var cg = clipEnvNode.gain;
            cg.setValueAtTime(Math.max(0.0001, baseVol), startTime);
            cg.linearRampToValueAtTime(Math.max(0.0001, endVol), startTime + durSec);
        }

        // 每个音符独立 gain 节点（用于 ADSR 包络）
        // noteGain 已在上面创建并连接到 destGain 或 clipEnvNode

        // 设置 ADSR 包络（基于 baseVol，已含 clip 渐变倍率）
        noteGain.gain.setValueAtTime(0.0001, startTime);
        noteGain.gain.linearRampToValueAtTime(baseVol, startTime + A);
        noteGain.gain.linearRampToValueAtTime(baseVol * S, startTime + A + D);
        noteGain.gain.setValueAtTime(baseVol * S, startTime + Math.max(A + D, durSec));
        noteGain.gain.exponentialRampToValueAtTime(0.0001, startTime + totalLen);

        // 音频源连接目标：clipEnvNode（如果有）或 noteGain
        var audioDest = clipEnvNode || noteGain;

        // 根据音色模式选择音频源
        if (sn.sampleData && sn.sampleData.buffer) {
            // ── 采样模式 ──
            const src = offlineCtx.createBufferSource();
            src.buffer = sn.sampleData.buffer;
            src.playbackRate.value = freq / (sn.sampleData.baseFreq || 261.6256);
            src.connect(audioDest);
            src.start(startTime);
            src.stop(startTime + totalLen + 0.05);
            return true;

        } else if (sn.spectrogramData && sn.spectrogramData.ampData) {
            // ── 语谱图模式 ──
            const result = _synthesizeSpectrogram(offlineCtx, sn.spectrogramData);
            if (result && result.buffer) {
                const src = offlineCtx.createBufferSource();
                src.buffer = result.buffer;
                src.playbackRate.value = freq / (result.baseFreq || 261.6256);
                src.connect(audioDest);
                src.start(startTime);
                src.stop(startTime + totalLen + 0.05);
                return true;
            }
            // 语谱图合成失败，回退到振荡器
        }

        // ── 标准振荡器模式 ──
        const osc = offlineCtx.createOscillator();

        // 尝试使用自定义 timbre（贝塞尔曲线周期波）
        if (sn.instrument && sn.instrument.timbre && sn.instrument.timbre.length > 0) {
            try {
                osc.setPeriodicWave(_buildPeriodicWave(offlineCtx, sn.instrument.timbre));
            } catch (e) {
                osc.type = sn.instrument.waveform || 'sine';
            }
        } else {
            osc.type = (sn.instrument && sn.instrument.waveform) || 'sine';
        }

        osc.frequency.value = freq;
        osc.connect(audioDest);
        osc.start(startTime);
        osc.stop(startTime + totalLen + 0.05);
        return true;
    }

    /* ============================================================
     *  内部：语谱图合成 (在 OfflineAudioContext 中生成 AudioBuffer)
     * ============================================================ */
    function _synthesizeSpectrogram(offlineCtx, specData) {
        const { ampData, canvasW, canvasH, duration, minFreq, maxFreq } = specData;
        if (!ampData || !canvasW || !canvasH || !duration) return null;

        const sr = offlineCtx.sampleRate;
        const baseFreq = 261.6256; // C4

        // 简化的加法合成：32 个频带 × 多谐波
        const numHarmonics = 30;
        const numSamples = Math.floor(duration * sr);
        const output = new Float32Array(numSamples);
        const hopSize = 256;
        const frameSize = 1024;
        const numFrames = Math.ceil(numSamples / hopSize);

        // Hann 窗
        const hann = new Float32Array(frameSize);
        for (let i = 0; i < frameSize; i++) {
            hann[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (frameSize - 1)));
        }

        for (let frame = 0; frame < numFrames; frame++) {
            const t = frame * hopSize / sr;
            const col = Math.min(canvasW - 1, Math.floor((t / duration) * canvasW));

            // 提取 32 频带幅度
            const envelope = new Float32Array(32);
            for (let b = 0; b < 32; b++) {
                let sum = 0, cnt = 0;
                const y0 = Math.floor(b * canvasH / 32);
                const y1 = Math.floor((b + 1) * canvasH / 32);
                for (let y = y0; y < y1 && y < canvasH; y++) {
                    const idx = y * canvasW + col;
                    if (idx >= 0 && idx < ampData.length) { sum += ampData[idx]; cnt++; }
                }
                envelope[b] = cnt > 0 ? sum / cnt : 0;
            }

            // 计算各谐波的幅度
            const partials = [];
            for (let h = 1; h <= numHarmonics; h++) {
                const f = baseFreq * h;
                if (f > maxFreq) break;
                const tf = Math.log(f / minFreq) / Math.log(maxFreq / minFreq);
                const bi = tf * 31;
                const blo = Math.floor(bi);
                const bhi = Math.min(31, blo + 1);
                const frac = bi - blo;
                const amp = envelope[blo] * (1 - frac) + envelope[bhi] * frac;
                if (amp > 0.001) partials.push({ freq: f, amp, phase: Math.random() * 6.2831853 });
            }

            // 叠加到输出
            for (let s = 0; s < frameSize; s++) {
                const gi = frame * hopSize + s;
                if (gi >= numSamples) break;
                let val = 0;
                const st = gi / sr;
                for (const p of partials) {
                    val += p.amp * Math.sin(6.2831853 * p.freq * st + p.phase);
                }
                output[gi] += hann[s] * val / Math.max(1, partials.length);
            }
        }

        // 归一化
        let pk = 0;
        for (let i = 0; i < output.length; i++) {
            if (Math.abs(output[i]) > pk) pk = Math.abs(output[i]);
        }
        if (pk > 0.001) {
            const sc = 0.85 / pk;
            for (let i = 0; i < output.length; i++) output[i] *= sc;
        }

        const buf = offlineCtx.createBuffer(1, numSamples, sr);
        buf.copyToChannel(output, 0);
        return { buffer: buf, baseFreq, duration };
    }

    /* ============================================================
     *  内部：工具函数
     * ============================================================ */
    function _midiToFreq(midi) {
        return 440 * Math.pow(2, (midi - 69) / 12);
    }

    function _buildPeriodicWave(ctx, curve) {
        const N = Math.min(curve.length, 32);
        const real = new Float32Array(N + 1);
        const imag = new Float32Array(N + 1);
        real[0] = 0;
        for (let i = 0; i < N; i++) {
            imag[i + 1] = curve[i] * (1 / (i + 1));
        }
        return ctx.createPeriodicWave(real, imag, { disableNormalization: false });
    }

    function _timestamp() {
        const d = new Date();
        return String(d.getFullYear()).slice(2)
            + String(d.getMonth() + 1).padStart(2, '0')
            + String(d.getDate()).padStart(2, '0')
            + '_' + String(d.getHours()).padStart(2, '0')
            + String(d.getMinutes()).padStart(2, '0')
            + String(d.getSeconds()).padStart(2, '0');
    }

    /* ============================================================
     *  内部：AudioBuffer → WAV Blob (16-bit PCM, 支持单声道/立体声)
     * ============================================================ */
    function _encodeWav(buffer) {
        const nc = buffer.numberOfChannels;
        const sr = buffer.sampleRate;
        const len = buffer.length;
        const dataSize = len * nc * 2;
        const totalSize = 44 + dataSize;
        const ab = new ArrayBuffer(totalSize);
        const dv = new DataView(ab);

        // RIFF header
        _writeStr(dv, 0, 'RIFF');
        dv.setUint32(4, totalSize - 8, true);
        _writeStr(dv, 8, 'WAVE');

        // fmt chunk
        _writeStr(dv, 12, 'fmt ');
        dv.setUint32(16, 16, true);          // chunk size
        dv.setUint16(20, 1, true);           // PCM
        dv.setUint16(22, nc, true);          // channels
        dv.setUint32(24, sr, true);          // sample rate
        dv.setUint32(28, sr * nc * 2, true); // byte rate
        dv.setUint16(32, nc * 2, true);      // block align
        dv.setUint16(34, 16, true);          // bits per sample

        // data chunk
        _writeStr(dv, 36, 'data');
        dv.setUint32(40, dataSize, true);

        // 交错写入 PCM 采样
        const channels = [];
        for (let c = 0; c < nc; c++) channels.push(buffer.getChannelData(c));

        let off = 44;
        for (let i = 0; i < len; i++) {
            for (let c = 0; c < nc; c++) {
                const s = Math.max(-1, Math.min(1, channels[c][i]));
                const s16 = s < 0 ? s * 0x8000 : s * 0x7FFF;
                dv.setInt16(off, s16 | 0, true);
                off += 2;
            }
        }

        return new Blob([ab], { type: 'audio/wav' });
    }

    function _writeStr(dv, off, str) {
        for (let i = 0; i < str.length; i++) {
            dv.setUint8(off + i, str.charCodeAt(i));
        }
    }

    /* ============================================================
     *  内部：触发下载
     * ============================================================ */
    function _downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(function () {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 1000);
    }

    /* ============================================================
     *  进度提示 UI
     * ============================================================ */
    function showProgress(msg) {
        var el = document.getElementById('export-progress');
        if (!el) {
            el = document.createElement('div');
            el.id = 'export-progress';
            el.style.cssText =
                'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);' +
                'background:rgba(30,33,40,0.95);color:#fff;padding:20px 36px;border-radius:12px;' +
                'z-index:9999;font-size:16px;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,0.4);';
            document.body.appendChild(el);
        }
        el.innerHTML = '<div style="margin-bottom:12px;">' + msg + '</div>'
            + '<div style="width:200px;height:4px;background:rgba(255,255,255,0.1);border-radius:2px;overflow:hidden;">'
            + '<div style="width:80%;height:100%;background:#00bcd4;border-radius:2px;'
            + 'animation:export-anim 2s ease-in-out infinite;"></div></div>';
        el.style.display = '';

        if (!document.getElementById('export-anim-style')) {
            var st = document.createElement('style');
            st.id = 'export-anim-style';
            st.textContent = '@keyframes export-anim{0%{width:0}50%{width:85%}100%{width:100%}}';
            document.head.appendChild(st);
        }
    }

    function hideProgress() {
        var el = document.getElementById('export-progress');
        if (el) el.style.display = 'none';
    }

    /* ============================================================
     *  导出
     * ============================================================ */
    return {
        exportToWAV: exportToWAV
    };
})();
