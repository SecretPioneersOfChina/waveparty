const fs = require('fs');
let content = fs.readFileSync('spectrogram-designer.js', 'utf8');

// 在 btn-spec-export 绑定后面添加测试音按钮绑定
const searchStr = "panel.querySelector('#btn-spec-export').addEventListener('click', exportWAV);";
const replacement = searchStr + "\n        panel.querySelector('#btn-spec-export-test').addEventListener('click', exportTestTone);";

if (content.includes(searchStr)) {
    content = content.replace(searchStr, replacement);
    console.log('Added test tone button binding');
} else {
    console.log('WARNING: export binding not found');
}

fs.writeFileSync('spectrogram-designer.js', content, 'utf8');
console.log('Done');
