import pathlib,hashlib,json,subprocess,os
root=pathlib.Path('/tmp/boss-course-source'); dest=pathlib.Path('/var/lib/docker/volumes/bossclinician_protected_uploads_data/_data')
assets=[('fullybookedtherapist.pdf','Fully Booked Toolkit — Start Here','application/pdf'),('client-consultation-call-script.pdf','Client Consultation Call Script','application/pdf'),('from-profile-to-profit.pdf','Profile to Profit Directory Guide','application/pdf'),('credential-training.mp4','Credentialing with Confidence','video/mp4'),('billing-training.mp4','Boss Billing Blueprint','video/mp4'),('credential-tracker.pdf','Credential with Confidence Tracker','application/pdf'),('caq-h-checklist.pdf','Steps to CAQH','application/pdf')]
manifest={}
for file,title,mime in assets:
 p=root/file;b=p.read_bytes();sha=hashlib.sha256(b).hexdigest();key='import-'+sha[:24]+p.suffix
 subprocess.run(['sudo','-n','install','-o','1000','-g','1000','-m','640',str(p),str(dest/key)],check=True)
 manifest[file]={'title':title,'mime':mime,'size':len(b),'sha256':sha,'storage':'protected:'+key}
def q(s):return "'"+str(s).replace("'","''")+"'"
sql=['BEGIN;']
for slug,files in {'fully-booked-toolkit':['fullybookedtherapist.pdf','client-consultation-call-script.pdf','from-profile-to-profit.pdf'],'from-profile-to-profit':['from-profile-to-profit.pdf'],'client-consultation-call-script':['client-consultation-call-script.pdf']}.items():
 for sort,file in enumerate(files):
  a=manifest[file];sql.append(f"INSERT INTO product_files(product_id,title,storage_path,filename,mime,size_bytes,sort) SELECT id,{q(a['title'])},{q(a['storage'])},{q(file)},{q(a['mime'])},{a['size']},{sort} FROM products p WHERE slug={q(slug)} AND NOT EXISTS(SELECT 1 FROM product_files f WHERE f.product_id=p.id AND f.storage_path={q(a['storage'])});")
slug='credential-with-confidence'
sql.append(f"INSERT INTO course_modules(course_id,title,summary,sort) SELECT id,'Credentialing and billing','Original Boss Clinician training and worksheets.',1 FROM courses c WHERE slug={q(slug)} AND NOT EXISTS(SELECT 1 FROM course_modules m WHERE m.course_id=c.id AND m.title='Credentialing and billing');")
for sort,file in enumerate(['credential-training.mp4','billing-training.mp4']):
 a=manifest[file];lesson_slug=file.replace('.mp4','');sql.append(f"INSERT INTO course_lessons(module_id,title,slug,video_url,content_type,published,sort) SELECT m.id,{q(a['title'])},{q(lesson_slug)},{q(a['storage'])},'video',true,{sort} FROM course_modules m JOIN courses c ON c.id=m.course_id WHERE c.slug={q(slug)} AND m.title='Credentialing and billing' AND NOT EXISTS(SELECT 1 FROM course_lessons l WHERE l.module_id=m.id AND l.slug={q(lesson_slug)});")
for sort,file in enumerate(['credential-tracker.pdf','caq-h-checklist.pdf']):
 a=manifest[file];sql.append(f"INSERT INTO lesson_files(lesson_id,title,storage_path,filename,mime,size_bytes,sort) SELECT l.id,{q(a['title'])},{q(a['storage'])},{q(file)},{q(a['mime'])},{a['size']},{sort} FROM course_lessons l JOIN course_modules m ON m.id=l.module_id JOIN courses c ON c.id=m.course_id WHERE c.slug={q(slug)} AND l.slug='credential-training' AND NOT EXISTS(SELECT 1 FROM lesson_files f WHERE f.lesson_id=l.id AND f.storage_path={q(a['storage'])});")
sql.append('COMMIT;');subprocess.run(['docker','compose','exec','-T','db','psql','-U','boss','-d','bossclinician','-v','ON_ERROR_STOP=1'],input='\n'.join(sql),text=True,check=True)
doc=pathlib.Path('/opt/bossclinician/docs/verification/native-courses-20260919');doc.mkdir(parents=True,exist_ok=True);(doc/'imported-assets.json').write_text(json.dumps(manifest,indent=2));print('Imported original assets:',len(manifest))
