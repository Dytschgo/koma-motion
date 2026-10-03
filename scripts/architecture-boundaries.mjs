import { isBuiltin } from 'node:module';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));

// Deliberate architecture policy, not an automatically widened manifest allowlist.
export const packageDependencies = {
  core: ['zod'],
  'brand-kit': ['@koma-motion/core', 'zod'],
  'motion-engine': ['@koma-motion/core'],
  'project-format': ['@koma-motion/core', '@koma-motion/motion-engine'],
  'agent-runtime': [
    '@koma-motion/core',
    '@koma-motion/motion-engine',
    '@koma-motion/brand-kit',
    'zod',
  ],
  renderer: ['@koma-motion/core', '@koma-motion/motion-engine', 'react', 'react-dom'],
  exporters: [
    '@koma-motion/core',
    '@koma-motion/motion-engine',
    'image-size',
    'jszip',
    'pptxgenjs',
  ],
};

const slash = (value) => value.replaceAll('\\', '/');
const moduleName = (specifier) =>
  specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];

function location(filename) {
  const relativePath = slash(relative(repositoryRoot, filename));
  const path = process.platform === 'win32' ? relativePath.toLowerCase() : relativePath;
  const packageName = /^packages\/([^/]+)\//.exec(path)?.[1];
  return {
    path,
    packageName,
    desktop: path.startsWith('apps/desktop/'),
    renderer: packageName === 'renderer' || path.startsWith('apps/desktop/src/renderer/'),
    node: /^packages\/[^/]+\/src\/node(?:\/|\.|$)/.test(path),
    privileged: /^apps\/desktop\/src\/(main|preload)(?:\/|\.|$)/.test(path),
    test: path.endsWith('.test.ts'),
    testModule: /\.test(?:\.[cm]?[jt]sx?)?$/.test(path),
  };
}

function targetLocation(filename, specifier) {
  if (specifier.startsWith('@koma-motion/')) {
    const [, name, ...subpath] = specifier.split('/');
    const target = name === 'desktop' ? 'apps/desktop' : `packages/${name}/src`;
    return location(resolve(repositoryRoot, target, ...subpath));
  }
  if (specifier.startsWith('.') || isAbsolute(specifier)) {
    return location(resolve(dirname(filename), slash(specifier)));
  }
  if (specifier.startsWith('file:')) return location(fileURLToPath(specifier));
  return null;
}

export function importViolation(filename, specifier) {
  const source = location(filename);
  if (!source.packageName && !source.renderer) return null;
  const target = targetLocation(filename, specifier);
  const external = moduleName(specifier);
  const node = specifier.startsWith('node:') || isBuiltin(specifier);

  if (!source.test && target?.testModule) return 'Production code cannot import unit-test modules.';
  if (source.packageName && target?.desktop) return 'Packages cannot import apps/desktop.';
  if (
    source.renderer &&
    (external === 'electron' ||
      external === '@koma-motion/desktop' ||
      target?.privileged ||
      target?.node ||
      target?.packageName === 'exporters')
  ) {
    return 'Renderer code cannot import Electron, main/preload code, exporters or package /node entry points.';
  }
  if (source.renderer && node && !source.test)
    return 'Renderer code cannot import Node.js modules.';

  if (!source.packageName) return null;
  if (source.packageName !== 'exporters' && !source.node && !source.test && target?.node) {
    return 'Portable package code cannot import or re-export a package /node entry point.';
  }
  const allowed = packageDependencies[source.packageName] ?? [];
  if (target) {
    if (target.packageName === source.packageName) return null;
    if (target.packageName && allowed.includes(`@koma-motion/${target.packageName}`)) return null;
    return `Package ${source.packageName} cannot depend on ${target.packageName ?? target.path}.`;
  }
  // Unit tests need a runner and filesystem fixtures, but still obey package directions.
  if (source.test && (node || external === 'vitest')) return null;
  if (
    node &&
    (source.packageName === 'exporters' ||
      (['agent-runtime', 'project-format'].includes(source.packageName) && source.node))
  )
    return null;
  if (allowed.includes(external)) return null;
  return `Package ${source.packageName} cannot import ${specifier}; allowed dependencies: ${allowed.join(', ') || 'none'}.`;
}

function staticSpecifier(node) {
  if (node?.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis[0]?.value.cooked;
  }
  return null;
}

export const architectureBoundaries = {
  meta: {
    type: 'problem',
    docs: { description: 'Enforce Koma Motion package and renderer import boundaries.' },
    schema: [],
    messages: { forbidden: '{{reason}} ({{specifier}})' },
  },
  create(context) {
    const check = (node, source) => {
      const specifier = staticSpecifier(source);
      if (specifier === null || specifier === undefined) return;
      const reason = importViolation(context.filename, specifier);
      if (reason) context.report({ node, messageId: 'forbidden', data: { reason, specifier } });
    };
    return {
      ImportDeclaration: (node) => check(node, node.source),
      ExportNamedDeclaration: (node) => check(node, node.source),
      ExportAllDeclaration: (node) => check(node, node.source),
      ImportExpression: (node) => check(node, node.source),
      TSImportType: (node) => check(node, node.argument?.literal ?? node.argument),
      TSImportEqualsDeclaration: (node) => check(node, node.moduleReference.expression),
      CallExpression(node) {
        if (node.callee.type === 'Identifier' && node.callee.name === 'require') {
          check(node, node.arguments[0]);
        }
      },
    };
  },
};
