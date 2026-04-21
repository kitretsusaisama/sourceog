const fs = require('fs');
const files = [
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
  'packages/sourceog-runtime/src/env.ts',
  'packages/sourceog-runtime/src/policy-mesh.ts',
  'packages/sourceog-runtime/src/filesystem-cache-store.ts',
  'packages/sourceog-runtime/src/config.ts',
  'packages/sourceog-runtime/src/artifacts.ts',
  'packages/sourceog-server/src/server.ts',
  'packages/sourceog-testing/src/harness.ts',
  'packages/sourceog/src/bin.ts'
];
let output = '';
for (const file of files) {
  if (fs.existsSync(file)) {
    const content = fs.readFileSync(file, 'utf8');
    if (content.includes('path.') && !content.includes('import path from') && !content.includes('import * as path from')) {
      output += file + '\n';
    }
  }
}
fs.writeFileSync('missing-path.txt', output);
