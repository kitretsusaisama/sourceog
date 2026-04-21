const fs = require('fs');
const content = fs.readFileSync('packages/sourceog-server/src/server.ts', 'utf8');
const lines = content.split('\n');
if (!lines.find(l => l.includes('promises as fs'))) {
  const index = lines.findIndex(l => l.startsWith('import { createServer as createNetServer } from "node:net";'));
  lines.splice(index + 1, 0, 'import { promises as fs } from "node:fs";');
  fs.writeFileSync('packages/sourceog-server/src/server.ts', lines.join('\n'));
}
