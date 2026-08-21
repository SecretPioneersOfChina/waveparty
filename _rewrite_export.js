const fs = require('fs');
let content = fs.readFileSync('spectrogram-designer.js', 'utf8');

// 彻底重写 exportWAV - 添加暴力调试和多种导出方式
const OldExport = content.substring(
    content.indexOf('function exportWAV() {'),
    content.indexOf('function encodeMonoWav')
);

console.log('Current exportWAV length:', OldExport.length);

// 全新重写
const NewExport = [
    'function exportWAV() {',
    '        // ===== 调试模式：无论什么情况都导出测试音 =====',
    '        // 先检查 ampData',
    '        let info = { ampDataNull: ampData === null, ampDataLen: ampData ? ampData.length : 0 };',
    '        if (ampData) {',
    '            let nz = 0, mx = 0;',
    '            for (let i = 0; i < ampData.length; i++) {',
    '                if (ampData[i] > 0.001) nz++;',
    '                if (ampData[i] > mx) mx = ampData[i];',
    '            }',
    '            info.nonZero = nz; info.max = mx;',
    '        }',
    '        console.log(\"[Export] ampData info:\", info);',
    '',
    '        // 方式1: 直接合成',
    '        const samples = synthesize();',
    '        let pk = 0;',
    '        for (let i = 0; i < samples.length; i++) {',
    '            const a = Math.abs(samples[i]);',
    '            if (a > pk) pk = a;',
    '        }',
    '        console.log(\"[Export] synthesize peak:\", pk);',
    '',
    '        // 如果合成结果是静音，用纯正弦波代替（调试）',
    '        let finalSamples = samples;',
    '        if (pk < 0.001) {',
    '            console.warn(\"[Export] synthesize returned silence, using fallback sine wave\");',
    '            const sr = SAMPLE_RATE;',
    '            const dur = 2.0;',
    '            finalSamples = new Float32Array(Math.floor(dur * sr));',
    '            for (let i = 0; i < finalSamples.length; i++) {',
    '                finalSamples[i] = 0.3 * Math.sin(2 * Math.PI * 440 * i / sr);',
    '            }',
    '            showToast(\"⚠️ 合成结果为静音，已导出440Hz测试音（调试）\");',
    '        }',
    '',
    '        const wavBlob = encodeMonoWav(finalSamples, SAMPLE_RATE);',
    '        const url = URL.createObjectURL(wavBlob);',
    '        const a = document.createElement(\"a\");',
    '        a.href = url; a.download = \"export_\" + Date.now() + \".wav\";',
    '        document.body.appendChild(a); a.click();',
    '        setTimeout(() => { try { document.body.removeChild(a); } catch(e) {} }, 100);',
    '        setTimeout(() => URL.revokeObjectURL(url), 3000);',
    '        showToast(\"✅ 已导出 WAV (峰值:\" + pk.toFixed(3) + \")\");',
    '    }',
    ''
].join('\n');

const EncodeIdx = content.indexOf('function encodeMonoWav');
content = content.substring(0, content.indexOf('function exportWAV() {')) + NewExport + content.substring(EncodeIdx);

fs.writeFileSync('spectrogram-designer.js', content, 'utf8');
console.log('exportWAV rewritten');
