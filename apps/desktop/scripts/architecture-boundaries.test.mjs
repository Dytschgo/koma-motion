import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import {
  architectureBoundaries,
  importViolation,
  packageDependencies,
  repositoryRoot,
} from '../../../scripts/architecture-boundaries.mjs';

const file = (path) => resolve(repositoryRoot, path);
const core = 'packages/core/src/fixture.ts';
const renderer = 'apps/desktop/src/renderer/src/fixture.ts';

function lint(code, path = core) {
  return new Linter({ cwd: repositoryRoot }).verify(
    code,
    [
      {
        files: ['**/*.{ts,tsx,js}'],
        languageOptions: { parser: tseslint.parser },
        plugins: { architecture: { rules: { boundaries: architectureBoundaries } } },
        rules: { 'architecture/boundaries': 'error' },
      },
    ],
    { filename: file(path) },
  );
}

test('package policy matches declared dependencies and peers, including exporter motion validation', async () => {
  for (const [name, allowed] of Object.entries(packageDependencies)) {
    const manifest = JSON.parse(await readFile(file(`packages/${name}/package.json`), 'utf8'));
    const declared = Object.keys({ ...manifest.dependencies, ...manifest.peerDependencies });
    assert.deepEqual([...allowed].sort(), declared.sort(), name);
  }
});

test('the allowed workspace dependency graph contains no cycles', () => {
  const visit = (name, ancestors = []) => {
    assert.ok(!ancestors.includes(name), [...ancestors, name].join(' -> '));
    for (const dependency of packageDependencies[name]) {
      if (dependency.startsWith('@koma-motion/')) {
        visit(dependency.slice('@koma-motion/'.length), [...ancestors, name]);
      }
    }
  };
  for (const name of Object.keys(packageDependencies)) visit(name);
});

test('core forbids external runtime dependencies even in a directory named node', () => {
  for (const module of [
    'node:fs',
    'fs/promises',
    'electron',
    'react',
    'react/jsx-runtime',
    'vitest',
    'lodash',
    '@koma-motion/exporters',
    '@koma-motion/agent-runtime',
    '@koma-motion/motion-engine',
  ]) {
    assert.ok(importViolation(file(core), module), module);
  }
  assert.ok(importViolation(file('packages/core/src/node/fixture.ts'), 'node:fs'));
  for (const module of ['zod', 'zod/v4', './schema/project', '@koma-motion/core/testing']) {
    assert.equal(importViolation(file(core), module), null, module);
  }
});

test('package directions reject desktop and sibling traversal by alias or relative path', () => {
  for (const module of [
    '@koma-motion/desktop',
    '@koma-motion/desktop/src/shared/ipc',
    '../../../apps/desktop/src/shared/ipc',
    '../../core/src/../../../apps/desktop/src/main/index',
    '@koma-motion/renderer',
    '../../renderer/src/index',
  ]) {
    assert.ok(importViolation(file(core), module), module);
  }
  assert.ok(
    importViolation(
      file('packages/motion-engine/src/fixture.ts'),
      '../../project-format/src/index',
    ),
  );
  assert.ok(
    importViolation(file('packages/brand-kit/src/fixture.test.ts'), '@koma-motion/agent-runtime'),
  );
  assert.ok(
    importViolation(
      file('packages/core/src/fixture.test.ts'),
      '../../../apps/desktop/src/shared/ipc',
    ),
  );
  assert.equal(
    importViolation(file('packages/exporters/src/fixture.ts'), '@koma-motion/motion-engine'),
    null,
  );
  assert.equal(
    importViolation(
      file('packages/project-format/src/fixture.ts'),
      '../../motion-engine/src/index',
    ),
    null,
  );
});

test('renderer rejects privileged direct imports and normalized relative bypasses', () => {
  for (const module of [
    'electron',
    'electron/common',
    '@koma-motion/desktop',
    '@koma-motion/exporters',
    'node:fs',
    'fs/promises',
    '@koma-motion/agent-runtime/node',
    '@koma-motion/project-format/node/index',
    '../../main/index',
    '../../shared/../preload/index',
    '../../shared/../main/index',
    '../../../../../packages/agent-runtime/src/node/index',
  ]) {
    assert.ok(importViolation(file(renderer), module), module);
  }
  for (const module of [
    'react',
    '@koma-motion/agent-runtime',
    '@koma-motion/project-format',
    '../../shared/ipc',
    './state/projectStore',
  ]) {
    assert.equal(importViolation(file(renderer), module), null, module);
  }
  assert.ok(
    importViolation(
      file('packages/renderer/src/fixture.ts'),
      '../../project-format/src/node/index',
    ),
  );
  assert.equal(
    importViolation(file('packages/renderer/src/fixture.ts'), 'react/jsx-runtime'),
    null,
  );
});

