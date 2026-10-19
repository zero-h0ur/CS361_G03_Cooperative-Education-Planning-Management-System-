import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';

const workspace = resolve(import.meta.dirname, '..');
const outputDirectory = resolve(workspace, 'dist');
const staticFiles = [
  'index.html',
  'requirements.html',
  'company-directory.html',
  'faq.html',
  'style.css',
  'company-directory.js',
  'company-directory-helpers.js',
  'navbar-auth.js',
  'app.html'
];

const DEFAULT_API_BASE_URL = 'https://qtqlsb1aec.execute-api.us-east-1.amazonaws.com';
const REQUIRED_AUTH_KEYS = [
  'CO_ED_COGNITO_USER_POOL_ID',
  'CO_ED_COGNITO_CLIENT_ID',
  'CO_ED_COGNITO_DOMAIN',
  'CO_ED_APP_ORIGIN'
];

function normalizeOrigin(value) {
  if (!value) {
    return '';
  }

  const parsed = new URL(value);
  if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error('CO_ED_APP_ORIGIN must contain only scheme and host.');
  }
  if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost') {
    throw new Error('CO_ED_APP_ORIGIN must use HTTPS outside localhost.');
  }

  return parsed.origin;
}

function validateDomain(domain) {
  if (domain && (domain.includes('://') || domain.includes('/'))) {
    throw new Error('CO_ED_COGNITO_DOMAIN must be a host name without a scheme or path.');
  }
  return domain;
}

function serializeForInlineScript(value) {
  return JSON.stringify(value, null, 2)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function createRuntimeConfig() {
  const requireAuth = process.env.CO_ED_REQUIRE_AUTH_CONFIG === '1';
  if (requireAuth) {
    const missing = REQUIRED_AUTH_KEYS.filter((key) => !process.env[key]?.trim());
    if (missing.length > 0) {
      throw new Error(`Missing required public auth configuration: ${missing.join(', ')}`);
    }
  }

  const appOrigin = normalizeOrigin(process.env.CO_ED_APP_ORIGIN?.trim() || '');
  const apiBaseUrl = process.env.CO_ED_API_BASE_URL?.trim() || DEFAULT_API_BASE_URL;
  const domain = validateDomain(process.env.CO_ED_COGNITO_DOMAIN?.trim() || '');

  return {
    apiBaseUrl,
    auth: {
      userPoolId: process.env.CO_ED_COGNITO_USER_POOL_ID?.trim() || '',
      userPoolClientId: process.env.CO_ED_COGNITO_CLIENT_ID?.trim() || '',
      domain,
      redirectSignIn: appOrigin ? `${appOrigin}/app.html` : '/app.html',
      redirectSignOut: appOrigin ? `${appOrigin}/index.html` : '/index.html',
      scopes: ['openid', 'email', 'coed-api/access']
    }
  };
}

function renderRuntimeConfig(config) {
  return `(function configureCoEd(root) {\n  root.CO_ED_CONFIG = Object.freeze(${serializeForInlineScript(config)});\n})(window);\n`;
}

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(resolve(outputDirectory, 'assets'), { recursive: true });

await Promise.all([
  ...staticFiles.map((file) => cp(resolve(workspace, file), resolve(outputDirectory, file))),
  cp(resolve(workspace, 'resources'), resolve(outputDirectory, 'resources'), {
    recursive: true
  }),
  writeFile(
    resolve(outputDirectory, 'runtime-config.js'),
    renderRuntimeConfig(createRuntimeConfig()),
    'utf8'
  )
]);

await build({
  entryPoints: [resolve(workspace, 'src/frontend/app.js')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2020'],
  outfile: resolve(outputDirectory, 'assets/authenticated-shell.js'),
  minify: process.env.NODE_ENV === 'production',
  sourcemap: process.env.NODE_ENV !== 'production',
  legalComments: 'none',
  logLevel: 'info'
});
