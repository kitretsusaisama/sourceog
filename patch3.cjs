const fs = require('fs');
const content = fs.readFileSync('packages/sourceog-compiler/src/verify.ts', 'utf8');
const lines = content.split('\n');
for (let i = 0; i < lines.length; i++) {
  lines[i] = lines[i].replace(/fs\.promises\.writeFile/g, 'fs.writeFile');
}
fs.writeFileSync('packages/sourceog-compiler/src/verify.ts', lines.join('\n'));
