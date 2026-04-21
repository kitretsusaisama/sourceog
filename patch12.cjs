const fs = require('fs');
const file = 'packages/sourceog-renderer/src/rsc-worker-bootstrap.mjs';
let content = fs.readFileSync(file, 'utf8');
content = content.replace('      packages: "external",\n', '');
content = content.replace('      bundle: true,', '      bundle: true,\n      packages: "external",\n      outExtension: { ".js": ".mjs" },');
fs.writeFileSync(file, content);
