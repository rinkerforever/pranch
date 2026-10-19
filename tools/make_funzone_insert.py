"""Create the final vector insert and a two-up Letter sheet from its verified live URL."""
import sys, math
from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor, Color
from reportlab.graphics.barcode.qr import QrCodeWidget
from reportlab.graphics.shapes import Drawing
from reportlab.graphics import renderPDF

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'output'/'pdf'
OUT.mkdir(parents=True,exist_ok=True)
url=Path(sys.argv[1]).read_text(encoding='utf-8-sig').strip()
if not url.startswith('https://seating.projectaimnet.com/funzone.html?location=loc_tyler#key='):
    raise ValueError('Use the verified Tyler Fun Zone URL.')
W,H=288,432
purple='#25123F'; gold='#FFD148'; cream='#FFF4D3'; pink='#FF669E'; red='#B42331'

def text(c,s,x,y,size=10,color=cream,font='Helvetica'):
    c.setFillColor(HexColor(color));c.setFont(font,size);c.drawCentredString(x,y,s)

def star(c,x,y,r,color):
    c.setFillColor(HexColor(color));p=c.beginPath()
    for i in range(8):
        a=math.pi/2+i*math.pi/4; rr=r if i%2==0 else r*.3
        px=x+rr*math.cos(a);py=y+rr*math.sin(a)
        if i==0:p.moveTo(px,py)
        else:p.lineTo(px,py)
    p.close();c.drawPath(p,fill=1,stroke=0)

def arcade(c,x,y,scale=1):
    c.saveState();c.translate(x,y);c.scale(scale,scale)
    c.setFillColor(HexColor(red));p=c.beginPath();p.moveTo(0,0);p.lineTo(28,0);p.lineTo(24,18);p.lineTo(28,36);p.lineTo(3,36);p.lineTo(1,18);p.lineTo(5,12);p.close();c.drawPath(p,fill=1,stroke=0)
    c.setFillColor(HexColor(gold));c.roundRect(5,23,18,9,1,fill=1,stroke=0)
    c.setFillColor(HexColor(purple));c.roundRect(7,24,14,7,1,fill=1,stroke=0)
    c.setStrokeColor(HexColor(cream));c.setLineWidth(1.3);c.line(9,16,9,20);c.line(7,18,11,18)
    c.setFillColor(HexColor(cream));c.circle(19,18,1.6,fill=1,stroke=0);c.restoreState()

def pizza(c,x,y):
    c.saveState();c.translate(x,y);c.rotate(-20)
    p=c.beginPath();p.moveTo(-15,18);p.lineTo(15,18);p.lineTo(0,-20);p.close()
    c.setFillColor(HexColor(gold));c.drawPath(p,fill=1,stroke=0)
    c.setStrokeColor(HexColor('#DA8E34'));c.setLineWidth(6);c.line(-15,18,15,18)
    c.setFillColor(HexColor(red))
    for xx,yy in [(-5,10),(6,7),(0,-5)]:c.circle(xx,yy,3,fill=1,stroke=0)
    c.restoreState()

def insert(c):
    c.setFillColor(HexColor(purple));c.rect(0,0,W,H,fill=1,stroke=0)
    c.setFillColor(HexColor('#482064'));c.circle(-50,180,130,fill=1,stroke=0);c.circle(320,280,110,fill=1,stroke=0)
    c.setStrokeColor(HexColor(gold));c.setLineWidth(2);c.roundRect(9,9,270,414,13,fill=0,stroke=1)
    c.setFillColor(HexColor(red));c.roundRect(68,380,152,29,8,fill=1,stroke=0)
    text(c,'PIZZA RANCH',144,389,18,cream,'Helvetica-Bold')
    text(c,'TYLER  /  EAT. PLAY. REPEAT.',144,366,8,gold,'Helvetica-Bold')
    text(c,'FUN ZONE',146,325,35,red,'Helvetica-Bold');text(c,'FUN ZONE',144,328,35,gold,'Helvetica-Bold')
    text(c,'Heading over to play?',144,306,13,cream,'Helvetica-Bold')
    arcade(c,24,304,.8);pizza(c,250,341)
    for x,y,r,col in [(32,266,8,gold),(257,275,6,pink),(34,190,5,pink),(255,170,7,gold),(39,91,4,gold),(253,64,4,pink)]:star(c,x,y,r,col)
    # QR remains high-contrast, vector, unobstructed, with its quiet zone intact.
    c.setFillColor(HexColor('#FFFFFF'));c.roundRect(69,141,150,150,9,fill=1,stroke=0)
    qr=QrCodeWidget(url,barLevel='M',barBorder=4)
    x,y,w,h=qr.getBounds();size=142
    d=Drawing(size,size,transform=[size/(w-x),0,0,size/(h-y),0,0]);d.add(qr);renderPDF.draw(d,c,73,145)
    text(c,'SCAN. CHOOSE YOUR TABLE. PLAY.',144,124,10,gold,'Helvetica-Bold')
    text(c,'Tell our team you are in the Fun Zone.',144,107,10)
    text(c,'Your table stays in use while you play.',144,93,10)
    text(c,'Back for another slice?',144,70,11,gold,'Helvetica-Bold')
    text(c,'Tap "We\'re back at our table."',144,55,10)
    text(c,'No app needed. Need help? Ask your host.',144,29,8)
    c.linkURL(url,(69,141,219,291),relative=1,thickness=0)

single=OUT/'tyler-fun-zone-insert-4x6.pdf'
c=canvas.Canvas(str(single),pagesize=(W,H));c.setTitle('Tyler Pizza Ranch - Fun Zone - 4 x 6 inch insert');insert(c);c.showPage();c.save()
sheet=OUT/'tyler-fun-zone-letter-2up.pdf'
c=canvas.Canvas(str(sheet),pagesize=(612,792));c.setTitle('Tyler Fun Zone - two inserts - print at actual size')
for x in [12,312]:
    c.saveState();c.translate(x,180);insert(c);c.restoreState()
    c.setStrokeColor(HexColor('#777777'));c.setLineWidth(.4)
    for xx in [x,x+W]:
        c.line(xx,173,xx,178);c.line(xx,614,xx,619)
text(c,'PRINT AT 100% / ACTUAL SIZE  -  CUT EACH INSERT TO 4 x 6 INCHES',306,145,9,'#444444','Helvetica-Bold')
c.showPage();c.save()
print(single);print(sheet)
