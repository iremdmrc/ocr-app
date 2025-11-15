# ocr/processing.py
import cv2, numpy as np
from PIL import Image

def pil2cv(p): return cv2.cvtColor(np.array(p), cv2.COLOR_RGB2BGR)
def cv2pil(m): return Image.fromarray(cv2.cvtColor(m, cv2.COLOR_BGR2RGB))

def deskew(pil_img):
    img = pil2cv(pil_img)
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    g = cv2.bitwise_not(g)
    th = cv2.threshold(g,0,255,cv2.THRESH_BINARY|cv2.THRESH_OTSU)[1]
    coords = np.column_stack(np.where(th>0))
    if coords.size==0: return pil_img, 0.0
    angle = cv2.minAreaRect(coords)[-1]
    angle = -(90+angle) if angle<-45 else -angle
    (h,w)=img.shape[:2]
    M=cv2.getRotationMatrix2D((w//2,h//2), angle, 1.0)
    rot=cv2.warpAffine(img,M,(w,h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
    return cv2pil(rot), angle

def enhance(pil_img):
    img = pil2cv(pil_img)
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(g,(3,3),0)
    norm = cv2.normalize(blur,None,0,255,cv2.NORM_MINMAX)
    sharp= cv2.addWeighted(norm,1.2, cv2.GaussianBlur(norm,(0,0),3), -0.2, 0)
    return cv2pil(cv2.cvtColor(sharp, cv2.COLOR_GRAY2BGR))

def segment_table_boxes(pil_img):
    """Tablo kutuları: (x,y,w,h) listesi (üstten alta, soldan sağa)."""
    img=pil2cv(pil_img)
    g=cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    bw=cv2.adaptiveThreshold(~g,255,cv2.ADAPTIVE_THRESH_MEAN_C,cv2.THRESH_BINARY,15,-2)
    hk=cv2.getStructuringElement(cv2.MORPH_RECT,(bw.shape[1]//30,1))
    vk=cv2.getStructuringElement(cv2.MORPH_RECT,(1,bw.shape[0]//20))
    h=cv2.dilate(cv2.erode(bw,hk,1),hk,1)
    v=cv2.dilate(cv2.erode(bw,vk,1),vk,1)
    table=cv2.add(h,v)
    cnts,_=cv2.findContours(table,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
    boxes=[]
    for c in cnts:
        x,y,w,h=cv2.boundingRect(c)
        if w*h<6000: continue
        boxes.append((x,y,w,h))
    return sorted(boxes, key=lambda b:(b[1]//40,b[0]))

def segment_line_boxes(pil_img):
    """
    Satırları üstten alta projeksiyonla bulur; sonra her satırda sağ/sol boşlukları kırpar.
    Çok yüksek kutuları alt bantlara böler, gürültüyü eler.
    """
    img = pil2cv(pil_img)
    H, W = img.shape[:2]
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    th = cv2.threshold(g, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[1]
    inv = 255 - th

    # Y projeksiyonu
    yproj = np.sum(inv > 0, axis=1)
    min_line_h = max(14, H // 120)
    boxes = []
    s = None
    for y in range(H):
        if yproj[y] > 0 and s is None:
            s = y
        if (yproj[y] == 0 or y == H - 1) and s is not None:
            e = y if yproj[y] == 0 else y + 1
            if e - s >= min_line_h:
                y1 = max(0, s - 2); y2 = min(H, e + 2)
                xproj = np.sum(inv[y1:y2] > 0, axis=0)
                xs = np.where(xproj > 0)[0]
                if xs.size:
                    x1 = max(0, int(xs.min() - 2))
                    x2 = min(W, int(xs.max() + 2))
                    boxes.append((x1, y1, x2 - x1, y2 - y1))
            s = None

    # Çok yüksek kutuları alt parçalara böl
    refined = []
    for (x, y, w, h) in boxes:
        if h > 80:
            sub = inv[y:y+h, x:x+w]
            subproj = np.sum(sub > 0, axis=1)
            s2 = None
            for yy in range(h):
                if subproj[yy] > 0 and s2 is None: s2 = yy
                if (subproj[yy] == 0 or yy == h - 1) and s2 is not None:
                    e2 = yy if subproj[yy] == 0 else yy + 1
                    if e2 - s2 >= min_line_h:
                        refined.append((x, y + s2, w, e2 - s2))
                    s2 = None
        else:
            refined.append((x, y, w, h))

    refined = [b for b in refined if b[2] * b[3] > 400]
    refined.sort(key=lambda b: (b[1] // 20, b[0]))
    return refined


def crop_with_box(pil_img, box):
    x,y,w,h = box
    return pil_img.crop((x,y,x+w,y+h))

def upsample(pil_img, scale=2):
    return pil_img.resize((pil_img.width*scale, pil_img.height*scale), Image.BICUBIC)

def looks_handwritten(pil_img):
    g=np.array(pil_img.convert("L"))
    return g.std()>42
