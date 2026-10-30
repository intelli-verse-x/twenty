// Patch only this concern onto the pinned production image; never build the old front.
const fs = require('node:fs');
const path = require('node:path');
const ts = require(process.env.TYPESCRIPT_PATH || 'typescript');
const input = process.argv[2];
const output = process.argv[3];
const root = path.resolve(__dirname, '../../..');
const src = path.join(root, 'packages/twenty-server/src/engine/core-modules/kioskx-hired-desk');
const server = path.join(output, 'app/packages/twenty-server/dist/engine/core-modules/kioskx-hired-desk');
const front = path.join(output, 'app/packages/twenty-server/dist/front');
fs.mkdirSync(server, { recursive: true }); fs.mkdirSync(path.join(front, 'assets'), { recursive: true });
function selected(file, names) {
  const code = fs.readFileSync(path.join(src, file), 'utf8');
  const ast = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true);
  const cls = ast.statements.find(ts.isClassDeclaration);
  return cls.members.filter(m => names.includes(m.name?.getText(ast))).map(m => m.getText(ast)).join('\n');
}
const serviceNames = ['voiceOn', 'bridgeSession', 'bridgeConfig', 'bridge', 'call', 'importVoiceTranscript'];
const serviceCode = `const {createHash, publicEncrypt, createPublicKey, constants}=require('node:crypto');
const {HIRED_WORKSPACE}=require('./hired-policy');
class VoiceMethods { ${selected('hired-desk.service.ts', serviceNames)} }
exports.install = C => { for(const name of ${JSON.stringify(serviceNames)})
Object.defineProperty(C.prototype,name,Object.getOwnPropertyDescriptor(VoiceMethods.prototype,name));
C.prototype.bridgeNote='4694fd8b-c7e3-4d0a-9e57-703253445802'; };`;
const compile = code => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.CommonJS, experimentalDecorators: true, emitDecoratorMetadata: false } }).outputText;
fs.writeFileSync(path.join(server,'hired-google-voice-overlay.js'),compile(serviceCode));
let service = fs.readFileSync(path.join(input,'hired-desk.service.js'),'utf8');
service += "\nrequire('./hired-google-voice-overlay').install(HiredDeskService);\n";
fs.writeFileSync(path.join(server,'hired-desk.service.js'),service);
// Add routes without replacing the live activity, notes, or email routes.
let controller = fs.readFileSync(path.join(input,'hired-desk.controller.js'),'utf8');
const names = ['voiceConfig','voiceBridge','voiceTranscript'];
const methods = selected('hired-desk.controller.ts',names).replace(/^\s*@[^\n]+\n/gm,'')
  .replace(/@Req\(\) /g,'').replace(/@Body\(\) /g,'');
const controllerCode = `const {ForbiddenException}=require('@nestjs/common');
const {ExtractJwt}=require('passport-jwt');
const {HIRED_WORKSPACE,isHiredDesk}=require('./hired-policy');
class VoiceController { ${methods} }
exports.install = C => {
const common=require('@nestjs/common');
for(const [name,route,verb] of [['voiceConfig','voice-config','Get'],['voiceBridge','voice-bridge','Post'],['voiceTranscript','voice-transcript','Post']]) {
Object.defineProperty(C.prototype,name,Object.getOwnPropertyDescriptor(VoiceController.prototype,name));
const desc=Object.getOwnPropertyDescriptor(C.prototype,name);
common[verb](route)(C.prototype,name,desc); common.Header('Cache-Control','no-store')(C.prototype,name,desc);
common.Req()(C.prototype,name,0); if(verb==='Post') common.Body()(C.prototype,name,1);
} };`;
fs.writeFileSync(path.join(server,'hired-google-voice-routes.js'),compile(controllerCode));
controller += "\nrequire('./hired-google-voice-routes').install(HiredDeskController);\n";
fs.writeFileSync(path.join(server,'hired-desk.controller.js'),controller);
let policy=fs.readFileSync(path.join(input,'hired-policy.js'),'utf8');
policy=policy.replace("'/kioskx-hired-desk/leads'", "'/kioskx-hired-desk/leads', '/kioskx-hired-desk/voice-config'")
.replace("'/kioskx-hired-desk/call'", "'/kioskx-hired-desk/call', '/kioskx-hired-desk/voice-bridge'");
fs.writeFileSync(path.join(server,'hired-policy.js'),policy);
let entry=fs.readFileSync(path.join(input,'entry.js'),'utf8');
function replace(old,next) { if(entry.split(old).length!==2) throw Error('Pinned front does not match'); entry=entry.replace(old,next); }
replace('I(s.status==="placed"),g(s.status==="placed"?"Call placed":s.status==="unavailable"?"Calling is unavailable. Contact your admin.":"Call status is unavailable. Contact your admin before trying again."),s.status==="unavailable"&&(L.current=void 0)',
'I(s.status==="queued"),g(s.status==="queued"?"Sent to Google Voice. Answer your linked phone if it rings. Call outcome and transcript are not yet available.":s.status==="connect"?"Use Connect Google Voice, then try Call again.":s.status==="unavailable"?"Calling is unavailable. Contact your admin.":"Call status is unknown. Contact your admin before trying again."),(s.status==="unavailable"||s.status==="connect")&&(L.current=void 0)');
// Keep the same module URL: other live chunks import this entry. A second URL
// evaluates it twice and breaks /welcome with duplicate selection registration.
const name='index-email-call-0862f92d1c3b.js';
fs.writeFileSync(path.join(front,'assets',name),entry);
let html=fs.readFileSync(path.join(input,'index.html'),'utf8');
if(!html.includes('/assets/'+name) || /index-gv-/.test(html)) throw Error('Wrong base front');
if (!html.includes('/assets/kioskx-voice-connect.js'))
  html=html.replace('</head>','<script defer src="/assets/kioskx-voice-connect.js"></script></head>');
if (html.split('/assets/kioskx-voice-connect.js').length !== 2) throw Error('Duplicate Connect script');
fs.writeFileSync(path.join(front,'index.html'),html);
fs.copyFileSync(path.join(root,'packages/kioskx-voice-extension/connect-ui.js'),path.join(front,'assets/kioskx-voice-connect.js'));
console.log('Overlay built; pinned front patched only at call response.');

require('node:child_process').execFileSync('zip',['-q','-j',path.join(front,'assets/kioskx-voice-extension.zip'),...['manifest.json','background.js','desk.js','privacy.js'].map(n=>path.join(root,'packages/kioskx-voice-extension',n))]);
