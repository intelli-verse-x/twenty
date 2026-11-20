"""Append only the jobs change to the currently running ARM64 desk image.

The browser file is three-way merged with the running asset, preserving an
independently shipped Call page. No pod files or other deployments are changed.
"""
import io
import json
import pathlib
import subprocess
import tarfile
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent
REPO = ROOT.parent
KUBE = ['kubectl', '--context', 'ivx-new-eks', '-n', 'aicart']
BASE_REV = '3ed86949'


def output(args):
    return subprocess.check_output(args, text=True)


def deployment():
    return json.loads(output(KUBE + ['get', 'deployment', 'twenty-server', '-o', 'json']))


def ready(d):
    spec, status = d['spec'], d['status']
    replicas = spec.get('replicas', 1)
    assert status.get('observedGeneration') == d['metadata']['generation'], 'Deployment update in progress'
    assert status.get('updatedReplicas') == replicas, 'Rollout in progress'
    assert status.get('readyReplicas') == replicas, 'Desk is not ready'
    assert status.get('replicas') == replicas, 'Previous replica is still present'
    assert subprocess.run(['pgrep', '-f', '[d]eploy-call.py'], stdout=subprocess.DEVNULL).returncode == 1, 'Call deployment in progress'


def main():
    d = deployment()
    ready(d)
    spec = d['spec']['template']['spec']
    assert d['spec']['strategy']['rollingUpdate']['maxUnavailable'] == 0
    assert spec['nodeSelector']['kubernetes.io/arch'] == 'arm64'
    containers = spec['containers']
    base = next(c['image'] for c in containers if c['name'] == 'twenty-server')
    assert all(c['image'] == base for c in containers)
    for c in containers:
        assert any(e['name'] == 'DISABLE_DB_MIGRATIONS' and e.get('value') == 'true' for e in c['env'])
        assert any(v['name'] == 'desk-quo' for v in c.get('volumeMounts', [])), 'Keep Quo mount'
    artifact_dir = REPO.parent
    browser_path = 'app/packages/twenty-server/dist/front/assets/kioskx-desk-queues.js'
    with tempfile.TemporaryDirectory(prefix='desk-jobs-layer-') as temp:
        temp = pathlib.Path(temp)
        original = temp / 'original.js'
        ours = temp / 'jobs.js'
        live = temp / 'live.js'
        original.write_text(output(['git', '-C', str(REPO), 'show', BASE_REV + ':kioskx-cream-desk/kioskx-desk-queues.js']))
        ours.write_bytes((ROOT / 'kioskx-desk-queues.js').read_bytes())
        live.write_text(output(KUBE + ['exec', 'deployment/twenty-server', '-c', 'twenty-server', '--', 'cat', '/' + browser_path]))
        # A conflict stops before building or updating anything. Never replace the
        # Call asset with the older branch's version.
        merged = output(['git', 'merge-file', '-p', str(ours), str(original), str(live)])
        merged_path = temp / 'merged.js'
        merged_path.write_text(merged)
        subprocess.run(['node', '--check', str(merged_path)], check=True)
        if 'function renderCalls(' in live.read_text():
            assert 'function renderCalls(' in merged and 'sd-person-call' in merged
        layer = temp / 'jobs.tar'
        entries = {
            browser_path: merged.encode(),
            'app/packages/twenty-server/dist/engine/core-modules/kioskx-hired-desk/desk-applications.js': (ROOT / 'desk-applications.js').read_bytes(),
        }
        with tarfile.open(layer, 'w') as tar:
            for name, data in entries.items():
                info = tarfile.TarInfo(name)
                info.size, info.mode, info.uid, info.gid = len(data), 0o644, 1000, 1000
                tar.addfile(info, io.BytesIO(data))
        sha = output(['git', '-C', str(REPO), 'rev-parse', '--short', 'HEAD']).strip()
        tag = base.split('@')[0].split(':')[0] + ':desk-real-jobs-' + sha
        current = deployment()
        ready(current)
        assert current['metadata']['resourceVersion'] == d['metadata']['resourceVersion'], 'Deployment changed; rerun against its new image'
        with (artifact_dir / 'desk-jobs-append.log').open('w') as log:
            subprocess.run(['crane', 'append', '--platform', 'linux/arm64', '--base', base, '--new_layer', str(layer), '--new_tag', tag], stdout=log, stderr=log, check=True)
        digest = output(['crane', 'digest', tag]).strip()
        image = tag.rsplit(':', 1)[0] + '@' + digest
        config = json.loads(output(['crane', 'config', image]))
        assert config['architecture'] == 'arm64' and config['os'] == 'linux'
        assert json.loads(output(['crane', 'manifest', image]))['layers'][:-1] == json.loads(output(['crane', 'manifest', base]))['layers']
        ready(deployment())
        patch = [{'op': 'test', 'path': '/metadata/resourceVersion', 'value': d['metadata']['resourceVersion']}]
        patch += [{'op': 'replace', 'path': f'/spec/template/spec/containers/{i}/image', 'value': image} for i in range(len(containers))]
        subprocess.run(KUBE + ['patch', 'deployment', 'twenty-server', '--type=json', '-p', json.dumps(patch)], check=True)
        (artifact_dir / 'desk-jobs-image.txt').write_text(image + '\n')
        print('Appended one ARM64 layer:', digest)


if __name__ == '__main__':
    main()
