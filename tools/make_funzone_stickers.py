"""Print Tyler's prepared guest QR as 3-inch round stickers."""
import sys, math, json
from urllib.parse import quote
from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor
from reportlab.graphics.barcode.qr import QrCodeWidget
from reportlab.graphics.shapes import Drawing
from reportlab.graphics import renderPDF

root=Path(__file__).resolve().parents[1];out=root/'output'/'pdf';out.mkdir(parents=True,exist_ok=True)
url=Path(sys.argv[1]).read_text(encoding='utf-8-sig').strip()
assert url.startswith('https://seating.projectaimnet.com/funzone.html?location=loc_tyler#key=')
activation=url.replace('/funzone.html?','/funzone-sign.html?').replace('#key=','#activate=')
tables=json.loads(Path(sys.argv[2]).read_text(encoding='utf-8-sig')) if len(sys.argv)>2 else [None]*6
if tables[0] is not None:
 assert len({t['id'] for t in tables})==len(tables)
 assert all(t.get('id') and t.get('label') for t in tables)
purple='#25123F';gold='#FFD148';cream='#FFF4D3';red='#B42331'
def text(c,s,x,y,size,color=cream,font='Helvetica-Bold'):
 c.setFillColor(HexColor(color));c.setFont(font,size);c.drawCentredString(x,y,s)
def star(c,x,y,r,color):
 c.setFillColor(HexColor(color));p=c.beginPath()
 for i in range(8):
  a=math.pi/2+i*math.pi/4;rr=r if i%2==0 else r*.3;xx=x+rr*math.cos(a);yy=y+rr*math.sin(a)
  if i==0:p.moveTo(xx,yy)
  else:p.lineTo(xx,yy)
 p.close();c.drawPath(p,fill=1,stroke=0)
def sticker(c,table=None):
 target=url.replace('#','&table='+quote(table['id'],safe='')+'#',1) if table else url
 c.saveState();clip=c.beginPath();clip.circle(108,108,108);c.clipPath(clip,stroke=0,fill=0)
 c.setFillColor(HexColor(purple));c.rect(0,0,216,216,fill=1,stroke=0)
 c.setFillColor(HexColor('#482064'));c.circle(-28,60,100,fill=1,stroke=0);c.circle(235,135,90,fill=1,stroke=0)
 c.setStrokeColor(HexColor(gold));c.setLineWidth(2);c.circle(108,108,103,fill=0,stroke=1)
 text(c,'PIZZA RANCH',108,188,12)
 text(c,'TYLER',108,178,6.5,gold)
 text(c,'FUN ZONE',109,154,26,red);text(c,'FUN ZONE',108,156,26,gold)
 text(c,'SCAN BEFORE YOU PLAY',108,143,7.5)
 # Quiet zone is built into the vector QR. No artwork touches it.
 c.setFillColor(HexColor('#FFFFFF'));c.roundRect(58,43,100,96,6,fill=1,stroke=0)
 qr=QrCodeWidget(target,barLevel='M',barBorder=4);x,y,w,h=qr.getBounds();size=94
 d=Drawing(size,size,transform=[size/(w-x),0,0,size/(h-y),0,0]);d.add(qr);renderPDF.draw(d,c,61,44)
 if table:
  label=table['label']
  if len(label)>9:
   area,number=label.rsplit('-',1)
   text(c,area.upper(),108,32,8,gold)
   text(c,'TABLE '+number,108,18,12)
  else:
   text(c,'TABLE '+label,108,29,14,gold)
   text(c,'Scan to check in. Tap when back.',108,17,6.5,cream,'Helvetica')
 else:
  text(c,'Choose your table. Let us know.',108,32,8)
  text(c,'Back? Tap "We\'re back."',108,20,7.5,cream,'Helvetica')
 # Pizza slice and arcade cabinet flank the QR.
 c.saveState();c.translate(28,115);c.rotate(-15);p=c.beginPath();p.moveTo(-10,11);p.lineTo(10,11);p.lineTo(0,-15);p.close();c.setFillColor(HexColor(gold));c.drawPath(p,fill=1,stroke=0)
 c.setStrokeColor(HexColor('#D88B35'));c.setLineWidth(4);c.line(-10,11,10,11);c.setFillColor(HexColor(red))
 for x,y in [(-3,5),(4,3),(0,-5)]:c.circle(x,y,2,fill=1,stroke=0)
 c.restoreState();c.setFillColor(HexColor(red));p=c.beginPath();p.moveTo(176,95);p.lineTo(195,95);p.lineTo(192,108);p.lineTo(195,126);p.lineTo(178,126);p.lineTo(176,108);p.close();c.drawPath(p,fill=1,stroke=0)
 c.setFillColor(HexColor(gold));c.roundRect(180,115,11,7,1,fill=1,stroke=0);c.setStrokeColor(HexColor(cream));c.setLineWidth(1);c.line(181,106,185,106);c.line(183,104,183,108);c.circle(190,106,1,fill=0,stroke=1)
 for x,y,r,col in [(35,78,5,gold),(177,73,4,'#FF669E'),(46,151,3,'#FF669E'),(173,150,3,gold)]:star(c,x,y,r,col)
 c.linkURL(target,(58,43,158,139),relative=1,thickness=0);c.restoreState()

numbered=tables[0] is not None
single=out/('tyler-fun-zone-numbered-stickers-3in.pdf' if numbered else 'tyler-fun-zone-sticker-3in.pdf')
c=canvas.Canvas(str(single),pagesize=(216,216));c.setTitle('Tyler Pizza Ranch - numbered 3 inch round Fun Zone stickers')
for table in tables if numbered else [None]:sticker(c,table);c.showPage()
c.save()
sheet=out/('tyler-fun-zone-numbered-stickers-letter-6up.pdf' if numbered else 'tyler-fun-zone-stickers-letter-6up.pdf')
c=canvas.Canvas(str(sheet),pagesize=(612,792));c.setTitle('Tyler Fun Zone - numbered 3 inch stickers - six per sheet')
slots=[(x,y) for y in [522,288,54] for x in [81,315]]
for offset in range(0,len(tables),6):
 for (x,y),table in zip(slots,tables[offset:offset+6]):
  c.saveState();c.translate(x,y);sticker(c,table);c.restoreState()
 text(c,'3-INCH TABLE STICKERS  |  PRINT AT 100% / ACTUAL SIZE',306,770,8,'#444444')
 text(c,'Use full-sheet sticker paper and cut around each circle.',306,754,8,'#444444','Helvetica')
 text(c,f'Sheet {offset//6+1} of {math.ceil(len(tables)/6)} - Place each sticker on its matching table.',306,27,8,'#444444','Helvetica')
 c.showPage()
c.save()
print(single);print(sheet)
