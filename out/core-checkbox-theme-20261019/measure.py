import sys, json
from PIL import Image
def lum(c):
    f=lambda v:(v/255)/12.92 if v/255<=0.03928 else (((v/255)+0.055)/1.055)**2.4
    return .2126*f(c[0])+.7152*f(c[1])+.0722*f(c[2])
def cr(a,b):
    la,lb=sorted([lum(a),lum(b)],reverse=True); return round((la+.05)/(lb+.05),2)
root=sys.argv[1]
out={}
for t in ('light','dark'):
    im=Image.open(f'{root}/{t}.png').convert('RGB'); bg=im.getpixel((5,5))
    res={'page_bg':bg}
    for name,(x,y) in {'c-off':(186,82),'c-off-dis':(373,82),'r-off':(49,164)}.items():
        # darkest/lightest edge pixel on the box boundary row at its left edge region
        best=max((cr(im.getpixel((x+dx,y+dy)),bg),(x+dx,y+dy)) for dx in range(0,18) for dy in range(0,18))
        res[name]={'max_edge_contrast_vs_bg':best[0]}
    out[t]=res
print(json.dumps(out,indent=1))
