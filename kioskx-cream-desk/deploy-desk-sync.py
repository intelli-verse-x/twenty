"""Append one ARM64 layer; preserve mounts/env; install the six-hour desk reader.
Runtime state and layers live outside git. No existing fleet job is modified.
"""
import io, json, os, pathlib, subprocess, sys, tarfile, time
ROOT=pathlib.Path(__file__).resolve().parent
STATE=pathlib.Path('/tmp/desk-sync-release'); STATE.mkdir(exist_ok=True)
K=['kubectl','--context','ivx-new-eks','-n','aicart']
def run(args,**kwargs): return subprocess.check_output(args,**kwargs)
def get(kind,name): return json.loads(run(K+['get',kind,name,'-o','json']))
def apply(obj): subprocess.run(K+['apply','-f','-'],input=json.dumps(obj).encode(),check=True)
def ready(d):
 s=d['status']; n=d['spec'].get('replicas',1)
 return s.get('observedGeneration')==d['metadata']['generation'] and s.get('updatedReplicas')==n and s.get('readyReplicas')==n and s.get('replicas')==n
BACK='app/packages/twenty-server/dist/engine/core-modules/kioskx-hired-desk/'
FILES={'hired-desk-queues.js':BACK,'desk-sync-store.js':BACK,'desk-sync-run.js':BACK,'desk-browser.js':BACK,'desk-sync-seed.json':BACK,'kioskx-desk-queues.js':'app/packages/twenty-server/dist/front/assets/'}
def build():
 d=get('deployment','twenty-server')
 if not ready(d): raise SystemExit('An existing rollout is in flight; leave it running and retry when ready.')
 base=d['spec']['template']['spec']['containers'][0]['image']
 with tarfile.open(STATE/'overlay.tar','w') as tar:
  for name,folder in FILES.items():
   content=(ROOT/name).read_bytes(); info=tarfile.TarInfo(folder+name);info.size=len(content);info.mode=0o644;info.uid=1000;info.gid=1000;tar.addfile(info,io.BytesIO(content))
 repo=base.split('@')[0].split(':')[0]; registry=repo.split('/')[0]
 password=run(['aws','ecr','get-login-password','--region','us-east-1'])
 subprocess.run(['crane','auth','login',registry,'--username','AWS','--password-stdin'],input=password,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,check=True)
 tag=repo+':desk-sync-'+time.strftime('%Y%m%d%H%M%S')
 with (STATE/'build.log').open('wb') as log:
  subprocess.run(['crane','append','--platform','linux/arm64','--base',base,'--new_layer',str(STATE/'overlay.tar'),'--new_tag',tag],stdout=log,stderr=log,check=True)
 digest=run(['crane','digest',tag]).decode().strip(); image=repo+'@'+digest
 config=json.loads(run(['crane','config',image]));assert config['architecture']=='arm64' and config['os']=='linux'
 old=json.loads(run(['crane','manifest',base]));new=json.loads(run(['crane','manifest',image]));assert new['layers'][:-1]==old['layers']
 (STATE/'release.json').write_text(json.dumps({'base':base,'image':image}))
 print('Built linux/arm64 image with exactly one appended layer')
