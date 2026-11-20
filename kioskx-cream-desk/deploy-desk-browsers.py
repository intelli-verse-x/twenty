"""Keep both computer-use services on. Preserve model credentials and fleet jobs."""
import hashlib,json,pathlib,secrets,subprocess
ROOT=pathlib.Path(__file__).resolve().parent
K=['kubectl','--context','ivx-new-eks','-n','aicart']
def get(kind,name):return json.loads(subprocess.check_output(K+['get',kind,name,'-o','json']))
def apply(obj):subprocess.run(K+['apply','-f','-'],input=json.dumps(obj).encode(),check=True,stdout=subprocess.DEVNULL)
existing=subprocess.run(K+['get','secret','desk-browser-auth'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
if existing.returncode:
 apply({'apiVersion':'v1','kind':'Secret','metadata':{'name':'desk-browser-auth'},'stringData':{'token':secrets.token_urlsafe(48)}})
apply({'apiVersion':'v1','kind':'ConfigMap','metadata':{'name':'desk-browser-code'},'data':{n:(ROOT/n).read_text() for n in ['desk-browser-worker.py','desk-browser-gateway.py']}})
for name in ['browser-agent','browser-use']:
 d=get('deployment',name);c=d['spec']['template']['spec']['containers'][0]
 worker=name=='browser-agent'
 env=[{'name':'DESK_BROWSER_TOKEN','valueFrom':{'secretKeyRef':{'name':'desk-browser-auth','key':'token'}}}]
 if worker:env.append({'name':'PYTHONPATH','value':'/app:/desk-worker'})
 patch={'spec':{'replicas':1,'template':{'metadata':{'annotations':{'desk-browser-code':hashlib.sha256((ROOT/('desk-browser-worker.py' if worker else 'desk-browser-gateway.py')).read_bytes()).hexdigest()}},'spec':{'containers':[{'name':c['name'],'command':(['python','-m','uvicorn','desk_browser_worker:app','--host','0.0.0.0','--port','8000','--no-access-log'] if worker else ['python3','/desk-worker/desk_browser_gateway.py']),'env':env,'volumeMounts':[{'name':'desk-browser-code','mountPath':'/desk-worker','readOnly':True},{'name':'desk-browser-sessions','mountPath':'/desk-sessions','readOnly':True}]}],'volumes':[{'name':'desk-browser-code','configMap':{'name':'desk-browser-code','items':[{'key':'desk-browser-worker.py','path':'desk_browser_worker.py'},{'key':'desk-browser-gateway.py','path':'desk_browser_gateway.py'}]}},{'name':'desk-browser-sessions','secret':{'secretName':'desk-browser-sessions','optional':True}}]}}}}
 subprocess.run(K+['patch','deployment',name,'--type=strategic','-p',json.dumps(patch)],check=True)
print('Both browser services desired replicas: 1; model configuration preserved')
