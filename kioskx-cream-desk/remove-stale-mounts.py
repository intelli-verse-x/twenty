import json,subprocess
cmd=['kubectl','-n','aicart'];d=json.loads(subprocess.check_output(cmd+['get','deployment','twenty-server','-o','json']));spec=d['spec']['template']['spec']
patch=[]
for ci,c in enumerate(spec['containers']):
 for i in reversed(range(len(c.get('volumeMounts',[])))):
  m=c['volumeMounts'][i]
  if m['name']=='desk-fix':
   assert m['subPath'] in ['hired-desk-queues.js','kioskx-desk-queues.js','index.html']
   patch.extend([{'op':'test','path':f'/spec/template/spec/containers/{ci}/volumeMounts/{i}/name','value':'desk-fix'},{'op':'remove','path':f'/spec/template/spec/containers/{ci}/volumeMounts/{i}'}])
for i in reversed(range(len(spec.get('volumes',[])))):
 if spec['volumes'][i]['name']=='desk-fix':patch.append({'op':'remove','path':f'/spec/template/spec/volumes/{i}'})
assert patch
subprocess.run(cmd+['patch','deployment','twenty-server','--type=json','-p',json.dumps(patch)],check=True)
