const fs = require('fs');

function encodeMonoWav(samples, sampleRate) {
    const dataLen = samples.length * 2;
    const buf = new ArrayBuffer(44 + dataLen);
    const v = new DataView(buf);
    function w(off, str) { for (let i = 0; i < str.length; i++) v.setUint8(off + i, str.charCodeAt(i)); }
    w(0, 'RIFF'); v.setUint32(4, 36 + dataLen, true); w(8, 'WAVE');
    w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
    v.setUint16(22, 1, true); v.setUint32(24, sampleRate, true);
    v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    w(36, 'data'); v.setUint32(40, dataLen, true);
    let off = 44;
    for (let i = 0; i < samples.length; i++) {
        const s = Math.max(-1, Math.min(1, samples[i]));
        v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        off += 2;
    }
    return new Blob([buf], { type: 'audio/wav' });
}

// 生成 440Hz 测试音
const sr = 44100;
const dur = 1.0;
const numSamples = Math.floor(dur * sr);
const samples = new Float32Array(numSamples);
for (let i = 0; i < numSamples; i++) {
    samples[i] = 0.5 * Math.sin(2 * Math.PI * 440 * i / sr);
}

const blob = encodeMonoWav(samples, sr);
console.log('Blob size:', blob.size);
console.log('Expected size:', 44 + numSamples * 2);

// 将 blob 转为 buffer 并写入文件
const buf = new ArrayBuffer(blob.size);
const view = new Uint8Array(buf);

// 手动编码 WAV 到文件（Node.js 环境）
const dataLen = numSamples * 2;
const wavBuf = new ArrayBuffer(44 + dataLen);
const v = new DataView(wavBuf);
function w(off, str) { for (let i = 0; i < str.length; i++) v.setUint8(off + i, str.charCodeAt(i)); }
w(0, 'RIFF'); v.setUint32(4, 36 + dataLen, true); w(8, 'WAVE');
w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
v.setUint16(22, 1, true); v.setUint32(24, sr, true);
v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
w(36, 'data'); v.setUint32(40, dataLen, true);
let off = 44;
for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    off += 2;
}

fs.writeFileSync('test_tone_440Hz.wav', Buffer.from(wavBuf));
console.log('WAV file written to test_tone_440Hz.wav');

// 验证文件头
const header = Buffer.from(wavBuf, 0, 44);
console.log('RIFF:', header.slice(0, 4).toString());
console.log('WAVE:', header.slice(8, 12).toString());
console.log('fmt :', header.slice(12, 16).toString());
console.log('data:', header.slice(36, 40).toString());
console.log('File size:', header.readUInt32LE(4) + 8);
console.log('Sample rate:', header.readUInt32LE(24));
console.log('Bits per sample:', header.readUInt16LE(34));
console.log('Data size:', header.readUInt32LE(40));

// 检查前几个样本值
const s1 = v.getInt16(44, true);
const s2 = v.getInt16(46, true);
const s3 = v.getInt16(48, true);
console.log('First 3 samples (int16):', s1, s2, s3);
console.log('First 3 samples (float):', s1/32768, s2/32768, s3/32768);
