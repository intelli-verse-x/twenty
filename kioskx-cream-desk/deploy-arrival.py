"""Append desk changes to the running ARM64 image; keep all existing layers/data."""
import io,json,pathlib,subprocess,tarfile,secrets,sys
root=pathlib.Path(__file__).resolve().parent
k=['kubectl','--context','ivx-new-eks','-n','aicart']
def run(a):return subprocess.check_output(a,text=True)
def get(kind,name):return json.loads(run(k+['get',kind,name,'-o','json']))
def apply(x):subprocess.run(k+['apply','-f','-'],input=json.dumps(x),text=True,check=True,stdout=subprocess.DEVNULL)
def patch(kind,name,p):subprocess.run(k+['patch',kind,name,'--type=json','-p',json.dumps(p)],check=True)
if '--desk-only' not in sys.argv:
 # Never print secret values, including during creation.
 if subprocess.run(k+['get','secret','desk-applications-reader'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode:
  apply({'apiVersion':'v1','kind':'Secret','metadata':{'name':'desk-applications-reader'},'stringData':{'token':secrets.token_urlsafe(48)}})
 apply({'apiVersion':'v1','kind':'ConfigMap','metadata':{'name':'desk-applications-reader'},'data':{'application-reader.cjs':(root/'application-reader.cjs').read_text()}})
 d=get('deployment','anideebee-services');spec=d['spec']['template']['spec']
 vols=[v for v in spec['volumes'] if v['name'] not in ['desk-reader-code','desk-reader-key']]+[{'name':'desk-reader-code','configMap':{'name':'desk-applications-reader'}},{'name':'desk-reader-key','secret':{'secretName':'desk-applications-reader'}}]
 reader={'name':'desk-application-reader','image':spec['containers'][0]['image'],'command':['node','/reader/application-reader.cjs'],'ports':[{'containerPort':8081}],'volumeMounts':[{'name':'data','mountPath':'/data','readOnly':True},{'name':'desk-reader-code','mountPath':'/reader','readOnly':True},{'name':'desk-reader-key','mountPath':'/var/run/desk-applications','readOnly':True}],'resources':{'requests':{'cpu':'10m','memory':'32Mi'},'limits':{'memory':'128Mi'}},'readinessProbe':{'tcpSocket':{'port':8081},'initialDelaySeconds':2,'periodSeconds':5}}
 containers=[c for c in spec['containers'] if c['name']!='desk-application-reader']+[reader]
 patch('deployment','anideebee-services',[{'op':'test','path':'/metadata/resourceVersion','value':d['metadata']['resourceVersion']},{'op':'replace','path':'/spec/template/spec/volumes','value':vols},{'op':'replace','path':'/spec/template/spec/containers','value':containers}])
 apply({'apiVersion':'v1','kind':'Service','metadata':{'name':'anideebee-desk-applications'},'spec':{'selector':d['spec']['selector']['matchLabels'],'ports':[{'port':8081,'targetPort':8081}]}})

if '--reader-only' in sys.argv:sys.exit(0)
d=get('deployment','twenty-server');spec=d['spec']['template']['spec']
assert not subprocess.run(['pgrep','-f','[c]odex.*crew-app-wt'],stdout=subprocess.DEVNULL).returncode==0,'Crew still active'
base=next(c['image']for c in spec['containers']if c['name']=='twenty-server')
assert all(c['image']==base for c in spec['containers'])
assert d['spec']['strategy']['rollingUpdate']['maxUnavailable']==0
assert spec['nodeSelector']['kubernetes.io/arch']=='arm64'
assert any(t.get('key')=='arch' and t.get('value')=='arm64' and t.get('effect')=='NoSchedule'for t in spec['tolerations'])
assert all(any(e['name']=='DISABLE_DB_MIGRATIONS'and e.get('value')=='true'for e in c['env'])for c in spec['containers'])
artifacts=root.parent.parent
(artifacts/'base-image.txt').write_text(base+'\n')
entries={name:'engine/core-modules/kioskx-hired-desk/'for name in ['hired-desk-queues.js','desk-company.js','desk-mail-fetch.js','desk-voice.js','desk-applications.js','hired-policy.js']}
entries.update({'kioskx-desk-queues.js':'front/assets/','index.html':'front/'})
layer=artifacts/'arrival-overlay.tar'
with tarfile.open(layer,'w')as tar:
 for name,folder in entries.items():
  data=(root/name).read_bytes();info=tarfile.TarInfo('app/packages/twenty-server/dist/'+folder+name);info.size=len(data);info.mode=0o644;info.uid=1000;info.gid=1000;tar.addfile(info,io.BytesIO(data))
tag=base.split('@')[0].split(':')[0]+':desk-arrival-20261117-v6'
with (artifacts/'append.log').open('w')as log:subprocess.run(['crane','append','--platform','linux/arm64','--base',base,'--new_layer',str(layer),'--new_tag',tag],stdout=log,stderr=log,check=True)
digest=run(['crane','digest',tag]).strip();image=tag.rsplit(':',1)[0]+'@'+digest
config=json.loads(run(['crane','config',image]));assert config['architecture']=='arm64'and config['os']=='linux'
assert json.loads(run(['crane','manifest',image]))['layers'][:-1]==json.loads(run(['crane','manifest',base]))['layers']
(artifacts/'image.txt').write_text(image+'\n')
volumes=[v for v in spec.get('volumes',[])if v['name']not in ['desk-voice-owner','desk-applications-reader']]+[{'name':'desk-voice-owner','secret':{'secretName':'fonoster-env','items':[{'key':x,'path':x}for x in ['APISERVER_OWNER_EMAIL','APISERVER_OWNER_PASSWORD']]}},{'name':'desk-applications-reader','secret':{'secretName':'desk-applications-reader'}}]
for c in spec['containers']:
 c['image']=image
 c['volumeMounts']=[m for m in c.get('volumeMounts',[])if m['name']not in ['desk-voice-owner','desk-applications-reader']]+[{'name':'desk-voice-owner','mountPath':'/var/run/desk-fonoster','readOnly':True},{'name':'desk-applications-reader','mountPath':'/var/run/desk-applications','readOnly':True}]
patch('deployment','twenty-server',[{'op':'test','path':'/metadata/resourceVersion','value':d['metadata']['resourceVersion']},{'op':'replace','path':'/spec/template/spec/containers','value':spec['containers']},{'op':'add','path':'/spec/template/spec/volumes','value':volumes}])
print('Appended one ARM64 layer:',digest)
