const fs = require('fs');
const file = 'packages/sourceog-compiler/src/boundary.ts';
const content = fs.readFileSync(file, 'utf8');
const lines = content.split('\n');
const index = lines.findIndex(l => l.includes('SOURCEOG_MANIFEST_VERSION'));
if (index !== -1) {
  lines[index] = lines[index].replace('SOURCEOG_MANIFEST_VERSION', 'SOURCEOG_MANIFEST_VERSION, CONTRACTS_MANIFEST_VERSION');
  fs.writeFileSync(file, lines.join('\n'));
} else {
  console.log("SOURCEOG_MANIFEST_VERSION not found");
}
