"""Authenticated Unified Support gateway on the browser-use deployment."""
import os
os.environ['BROWSER_USE_LOGGING_LEVEL']='warning'
os.environ['BROWSER_USE_SETUP_LOGGING']='false'
import httpx
import uvicorn
from starlette.applications import Starlette
from starlette.routing import Route, Mount
from starlette.responses import JSONResponse
async def health(request): return JSONResponse({'status':'ok'})
async def desk(request):
    token=os.environ.get('DESK_BROWSER_TOKEN')
    if not token or request.headers.get('authorization')!='Bearer '+token:
        return JSONResponse({'error':'Unauthorized'},status_code=403)
    try:
        async with httpx.AsyncClient(timeout=110) as client:
            r=await client.post('http://browser-agent/desk/'+request.path_params['action'],json=await request.json(),headers={'Authorization':'Bearer '+token})
        return JSONResponse(r.json(),status_code=r.status_code)
    except Exception:
        return JSONResponse({'status':'unknown','message':'Browser outcome could not be confirmed. Do not resend.'},status_code=503)
app=Starlette(routes=[Route('/health',health),Route('/desk/{action}',desk,methods=['POST'])])
if __name__=='__main__': uvicorn.run(app,host='0.0.0.0',port=8000,log_level='warning',access_log=False)
