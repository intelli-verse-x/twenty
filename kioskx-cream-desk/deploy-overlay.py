import json,pathlib,subprocess
root=pathlib.Path(__file__).resolve().parent
image=(root/'image.txt').read_text().strip();base=(root/'rollout-base-image.txt').read_text().strip()
d=json.loads(subprocess.check_output(['kubectl','-n','aicart','get','deployment','twenty-server','-o','json']))
spec=d['spec']['template']['spec']
assert next(c['image'] for c in spec['containers'] if c['name']=='twenty-server')==base,'Live base changed'
assert d['spec']['strategy']['rollingUpdate']['maxUnavailable']==0
assert spec['nodeSelector']['kubernetes.io/arch']=='arm64'
assert any(t.get('key')=='arch' and t.get('value')=='arm64' for t in spec['tolerations'])
for c in spec['containers']:
 assert any(e['name']=='DISABLE_DB_MIGRATIONS' and e.get('value')=='true' for e in c['env'])
 assert not any(e['name']=='DESK_QUEUE_MAIL' for e in c['env'])
patch={'spec':{'template':{'spec':{'containers':[{'name':c['name'],'image':image,'env':[{'name':'TELNYX_TOKEN','valueFrom':{'secretKeyRef':{'name':'telnyx-mcp-secret','key':'TELNYX_TOKEN'}}}]} for c in spec['containers']]}}}}
subprocess.run(['kubectl','-n','aicart','patch','deployment','twenty-server','--type=strategic','-p',json.dumps(patch)],check=True)
