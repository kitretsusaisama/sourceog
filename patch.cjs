const fs = require('fs');
const content = fs.readFileSync('packages/sourceog-server/src/server.ts', 'utf8');
const lines = content.split('\n');
lines.splice(367, 0, '    const onListening = () => {');
fs.writeFileSync('packages/sourceog-server/src/server.ts', lines.join('\n'));
