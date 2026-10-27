"""Exercise the actual retired-host nginx config against an isolated mock upstream."""
from pathlib import Path
import http.client, subprocess, tempfile, time

root=Path(__file__).resolve().parents[2]
name='bc192-nginx-check'
def run(*args):return subprocess.check_output(args,text=True).strip()
if subprocess.run(['docker','container','inspect',name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0:
    raise SystemExit(name+' already exists; refusing to reuse')
checks=0
with tempfile.TemporaryDirectory(prefix='bc192-nginx-') as tmp:
    config=Path(tmp)/'nginx.conf'
    config.write_text('events {}\nhttp {\nserver { listen 4000; location / { return 202; } }\n'+(root/'nginx/retired-hosts.conf').read_text()+'\n}\n')
    run('docker','run','-d','--rm','--name',name,'--memory=128m','--cpus=0.5','--add-host','backend:127.0.0.1','-p','127.0.0.1::80','-v',str(config)+':/etc/nginx/nginx.conf:ro','nginx:1.31-alpine')
    try:
        for _ in range(30):
            try:
                port=int(run('docker','port',name,'80/tcp').rsplit(':',1)[1]);break
            except Exception:time.sleep(.1)
        run('docker','exec',name,'nginx','-t')
        def check(method,path,status,location=None):
            global checks
            con=http.client.HTTPConnection('127.0.0.1',port,timeout=5)
            con.request(method,path,headers={'Host':'bossclinician.callsphere.site','X-Forwarded-Host':'evil.test'})
            res=con.getresponse();body=res.read();headers=dict(res.getheaders());con.close()
            assert res.status==status,(method,path,res.status,status)
            if location is not None:assert headers.get('Location')==location,(path,headers.get('Location'))
            assert headers.get('Cache-Control')=='no-store'
            assert headers.get('X-Robots-Tag')=='noindex, nofollow'
            if method=='HEAD':assert body==b''
            checks+=1
        path='/library/credential-with-confidence/lessons/credential-with-confidence-quiz'
        query='?next=https%3A%2F%2Fevil.test%2F&token=opaque%2B%2F%3D&x=1&x=2'
        for method in ['GET','HEAD']:
            check(method,path,302,'https://www.bossclinician.com'+path)
            check(method,path+query,302,'https://www.bossclinician.com'+path+query)
        for method in ['POST','PUT','PATCH','DELETE','OPTIONS']:check(method,path,410)
        for other in ['/', '/login','/admin/login','/account/certificates','/verify/test',path+'/',path+'/extra',path.replace('/library/','/%6cibrary/'),path.replace('/library/','//library/'),'/discard/..'+path]:check('GET',other,410)
        for callback in ['/api/stripe/webhook','/api/paypal/webhook','/api/email/webhook/ses']:
            check('POST',callback,202)
            for method in ['GET','HEAD','PUT','OPTIONS']:check(method,callback,410)
            check('POST',callback+'/',410)
        print(f'nginx receipt redirect: {checks} routing/header checks passed; syntax passed')
    finally:
        subprocess.run(['docker','rm','-f',name],stdout=subprocess.DEVNULL,check=False)
