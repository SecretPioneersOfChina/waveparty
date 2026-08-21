const fs = require('fs');
let content = fs.readFileSync('spectrogram-designer.js', 'utf8');

// 添加 exportTestTone 函数 - 在 encodeMonoWav 函数之前
const Search = 'function encodeMonoWav(samples, sampleRate)';
const InsertPos = content.indexOf(Search);
if (InsertPos === -1) { console.log('encodeMonoWav not found'); process.exit(1); }

const NewFn = [
    '    // ==================== 测试音导出（纯正弦波，验证WAV编码是否正确）====================',
    '    function exportTestTone() {',
    '        const sr = SAMPLE_RATE;',
    '        const dur = 2.0;',
    '        const freq = 440;',
    '        const numSamples = Math.floor(dur * sr);',
    '        const samples = new Float32Array(numSamples);',
    '        for (let i = 0; i < numSamples; i++) {',
    '            samples[i] = 0.5 * Math.sin(2 * Math.PI * freq * i / sr);',
    '        }',
    '        console.log("[TestTone] Generated", numSamples, "samples, peak=", Math.max(...samples.map(Math.abs)).toFixed(4));',
    '        const wavBlob = encodeMonoWav(samples, sr);',
    '        const url = URL.createObjectURL(wavBlob);',
    '        const a = document.createElement("a");',
    '        a.href = url; a.download = "test_tone_440Hz.wav";',
    '        document.body.appendChild(a); a.click(); document.body.removeChild(a);',
    '        setTimeout(() => URL.revokeObjectURL(url), 2000);',
    '        showToast("✅ 已导出测试音 test_tone_440Hz.wav");',
    '    }',
    ''
].join('\n');

content = content.substring(0, InsertPos) + NewFn + content.substring(InsertPos);

fs.writeFileSync('spectrogram-designer.js', content, 'utf8');
console.log('exportTestTone function added');
