from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor, white, black
from pathlib import Path
out=Path(__file__).with_name('readonly-multiline.pdf')
c=canvas.Canvas(str(out),pagesize=(612,792));c.setTitle('Read-only and multiline form validation')
c.setFont('Helvetica-Bold',18);c.drawString(48,740,'Read-only and multiline validation')
c.setFont('Helvetica',11);c.drawString(48,710,'Synthetic lab data for File to SharePoint acceptance testing.')
c.setStrokeColor(HexColor('#0076bd'));c.rect(40,394,532,290)
c.drawString(56,650,'Reference (read-only)')
c.acroForm.textfield(name='reference',tooltip='Reference (read-only)',x=220,y=638,width=320,height=25,value='LAB-008',fieldFlags='readOnly',borderWidth=1,borderColor=black,fillColor=white,textColor=black,forceBorder=True)
c.drawString(56,596,'Notes (required)')
c.acroForm.textfield(name='notes',tooltip='Notes (required)',x=56,y=430,width=484,height=150,value='Initial first line\nInitial second line',fieldFlags='required multiline',borderWidth=1,borderColor=black,fillColor=white,textColor=black,forceBorder=True,maxlen=500)
c.showPage();c.save();print(str(out))
