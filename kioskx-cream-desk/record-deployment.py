import json,pathlib,subprocess,hashlib,difflib
root=pathlib.Path(__file__).resolve().parent
cmd=['kubectl','-n','aicart'];d=json.loads(subprocess.check_output(cmd+['get','deployment','twenty-server','-o','json']));s=d['spec']['template']['spec'];image=(root/'image.txt').read_text().strip()
assert all(c['image']==image for c in s['containers'])
assert d['status']['availableReplicas']==1 and d['status']['updatedReplicas']==1
assert not any(m.get('name')=='desk-fix' for c in s['containers'] for m in c.get('volumeMounts',[]))
paths={'hired-desk-queues.js':'engine/core-modules/kioskx-hired-desk/','hired-policy.js':'engine/core-modules/kioskx-hired-desk/','kioskx-desk-queues.js':'front/assets/','index.html':'front/'}
hashes={}
for f,folder in paths.items():
 remote=subprocess.check_output(cmd+['exec','deployment/twenty-server','-c','twenty-server','--','sha256sum','/app/packages/twenty-server/dist/'+folder+f],text=True).split()[0]
 assert remote==hashlib.sha256((root/f).read_bytes()).hexdigest()
 hashes[f]=remote
r={'image':image,'initialBase':'sha256:a146b4743290571f4d03e323538306b7317b717851e064227fc1890009ffe413','strategy':d['spec']['strategy'],'nodeSelector':s['nodeSelector'],'tolerations':s['tolerations'],'readyReplicas':d['status']['readyReplicas'],'availableReplicas':d['status']['availableReplicas'],'staleOverlayMountsRemoved':True,'liveFileHashes':hashes,'containers':[{'name':c['name'],'image':c['image'],'migrationsDisabled':any(e['name']=='DISABLE_DB_MIGRATIONS' and e.get('value')=='true' for e in c['env'])}for c in s['containers']]}
(root/'deployment-receipt.json').write_text(json.dumps(r,indent=2)+'\n')
patch=''.join(''.join(difflib.unified_diff((root/'baseline'/f).read_text().splitlines(True),(root/f).read_text().splitlines(True),fromfile='before/'+f,tofile='after/'+f))for f in paths)
(root/'overlay.patch').write_text(patch)
print('Final receipt saved; four live files match reviewed sources; both containers use final digest.')
