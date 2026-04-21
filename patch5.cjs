const fs = require('fs');

const filesToPatch = [
  'packages/sourceog-compiler/src/doctor.ts',
  'packages/sourceog-compiler/src/verify.ts',
  'packages/sourceog-compiler/src/client.ts',
  'packages/sourceog-compiler/src/boundary.ts',
  'packages/sourceog-compiler/src/support-matrix.ts',
  'packages/sourceog-compiler/src/evidence.ts',
  'packages/sourceog-compiler/src/manifests.ts',
  'packages/sourceog-compiler/src/build.ts',
  'packages/sourceog-compiler/src/release.ts',
  'packages/sourceog-compiler/src/inspect.ts',
  'packages/sourceog-dev/src/hmr.ts',
  'packages/sourceog-platform/src/module-loader.ts',
  'packages/sourceog-renderer/src/render.ts',
  'packages/sourceog-router/src/scan.ts',
  'packages/sourceog-runtime/src/isr-coordinator.ts',
  'packages/sourceog-runtime/src/policy-mesh.ts',
  'packages/sourceog-runtime/src/artifacts.ts',
  'packages/sourceog-server/src/server.ts',
  'packages/sourceog-testing/src/harness.ts'
];

for (const file of filesToPatch) {
  if (fs.existsSync(file)) {
    let content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n');
    let hasFsPromises = false;
    for (const line of lines) {
      if (line.includes('promises as fs') || line.includes('fs/promises') || line.includes('node:fs/promises')) {
        hasFsPromises = true;
        break;
      }
    }

    if (!hasFsPromises) {
       const index = lines.findIndex(l => l.startsWith('import'));
       if (index !== -1) {
         lines.splice(index, 0, 'import { promises as fs } from "node:fs";');
         fs.writeFileSync(file, lines.join('\n'));
       }
    }
  }
}
