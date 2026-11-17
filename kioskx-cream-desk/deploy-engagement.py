"""Append Engagement to the running desk image without rebuilding Twenty."""
import io,json,pathlib,subprocess,tarfile,datetime
root=pathlib.Path(__file__).resolve().parent
artifacts=root.parent.parent
k=['kubectl','-n','aicart']
def run(args):return subprocess.check_output(args,text=True)
for folder in ['crew-app-wt','kioskx-desk-arrive']:
 assert subprocess.run(['pgrep','-f','[c]odex.* /Users/macairm3/astra-work/'+folder],stdout=subprocess.DEVNULL).returncode!=0,'Desk writer is active'
d=json.loads(run(k+['get','deployment','twenty-server','-o','json']));spec=d['spec']['template']['spec']
assert d['status'].get('readyReplicas',0)==d['spec']['replicas']
assert d['spec']['strategy']['rollingUpdate']['maxUnavailable']==0
assert spec['nodeSelector']['kubernetes.io/arch']=='arm64'
assert any(t.get('key')=='arch'and t.get('value')=='arm64'and t.get('effect')=='NoSchedule'for t in spec['tolerations'])
assert all(any(e['name']=='DISABLE_DB_MIGRATIONS'and e.get('value')=='true'for e in c['env'])for c in spec['containers'])
base=next(c['image']for c in spec['containers']if c['name']=='twenty-server')
assert all(c['image']==base for c in spec['containers'])
(artifacts/'engagement-base-image.txt').write_text(base+'\n')
entries={name:'engine/core-modules/kioskx-hired-desk/'for name in ['desk-company.js','desk-engagement.js','hired-desk-queues.js','hired-policy.js']}
entries.update({'kioskx-desk-queues.js':'front/assets/','index.html':'front/'})
layer=artifacts/'engagement-overlay.tar'
with tarfile.open(layer,'w')as tar:
 for name,folder in entries.items():
  data=(root/name).read_bytes();info=tarfile.TarInfo('app/packages/twenty-server/dist/'+folder+name);info.size=len(data);info.mode=0o644;info.uid=1000;info.gid=1000;tar.addfile(info,io.BytesIO(data))
repository=base.split('@')[0].split(':')[0]
tag=repository+':desk-engagement-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d%H%M%S')
with (artifacts/'engagement-append.log').open('w')as log:subprocess.run(['crane','append','--platform','linux/arm64','--base',base,'--new_layer',str(layer),'--new_tag',tag],stdout=log,stderr=log,check=True)
image=repository+'@'+run(['crane','digest',tag]).strip()
config=json.loads(run(['crane','config',image]));assert config['architecture']=='arm64'and config['os']=='linux'
assert json.loads(run(['crane','manifest',image]))['layers'][:-1]==json.loads(run(['crane','manifest',base]))['layers']
(artifacts/'engagement-image.txt').write_text(image+'\n')
# Reuse credentials by reference; neither read nor copy their values into the image.
for c in spec['containers']:
 c['image']=image
 updates={'DESK_MAIL_API_TOKEN':{'valueFrom':{'secretKeyRef':{'name':'router-secrets','key':'NOTIFUSE_API_KEY'}}},'DESK_MAIL_API_BASE':{'value':'http://notifuse.intelliverse-x.svc.cluster.local'},'DESK_MAIL_WORKSPACE':{'value':'intelliversex'},'DESK_FIRECRAWL_TOKEN':{'valueFrom':{'secretKeyRef':{'name':'admin-management-studio-shared-keys','key':'STUDIO_FIRECRAWL_TOKEN'}}},'DESK_FIRECRAWL_BASE':{'value':'http://firecrawl-api.aicart.svc.cluster.local:3002'}}
 c['env']=[e for e in c['env']if e['name']not in updates]+[{'name':n,**v}for n,v in updates.items()]
patch=[{'op':'test','path':'/metadata/resourceVersion','value':d['metadata']['resourceVersion']},{'op':'replace','path':'/spec/template/spec/containers','value':spec['containers']}]
subprocess.run(k+['patch','deployment','twenty-server','--type=json','--patch-file=/dev/stdin'],input=json.dumps(patch),text=True,check=True)
print('Published one appended ARM64 layer and started the zero-unavailable rollout.')
