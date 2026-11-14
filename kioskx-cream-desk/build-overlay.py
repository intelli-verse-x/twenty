import io,json,pathlib,subprocess,tarfile
root=pathlib.Path(__file__).resolve().parent
result=subprocess.run(['kubectl','-n','aicart','get','deployment','twenty-server','-o','json'],capture_output=True,check=True)
d=json.loads(result.stdout); spec=d['spec']['template']['spec'];base=next(c['image'] for c in spec['containers'] if c['name']=='twenty-server')
(root/'base-image.txt').write_text(base+'\n')
index=(root/'baseline/index.html').read_text();assert 'kioskx-desk-queues.js?queues=6' in index
index=index.replace('kioskx-desk-queues.js?queues=6','kioskx-desk-queues.js?queues=work-20261114-v4')
(root/'index.html').write_text(index)
entries={
 'hired-desk-queues.js':'engine/core-modules/kioskx-hired-desk/',
 'hired-policy.js':'engine/core-modules/kioskx-hired-desk/',
 'kioskx-desk-queues.js':'front/assets/',
 'index.html':'front/'
}
with tarfile.open('/tmp/kioskx-desk-work/overlay.tar','w') as tar:
 for name,folder in entries.items():
  data=(root/name).read_bytes();info=tarfile.TarInfo('app/packages/twenty-server/dist/'+folder+name)
  info.size=len(data);info.mode=0o644;info.uid=1000;info.gid=1000;tar.addfile(info,io.BytesIO(data))
tag=base.split('@')[0]+':desk-work-20261114-v4'
(root/'image-tag.txt').write_text(tag+'\n')
with open('/tmp/kioskx-desk-work/append.log','w') as log:
 subprocess.run(['crane','append','--platform','linux/arm64','--base',base,'--new_layer','/tmp/kioskx-desk-work/overlay.tar','--new_tag',tag],stdout=log,stderr=log,check=True)
digest=subprocess.check_output(['crane','digest',tag],text=True).strip()
image=tag.rsplit(':',1)[0]+'@'+digest
config=json.loads(subprocess.check_output(['crane','config',image]))
assert config['architecture']=='arm64' and config['os']=='linux'
(root/'image.txt').write_text(image+'\n')
print('ARM64 layer published:',digest)
