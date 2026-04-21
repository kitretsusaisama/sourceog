const fs = require('fs');

const { execSync } = require('child_process');
const grepResult = execSync('grep -rn "createHash(" packages/').toString();
const files = new Set();
for (const line of grepResult.split('\n')) {
  if (line) {
    const file = line.split(':')[0];
    if (file.endsWith('.ts') || file.endsWith('.tsx') || file.endsWith('.js') || file.endsWith('.mjs') || file.endsWith('.cjs')) {
      files.add(file);
    }
  }
}

let output = '';
for (const file of files) {
  if (fs.existsSync(file)) {
    const content = fs.readFileSync(file, 'utf8');
    if (!content.includes('import { createHash }') && !content.includes('import crypto from')) {
      output += file + '\n';
      const lines = content.split('\n');
      const index = lines.findIndex(l => l.startsWith('import'));
      if (index !== -1) {
        lines.splice(index, 0, 'import { createHash } from "node:crypto";');
        fs.writeFileSync(file, lines.join('\n'));
      }
    }
  }
}
fs.writeFileSync('missing-createHash.txt', output);
