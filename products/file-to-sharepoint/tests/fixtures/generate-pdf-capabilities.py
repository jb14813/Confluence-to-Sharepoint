"""Synthetic PDF capability regression inputs. ReportLab4.4.5 / pypdf4.2.0.
No user document or application PDF parser; generated JSON is the test input.
"""
import base64,hashlib,io,json
from pathlib import Path
from reportlab.pdfgen import canvas
from pypdf import PdfReader,PdfWriter
from pypdf.generic import ArrayObject,DecodedStreamObject,DictionaryObject,NameObject,NumberObject,TextStringObject
out=Path(__file__).resolve().parent
xml=b'<?xml version="1.0"?><xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/"><template xmlns="http://www.xfa.org/schema/xfa-template/2.8/"><subform name="form1"><field name="Name"><ui><textEdit/></ui><value><text>Required response</text></value></field></subform></template></xdp:xdp>'
records=[]
for name,mode,error in [('xfa-only.pdf','stream','UNSUPPORTED_PDF_FORM'),('xfa-packets.pdf','packets','UNSUPPORTED_PDF_FORM'),('xfa-hybrid.pdf','hybrid','UNSUPPORTED_PDF_FORM'),('malformed-acroform.pdf','malformed','PDF_FORM_METADATA_UNVERIFIED'),('empty-acroform.pdf','empty',None)]:
 source=io.BytesIO();c=canvas.Canvas(source,pagesize=(400,300),invariant=1,pageCompression=1);c.setTitle('Synthetic PDF capability check');c.drawString(30,260,'Editable PDF capability check')
 if mode=='hybrid':c.acroForm.textfield(name='standard_name',tooltip='Standard name',x=30,y=200,width=230,height=24,value='AcroForm fallback')
 c.save();reader=PdfReader(io.BytesIO(source.getvalue()));writer=PdfWriter();writer.clone_document_from_reader(reader)
 if mode=='hybrid':form=writer._root_object['/AcroForm']
 else:form=DictionaryObject({NameObject('/Fields'):ArrayObject()});writer._root_object[NameObject('/AcroForm')]=writer._add_object(form)
 if mode in ('stream','packets','hybrid'):
  stream=DecodedStreamObject();stream.set_data(xml);reference=writer._add_object(stream);form[NameObject('/XFA')]=ArrayObject([TextStringObject('template'),reference]) if mode=='packets' else reference
 if mode=='malformed':form[NameObject('/Fields')]=NumberObject(42)
 result=io.BytesIO();writer.write(result);data=result.getvalue();records.append({'name':name,'pdf':base64.b64encode(data).decode(),'sha256':hashlib.sha256(data).hexdigest(),'expectedError':error,'features':{'xfa':mode in ('stream','packets','hybrid'),'malformedFields':mode=='malformed'}})
(out/'pdf-capabilities.json').write_bytes((json.dumps(records,indent=2)+'\n').encode('utf-8'))
print(json.dumps([{'name':r['name'],'sha256':r['sha256'],'expectedError':r['expectedError']} for r in records]))