test('unit-test utilities are narrow exceptions, without waiving package directions', () => {
  for (const path of [
    'packages/core/src/fixture.test.ts',
    'packages/renderer/src/fixture.test.ts',
    'apps/desktop/src/renderer/src/fixture.test.ts',
  ]) {
    for (const module of ['vitest', 'node:fs', 'fs/promises']) {
      assert.equal(importViolation(file(path), module), null, `${path}: ${module}`);
    }
    assert.ok(importViolation(file(path), 'electron'));
  }
  assert.ok(importViolation(file('packages/core/src/fixture.test.ts'), 'react'));
  assert.ok(importViolation(file('packages/core/src/fixture.test.ts'), '@koma-motion/exporters'));
  assert.ok(importViolation(file('packages/core/src/testing/fixture.ts'), 'node:fs'));
  assert.ok(importViolation(file(core), './fixture.test'));
  assert.ok(importViolation(file(renderer), './fixture.test.ts'));
  assert.equal(importViolation(file('packages/core/src/fixture.test.ts'), './another.test'), null);
  if (process.platform === 'win32') {
    assert.ok(importViolation(file(core), '../../../Apps/Desktop/src/shared/ipc'));
    assert.ok(importViolation(file(renderer), '../../Main/index'));
  }
});

test('Node entry points and application main imports remain legitimate', () => {
  for (const path of [
    'packages/agent-runtime/src/node/fixture.ts',
    'packages/project-format/src/node/fixture.ts',
    'packages/exporters/src/powerpoint/fixture.ts',
    'apps/desktop/src/main/fixture.ts',
  ]) {
    assert.equal(importViolation(file(path), 'node:fs/promises'), null, path);
  }
  assert.equal(importViolation(file('apps/desktop/src/preload/fixture.ts'), 'electron'), null);
});

test('portable package entries cannot bring Node code into the renderer transitively', () => {
  for (const [path, module] of [
    ['packages/agent-runtime/src/index.ts', './node'],
    ['packages/project-format/src/index.ts', './node/index'],
    ['packages/project-format/src/helper.ts', './node/atomicFile'],
    ['packages/agent-runtime/src/helper.ts', '@koma-motion/brand-kit/node'],
    ['packages/brand-kit/src/helper.ts', '../../core/src/node/helper'],
  ]) {
    assert.ok(importViolation(file(path), module), `${path}: ${module}`);
  }
  const messages = lint("export * from './node';", 'packages/project-format/src/index.ts');
  assert.equal(messages.length, 1);
  assert.equal(messages[0].ruleId, 'architecture/boundaries');
  assert.equal(
    importViolation(file('packages/project-format/src/node/index.ts'), './atomicFile'),
    null,
  );
  assert.equal(
    importViolation(file('packages/agent-runtime/src/node/index.ts'), '../node/runProcess'),
    null,
  );
  assert.equal(
    importViolation(file('packages/project-format/src/fixture.test.ts'), './node/index'),
    null,
  );
});

test('rule covers static import/export, dynamic import, require and TypeScript import forms', () => {
  for (const code of [
    "import 'node:fs';",
    "import type { BrowserWindow } from 'electron';",
    "export { readFile } from 'node:fs';",
    "export * from '@koma-motion/agent-runtime';",
    "void import('react');",
    'void import(`react`);',
    "require('node:fs');",
    'require(`node:fs`);',
    "type NodeApi = import('node:fs');",
    "import fs = require('node:fs');",
  ]) {
    const messages = lint(code);
    assert.equal(messages.length, 1, code);
    assert.equal(messages[0].ruleId, 'architecture/boundaries', code);
  }
  for (const code of [
    "import { z } from 'zod';",
    "export * from './schema/project';",
    'void import(moduleName);',
  ]) {
    assert.deepEqual(lint(code), [], code);
  }
});

test('actual repository ESLint CLI rejects a forbidden core import with type checking active', async () => {
  const config = await readFile(file('eslint.config.js'), 'utf8');
  assert.match(config, /projectService: true/);
  assert.match(config, /recommendedTypeChecked/);
  const result = spawnSync(
    process.execPath,
    [
      file('node_modules/eslint/bin/eslint.js'),
      '--stdin',
      '--stdin-filename',
      file('packages/core/src/ids.ts'),
    ],
    { cwd: repositoryRoot, input: "import 'node:fs';\n", encoding: 'utf8' },
  );
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /architecture\/boundaries/);
  assert.doesNotMatch(
    result.stdout + result.stderr,
    /Parsing error|ignored|project service.*not found/i,
  );
});
