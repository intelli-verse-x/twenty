import json,subprocess,pathlib,hashlib
root=pathlib.Path(__file__).resolve().parent
run=lambda args:subprocess.check_output(args)
d=json.loads(run(['kubectl','-n','aicart','get','deployment','twenty-server','-o','json']))
spec=d['spec']['template']['spec'];image=(root/'image.txt').read_text().strip()
assert all(c['image']==image for c in spec['containers'])
assert d['spec']['strategy']['rollingUpdate']['maxUnavailable']==0
assert spec['nodeSelector']['kubernetes.io/arch']=='arm64'
assert any(t.get('key')=='arch' and t.get('value')=='arm64' for t in spec['tolerations'])
assert all(next(e for e in c['env'] if e['name']=='DISABLE_DB_MIGRATIONS')['value']=='true' for c in spec['containers'])
assert all(next(e for e in c['env'] if e['name']=='KIOSKX_VOICE_CALL')['value']=='false' for c in spec['containers'])
base=(root/'original-base-image.txt').read_text().strip()
a=json.loads(run(['crane','manifest',base]));b=json.loads(run(['crane','manifest',image]))
assert b['layers'][:-1]==a['layers']
assert len(b['layers'])==len(a['layers'])+1
paths={'hired-desk-queues.js':'engine/core-modules/kioskx-hired-desk/','reach.js':'engine/core-modules/kioskx-hired-desk/','hired-policy.js':'engine/core-modules/kioskx-hired-desk/','kioskx-desk-queues.js':'front/assets/','index.html':'front/'}
hashes={}
for name,folder in paths.items():
 remote=run(['kubectl','-n','aicart','exec','deployment/twenty-server','-c','twenty-server','--','cat','/app/packages/twenty-server/dist/'+folder+name])
 assert remote==(root/name).read_bytes(),name
 hashes[name]=hashlib.sha256(remote).hexdigest()
pods=json.loads(run(['kubectl','-n','aicart','get','pods','-l','app=twenty-server','-o','json']))
receipt={'image':image,'singleLayerOnOriginal':True,'maxUnavailable':0,'architecture':'arm64','tolerationPreserved':True,'migrationsDisabled':True,'otherDialerDisabled':True,'hashes':hashes,'pods':[{'name':p['metadata']['name'],'containers':[{'name':c['name'],'ready':c['ready'],'restarts':c['restartCount']} for c in p['status'].get('containerStatuses',[])]} for p in pods['items']]}
(root/'deployment-receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
print('Verified: single ARM64 layer, both containers, deployment guards and five file hashes.')
