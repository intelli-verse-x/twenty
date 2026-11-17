import io,json,pathlib,subprocess,tarfile
root=pathlib.Path(__file__).resolve().parent
run=lambda args: subprocess.check_output(args,text=True)
d=json.loads(run(['kubectl','-n','aicart','get','deployment','twenty-server','-o','json']))
base=next(c['image'] for c in d['spec']['template']['spec']['containers'] if c['name']=='twenty-server')
(root/'rollout-base-image.txt').write_text(base+'\n')
entries={'crew-jobs.js':'engine/core-modules/kioskx-hired-desk/','kioskx-desk-queues.js':'front/assets/','index.html':'front/','hired-desk-queues.js':'engine/core-modules/kioskx-hired-desk/','desk-company.js':'engine/core-modules/kioskx-hired-desk/','hired-policy.js':'engine/core-modules/kioskx-hired-desk/'}
layer=root/'overlay.tar'
with tarfile.open(layer,'w') as tar:
 for name,folder in entries.items():
  data=(root/name).read_bytes();info=tarfile.TarInfo('app/packages/twenty-server/dist/'+folder+name)
  info.size=len(data);info.mode=0o644;info.uid=1000;info.gid=1000;tar.addfile(info,io.BytesIO(data))
tag=base.split('@')[0]+':desk-company-20261117-v15'
with (root/'append.log').open('w') as log:
 subprocess.run(['crane','append','--platform','linux/arm64','--base',base,'--new_layer',str(layer),'--new_tag',tag],stdout=log,stderr=log,check=True)
digest=run(['crane','digest',tag]).strip();image=tag.rsplit(':',1)[0]+'@'+digest
config=json.loads(run(['crane','config',image]));assert config['architecture']=='arm64' and config['os']=='linux'
old=json.loads(run(['crane','manifest',base]));new=json.loads(run(['crane','manifest',image]));assert new['layers'][:-1]==old['layers']
(root/'image.txt').write_text(image+'\n');print('Published ARM64 image with exactly one appended layer:',digest)
