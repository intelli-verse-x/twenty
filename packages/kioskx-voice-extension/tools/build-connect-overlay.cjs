// Restore setup on the pinned working image without changing its module graph or call service.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const [input, output] = process.argv.slice(2);
const front = path.join(output, 'app/packages/twenty-server/dist/front');
const extension = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(input, 'index.html'), 'utf8');
if (!html.includes('/assets/index-email-call-0862f92d1c3b.js') || html.includes('kioskx-voice-connect.js')) {
  throw new Error('Expected the unmodified working email/call image');
}
fs.mkdirSync(path.join(front, 'assets'), { recursive: true });
fs.writeFileSync(path.join(front, 'index.html'), html.replace('</head>',
  '<script defer src="/assets/kioskx-voice-connect.js"></script></head>'));
fs.copyFileSync(path.join(extension, 'connect-ui.js'), path.join(front, 'assets/kioskx-voice-connect.js'));
execFileSync('zip', ['-q', '-j', path.join(front, 'assets/kioskx-voice-extension.zip'),
  ...['manifest.json', 'background.js', 'desk.js', 'privacy.js'].map(name => path.join(extension, name))]);
console.log('Setup overlay built; application bundles and call service unchanged.');
