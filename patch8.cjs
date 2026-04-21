const fs = require('fs');
const file = 'packages/sourceog-compiler/src/boundary.ts';
const content = fs.readFileSync(file, 'utf8');
const lines = content.split('\n');
const index = lines.findIndex(l => l.startsWith('import'));
lines.splice(index, 0, 'import path from "node:path";');
fs.writeFileSync(file, lines.join('\n'));
