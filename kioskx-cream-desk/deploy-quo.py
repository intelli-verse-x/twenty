"""Append the Quo call list to the running desk image. The key stays in secret desk-quo."""
import io, json, pathlib, subprocess, tarfile, datetime
root = pathlib.Path(__file__).resolve().parent
artifacts = root.parent.parent
k = ['kubectl', '--context', 'ivx-new-eks', '-n', 'aicart']

def run(args):
    return subprocess.check_output(args, text=True)

run(k + ['get', 'secret', 'desk-quo'])
d = json.loads(run(k + ['get', 'deployment', 'twenty-server', '-o', 'json']))
spec = d['spec']['template']['spec']
assert d['status'].get('readyReplicas', 0) == d['spec']['replicas']
assert d['spec']['strategy']['rollingUpdate']['maxUnavailable'] == 0
assert spec['nodeSelector']['kubernetes.io/arch'] == 'arm64'
assert any(t.get('key') == 'arch' and t.get('value') == 'arm64' and t.get('effect') == 'NoSchedule' for t in spec['tolerations'])
assert all(any(e['name'] == 'DISABLE_DB_MIGRATIONS' and e.get('value') == 'true' for e in c['env']) for c in spec['containers'])
base = next(c['image'] for c in spec['containers'] if c['name'] == 'twenty-server')
assert all(c['image'] == base for c in spec['containers'])
entries = {name: 'engine/core-modules/kioskx-hired-desk/' for name in ['desk-quo.js', 'hired-desk-queues.js', 'hired-policy.js']}
entries['kioskx-desk-queues.js'] = 'front/assets/'
layer = artifacts / 'quo-overlay.tar'
with tarfile.open(layer, 'w') as tar:
    for name, folder in entries.items():
        data = (root / name).read_bytes()
        info = tarfile.TarInfo('app/packages/twenty-server/dist/' + folder + name)
        info.size = len(data)
        info.mode = 0o644
        info.uid = 1000
        info.gid = 1000
        tar.addfile(info, io.BytesIO(data))
repository = base.split('@')[0].split(':')[0]
tag = repository + ':desk-quo-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d%H%M%S')
with (artifacts / 'quo-append.log').open('w') as log:
    subprocess.run(['crane', 'append', '--platform', 'linux/arm64', '--base', base, '--new_layer', str(layer), '--new_tag', tag], stdout=log, stderr=log, check=True)
image = repository + '@' + run(['crane', 'digest', tag]).strip()
config = json.loads(run(['crane', 'config', image]))
assert config['architecture'] == 'arm64' and config['os'] == 'linux'
assert json.loads(run(['crane', 'manifest', image]))['layers'][:-1] == json.loads(run(['crane', 'manifest', base]))['layers']
(artifacts / 'quo-image.txt').write_text(image + '\n')
volumes = spec.setdefault('volumes', [])
if not any(v.get('name') == 'desk-quo' for v in volumes):
    volumes.append({'name': 'desk-quo', 'secret': {'secretName': 'desk-quo', 'defaultMode': 420}})
for container in spec['containers']:
    container['image'] = image
    mounts = container.setdefault('volumeMounts', [])
    if not any(m.get('name') == 'desk-quo' for m in mounts):
        mounts.append({'name': 'desk-quo', 'mountPath': '/var/run/desk-quo', 'readOnly': True})
patch = [
    {'op': 'test', 'path': '/metadata/resourceVersion', 'value': d['metadata']['resourceVersion']},
    {'op': 'replace', 'path': '/spec/template/spec/containers', 'value': spec['containers']},
    {'op': 'replace', 'path': '/spec/template/spec/volumes', 'value': volumes},
]
subprocess.run(k + ['patch', 'deployment', 'twenty-server', '--type', 'json', '--patch-file=/dev/stdin'], input=json.dumps(patch), text=True, check=True)
print('Published one appended ARM64 layer and started the zero-unavailable rollout.')
