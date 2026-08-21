const fs = require('fs');
let content = fs.readFileSync('spectrogram-designer.js', 'utf8');

// 找 exportWAV 函数的精确范围
const startMarker = 'function exportWAV()';
const startIdx = content.indexOf(startMarker);
if (startIdx === -1) { console.log('ERROR: exportWAV not found'); process.exit(1); }

// 找函数结尾：下一个顶级 function 或 return { 或 ^\s*\}
// 从 startIdx 往后找
let depth = 0;
let endIdx = -1;
let inFunc = false;
let braceStart = -1;

for (let i = startIdx; i < content.length; i++) {
    if (content[i] === '{') {
        if (!inFunc) { inFunc = true; braceStart = i; }
        depth++;
    } else if (content[i] === '}') {
        depth--;
        if (inFunc && depth === 0) {
            endIdx = i + 1;
            break;
        }
    }
}

console.log('exportWAV: from', startIdx, 'to', endIdx);
console.log('Current code:', content.substring(startIdx, endIdx));

const newExport = [
    'function exportWAV() {',
    '        // 诊断: 输出 ampData 统计信息',
    '        let dataSum = 0, dataMax = 0, dataNonZero = 0;',
    '        if (ampData && ampData.length > 0) {',
    '            for (let i = 0; i < ampData.length; i++) {',
    '                if (ampData[i] > 0.001) { dataNonZero++; dataSum += ampData[i]; }',
    '                if (ampData[i] > dataMax) dataMax = ampData[i];',
    '            }',
    '        }',
    '        console.log("[Export] ampData stats:", {',
    '            length: ampData ? ampData.length : "NULL",',
    '            nonZero: dataNonZero, max: dataMax.toFixed(4),',
    '            avg: (dataSum / Math.max(1, dataNonZero)).toFixed(4)',
    '        });',
    '',
    '        // 如果语谱图没有内容但有波形设计数据，使用波形设计导出',
    '        if ((!ampData || dataNonZero < 10) && window._wdOscillators) {',
    '            console.log("[Export] Using wave design export (spectrogram empty)");',
    '            if (window.__wdExportWAV) { window.__wdExportWAV(); return; }',
    '        }',
    '',
    '        const samples = synthesize();',
    '        let _peak = 0;',
    '        for (let i = 0; i < samples.length; i++) {',
    '            const _a = Math.abs(samples[i]);',
    '            if (_a > _peak) _peak = _a;',
    '        }',
    '        console.log("[Export] synthesized peak:", _peak.toFixed(6));',
    '',
    '        if (_peak < 0.001) { showToast("\\u26a0\\ufe0f 语谱图为空！请在画布上绘制内容后再导出。"); return; }',
    '',
    '        // 用时间戳避免浏览器缓存旧文件',
    '        const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);',
    '        const wavBlob = encodeMonoWav(samples, SAMPLE_RATE);',
    '        const url = URL.createObjectURL(wavBlob);',
    '        const a = document.createElement("a");',
    '        a.href = url; a.download = "timbre_" + ts + ".wav";',
    '        document.body.appendChild(a); a.click(); document.body.removeChild(a);',
    '        setTimeout(() => URL.revokeObjectURL(url), 2000);',
    '        showToast("\\u2705 已导出 " + ts + ".wav (峰值:" + _peak.toFixed(3) + ")");',
    '    }'
].join('\n');

content = content.substring(0, startIdx) + newExport + content.substring(endIdx);

fs.writeFileSync('spectrogram-designer.js', content, 'utf8');

// 验证
try {
    new Function(content);
    console.log('Syntax OK - replacement done');
} catch(e) {
    console.log('Syntax error:', e.message);
}
