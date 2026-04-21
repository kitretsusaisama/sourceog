const fs = require('fs');

const filesToPatch = [
  'packages/sourceog-renderer/src/transpiler/worker-bootstrap.ts',
  'packages/sourceog-renderer/src/transpiler/transpiler-core.ts',
  'packages/sourceog-renderer/src/rsc/compat-module-loader.ts',
  'packages/sourceog-router/src/index.ts',
  'packages/sourceog-router/src/scan.ts',
  'packages/sourceog-runtime/src/isr-coordinator.ts',
  'packages/sourceog-runtime/src/env.ts',
  'packages/sourceog-runtime/src/policy-mesh.ts',
  'packages/sourceog-runtime/src/filesystem-cache-store.ts',
  'packages/sourceog-runtime/src/config.ts',
  'packages/sourceog-runtime/src/artifacts.ts',
  'packages/sourceog-server/src/server.ts',
  'packages/sourceog-testing/src/harness.ts',
  'packages/sourceog/src/bin.ts'
];

for (const file of filesToPatch) {
  if (fs.existsSync(file)) {
    let content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n');
    let hasPath = false;
    for (const line of lines) {
      if (line.includes('import path from') || line.includes('import * as path from')) {
        hasPath = true;
        break;
      }
    }

    if (!hasPath) {
       const index = lines.findIndex(l => l.startsWith('import'));
       if (index !== -1) {
         lines.splice(index, 0, 'import path from "node:path";');
         fs.writeFileSync(file, lines.join('\n'));
       }
    }
  }
}
