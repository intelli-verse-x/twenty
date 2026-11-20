"""Append the inbox Send styling to the currently running image."""
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
assert d['status'].get('replicas', 0) == d['spec']['replicas']
assert d['status'].get('terminatingReplicas', 0) == 0
assert d['spec']['strategy']['rollingUpdate']['maxUnavailable'] == 0
assert spec['nodeSelector']['kubernetes.io/arch'] == 'arm64'
assert any(t.get('key') == 'arch' and t.get('value') == 'arm64' and t.get('effect') == 'NoSchedule' for t in spec['tolerations'])
assert all(any(e['name'] == 'DISABLE_DB_MIGRATIONS' and e.get('value') == 'true' for e in c['env']) for c in spec['containers'])
base = next(c['image'] for c in spec['containers'] if c['name'] == 'twenty-server')
assert all(c['image'] == base for c in spec['containers'])
assert 'sha256:ecd294d4a7d3be711d02c36a4ebe8e70ab69f5cb55706b0434200a379effa5e0' not in base
assert d['status'].get('updatedReplicas', 0) == d['spec']['replicas']
assert d['status'].get('observedGeneration', 0) == d['metadata']['generation']
assert any(v.get('name') == 'desk-quo' and v.get('secret', {}).get('secretName') == 'desk-quo' for v in spec['volumes'])
assert all(any(m.get('name') == 'desk-quo' and m.get('mountPath') == '/var/run/desk-quo' for m in c['volumeMounts']) for c in spec['containers'])
entries = {'kioskx-desk-queues.js': 'front/assets/'}
layer = artifacts / 'inbox-send-overlay.tar'
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
tag = repository + ':desk-inbox-send-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d%H%M%S')
with (artifacts / 'inbox-send-append.log').open('w') as log:
    subprocess.run(['crane', 'append', '--platform', 'linux/arm64', '--base', base, '--new_layer', str(layer), '--new_tag', tag], stdout=log, stderr=log, check=True)
image = repository + '@' + run(['crane', 'digest', tag]).strip()
config = json.loads(run(['crane', 'config', image]))
assert config['architecture'] == 'arm64' and config['os'] == 'linux'
assert json.loads(run(['crane', 'manifest', image]))['layers'][:-1] == json.loads(run(['crane', 'manifest', base]))['layers']
(artifacts / 'inbox-send-image.txt').write_text(image + '\n')
for container in spec['containers']:
    container['image'] = image
patch = [
    {'op': 'test', 'path': '/metadata/resourceVersion', 'value': d['metadata']['resourceVersion']},
    {'op': 'replace', 'path': '/spec/template/spec/containers', 'value': spec['containers']},
]
subprocess.run(k + ['patch', 'deployment', 'twenty-server', '--type', 'json', '--patch-file=/dev/stdin'], input=json.dumps(patch), text=True, check=True)
print('Published one appended ARM64 layer and started the zero-unavailable rollout.')

subprocess.run(k + ['rollout', 'status', 'deployment/twenty-server', '--timeout=300s'], check=True)
