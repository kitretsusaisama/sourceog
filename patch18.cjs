const fs = require('fs');
const file = 'packages/sourceog-renderer/src/rsc-worker-bootstrap.mjs';
let content = fs.readFileSync(file, 'utf8');
content = content.replace('      packages: "external",\n', '');
content = content.replace('      outExtension: { ".js": ".mjs" },\n', '');
fs.writeFileSync(file, content);
