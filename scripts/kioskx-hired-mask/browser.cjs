const { createRequire } = require('node:module');
const deps = process.env.MASK_TEST_DEPS;
if (!deps)
  throw new Error('Set MASK_TEST_DEPS to an isolated dependency directory');
const dep = createRequire(require('node:path').join(deps, 'package.json'));
const esbuild = dep('esbuild');
const path = require('path');
const fs = require('fs');
const root = path.resolve(__dirname, '../..');
const component = path.join(
  root,
  'packages/twenty-front/src/modules/kioskx-hired-mask/KioskxHiredContact.tsx',
);
fs.writeFileSync(
  path.join(deps, 'entry.tsx'),
  `import React from 'react';import {createRoot} from 'react-dom/client';import {KioskxHiredContact} from ${JSON.stringify(component)};createRoot(document.getElementById('root')!).render(<KioskxHiredContact personId="11111111-1111-4111-8111-111111111111"/>);`,
);
fs.writeFileSync(
  path.join(deps, 'apollo-react.ts'),
  "export const useQuery = () => ({data: {kioskxDeskContact: window.__contact}});\nexport const useMutation = () => [async (args) => {window.__requests.push(args.variables.input);return {data:{kioskxDeskAction:{ok:true,status:args.variables.input.action==='email'?'sent':'callStarted'}}}}, {loading:false}];\n",
);
fs.writeFileSync(
  path.join(deps, 'apollo.ts'),
  'export const gql = () => ({});\n',
);
esbuild.buildSync({
  entryPoints: [path.join(deps, 'entry.tsx')],
  bundle: true,
  outfile: path.join(deps, 'browser.js'),
  jsx: 'automatic',
  nodePaths: [path.join(deps, 'node_modules')],
  alias: {
    '@apollo/client/react': path.join(deps, 'apollo-react.ts'),
    '@apollo/client': path.join(deps, 'apollo.ts'),
  },
});
