import io,json,pathlib,subprocess,tarfile
root=pathlib.Path(__file__).resolve().parent
result=subprocess.run(['kubectl','-n','aicart','get','deployment','twenty-server','-o','json'],capture_output=True,check=True)
d=json.loads(result.stdout); spec=d['spec']['template']['spec'];base=next(c['image'] for c in spec['containers'] if c['name']=='twenty-server')
(root/'rollout-base-image.txt').write_text(base+'\n')
# Use exactly the currently running image.
base=(root/'base-image.txt').read_text().strip()
entries={
 'kioskx-desk-queues.js':'front/assets/',
 'index.html':'front/',
 'reach.js':'engine/core-modules/kioskx-hired-desk/',
 'hired-desk-queues.js':'engine/core-modules/kioskx-hired-desk/'
}
pathlib.Path('/tmp/kioskx-desk-figma').mkdir(exist_ok=True)
with tarfile.open('/tmp/kioskx-desk-figma/overlay.tar','w') as tar:
 for name,folder in entries.items():
  data=(root/name).read_bytes();info=tarfile.TarInfo('app/packages/twenty-server/dist/'+folder+name)
  info.size=len(data);info.mode=0o644;info.uid=1000;info.gid=1000;tar.addfile(info,io.BytesIO(data))
tag=base.split('@')[0]+':desk-figma-20261117-v8'
(root/'image-tag.txt').write_text(tag+'\n')
with open('/tmp/kioskx-desk-figma/append.log','w') as log:
 subprocess.run(['crane','append','--platform','linux/arm64','--base',base,'--new_layer','/tmp/kioskx-desk-figma/overlay.tar','--new_tag',tag],stdout=log,stderr=log,check=True)
digest=subprocess.check_output(['crane','digest',tag],text=True).strip()
image=tag.rsplit(':',1)[0]+'@'+digest
config=json.loads(subprocess.check_output(['crane','config',image]))
assert config['architecture']=='arm64' and config['os']=='linux'
(root/'image.txt').write_text(image+'\n')
print('ARM64 layer published:',digest)
