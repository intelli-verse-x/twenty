import json,pathlib,subprocess
root=pathlib.Path(__file__).resolve().parent
image=(root/'image.txt').read_text().strip();base=(root/'rollout-base-image.txt').read_text().strip()
d=json.loads(subprocess.check_output(['kubectl','-n','aicart','get','deployment','twenty-server','-o','json']))
spec=d['spec']['template']['spec']
assert all(c['image']==base for c in spec['containers']),'Live image changed'
assert d['spec']['strategy']['rollingUpdate']['maxUnavailable']==0
assert spec['nodeSelector']['kubernetes.io/arch']=='arm64'
assert any(t.get('key')=='arch' and t.get('value')=='arm64' and t.get('effect')=='NoSchedule' for t in spec['tolerations'])
for c in spec['containers']:
 assert any(e['name']=='DISABLE_DB_MIGRATIONS' and e.get('value')=='true' for e in c['env'])
 assert any(e['name']=='KIOSKX_VOICE_CALL' and e.get('value')=='false' for e in c['env'])
def patch(value):
 body={'spec':{'template':{'spec':{'containers':[{'name':c['name'],'image':value} for c in spec['containers']]}}}}
 subprocess.run(['kubectl','-n','aicart','patch','deployment','twenty-server','--type=strategic','-p',json.dumps(body)],check=True)
patch(image)
try:
 subprocess.run(['kubectl','-n','aicart','rollout','status','deployment/twenty-server','--timeout=180s'],check=True)
except BaseException:
 patch(base)
 subprocess.run(['kubectl','-n','aicart','rollout','status','deployment/twenty-server','--timeout=180s'],check=True)
 raise
print('Deployment Ready; migrations disabled and ARM64 scheduling preserved.')
