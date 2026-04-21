const fs = require('fs');
const file = 'packages/sourceog-renderer/src/rsc-worker-bootstrap.mjs';
let content = fs.readFileSync(file, 'utf8');
content = content.replace('      absWorkingDir: process.cwd(),\n', '      absWorkingDir: process.cwd(),\n      format: "esm",\n');
fs.writeFileSync(file, content);