def deploy():
 release=json.loads((STATE/'release.json').read_text());d=get('deployment','twenty-server')
 if not ready(d): raise SystemExit('Existing rollout is in flight; left running.')
 spec=d['spec']['template']['spec']; containers=spec['containers']
 assert all(c['image']==release['base'] for c in containers),'Live base changed; rebuild on the new image'
 assert d['spec']['strategy']['rollingUpdate']['maxUnavailable']==0
 for c in containers:
  assert any(m['name']=='desk-quo' for m in c.get('volumeMounts',[]))
  assert any(e['name']=='DISABLE_DB_MIGRATIONS' and e.get('value')=='true' for e in c['env'])
 live=next(c for c in containers if c['name']=='twenty-server')
 env=[e for e in live['env'] if e['name'] in ['PG_DATABASE_URL','CHATWOOT_API_URL','CHATWOOT_PLATFORM_TOKEN']]
 assert len(env)==3
 env += [{'name':'DESK_BROWSER_TOKEN','valueFrom':{'secretKeyRef':{'name':'desk-browser-auth','key':'token'}}}]
 watch=get('cronjob','hermes-turo-fleet-watch');ws=watch['spec']['jobTemplate']['spec']['template']['spec'];wc=ws['containers'][0]
 gmail=[e for e in wc['env'] if e['name'].startswith('GMAIL_')];assert len(gmail)==3
 volume=next(v for v in ws['volumes'] if v['name']=='script')
 apply({'apiVersion':'v1','kind':'ConfigMap','metadata':{'name':'anideebee-desk-sync-reader'},'data':{'desk-sync-turo.py':(ROOT/'desk-sync-turo.py').read_text()}})
 pod={'restartPolicy':'Never','nodeSelector':{'kubernetes.io/arch':'arm64'},'tolerations':[{'key':'arch','operator':'Equal','value':'arm64','effect':'NoSchedule'}],
 'initContainers':[{'name':'host-mail-read','image':wc['image'],'command':['python','/reader/desk-sync-turo.py'],'env':gmail+[{'name':'PYTHONDONTWRITEBYTECODE','value':'1'}],
 'volumeMounts':[{'name':'fleet-reader','mountPath':'/fleet-reader','readOnly':True},{'name':'desk-reader','mountPath':'/reader','readOnly':True},{'name':'sync','mountPath':'/sync'}],
 'resources':{'requests':{'cpu':'50m','memory':'96Mi'},'limits':{'cpu':'500m','memory':'256Mi'}}}],
 'containers':[{'name':'desk-sync','image':release['image'],'command':['node','/'+BACK+'desk-sync-run.js'],'env':env,
 'volumeMounts':[{'name':'sync','mountPath':'/sync'}], 'resources':{'requests':{'cpu':'50m','memory':'128Mi'},'limits':{'cpu':'500m','memory':'384Mi'}}}],
 'volumes':[{'name':'sync','emptyDir':{}},{'name':'fleet-reader','configMap':volume['configMap']},{'name':'desk-reader','configMap':{'name':'anideebee-desk-sync-reader'}}]}
 cron={'apiVersion':'batch/v1','kind':'CronJob','metadata':{'name':'anideebee-desk-sync','labels':{'app':'anideebee-desk-sync'}},'spec':{'schedule':'0 */6 * * *','timeZone':'America/Chicago','suspend':False,'concurrencyPolicy':'Forbid','startingDeadlineSeconds':1800,'successfulJobsHistoryLimit':2,'failedJobsHistoryLimit':3,'jobTemplate':{'spec':{'backoffLimit':0,'activeDeadlineSeconds':1800,'template':{'spec':pod}}}}}
 # Browser reads now supply the snapshots; retain the previous mail reader source for audit.
 pod.pop('initContainers')
 # Seed is an explicit idempotent insert, not a provider read or message send.
 seed=json.loads(json.dumps(pod));seed.pop('initContainers',None);seed['containers'][0]['command'].append('--seed-only')
 name='anideebee-desk-seed-'+str(int(time.time()))
 apply({'apiVersion':'batch/v1','kind':'Job','metadata':{'name':name},'spec':{'backoffLimit':0,'activeDeadlineSeconds':300,'ttlSecondsAfterFinished':86400,'template':{'spec':seed}}})
 (STATE/'seed-job.txt').write_text(name)
 (STATE/'cronjob.json').write_text(json.dumps(cron))
 print('Seed job created; wait for completion, then run --rollout')
def rollout():
 release=json.loads((STATE/'release.json').read_text());name=(STATE/'seed-job.txt').read_text();job=get('job',name);assert job['status'].get('succeeded')==1,'Seed has not completed'
 d=get('deployment','twenty-server');assert ready(d),'An existing rollout is in flight'
 assert all(c['image']==release['base'] for c in d['spec']['template']['spec']['containers']),'Live base changed'
 patch={'spec':{'template':{'spec':{'containers':[{'name':c['name'],'image':release['image'],'env':[{'name':'DESK_BROWSER_TOKEN','valueFrom':{'secretKeyRef':{'name':'desk-browser-auth','key':'token'}}}]} for c in d['spec']['template']['spec']['containers']]}}}}
 subprocess.run(K+['patch','deployment','twenty-server','--type=strategic','-p',json.dumps(patch)],check=True)
 cron=json.loads((STATE/'cronjob.json').read_text())
 cron['spec']['jobTemplate']['spec']['template']['spec']['containers'][0]['image']=release['image']
 apply(cron)
 print('Deployment rollout started and desk CronJob applied; existing fleet jobs unchanged')
if __name__=='__main__':
 {'--build':build,'--deploy':deploy,'--rollout':rollout}[sys.argv[1]]()
