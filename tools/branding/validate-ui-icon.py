#!/usr/bin/env python3
import struct,sys,zlib
from pathlib import Path

path=Path(sys.argv[1])
data=path.read_bytes()
if data[:8]!=b'\x89PNG\r\n\x1a\n': raise SystemExit('not_png')
pos=8;width=height=bit_depth=color_type=None;idat=bytearray();seen_iend=False
while pos+12<=len(data):
    length=struct.unpack('>I',data[pos:pos+4])[0]
    kind=data[pos+4:pos+8];payload=data[pos+8:pos+8+length];crc=data[pos+8+length:pos+12+length]
    if len(payload)!=length or len(crc)!=4: raise SystemExit('truncated_png')
    expected=struct.pack('>I',zlib.crc32(kind+payload)&0xffffffff)
    if crc!=expected: raise SystemExit(f'bad_crc_{kind.decode("ascii","ignore")}')
    if kind==b'IHDR': width,height,bit_depth,color_type,_,_,_=struct.unpack('>IIBBBBB',payload)
    elif kind==b'IDAT': idat.extend(payload)
    elif kind==b'IEND': seen_iend=True;break
    pos+=12+length
if not seen_iend: raise SystemExit('missing_iend')
if (width,height)!=(32,32): raise SystemExit(f'unexpected_dimensions_{width}x{height}')
if (bit_depth,color_type)!=(8,6): raise SystemExit(f'expected_rgba8_got_{bit_depth}_{color_type}')
raw=zlib.decompress(bytes(idat));stride=width*4
if len(raw)!=(stride+1)*height: raise SystemExit('unexpected_scanline_size')
rows=[];offset=0;prev=bytearray(stride)
def paeth(a,b,c):
    p=a+b-c;pa=abs(p-a);pb=abs(p-b);pc=abs(p-c)
    return a if pa<=pb and pa<=pc else b if pb<=pc else c
for _ in range(height):
    f=raw[offset];src=raw[offset+1:offset+1+stride];offset+=stride+1;row=bytearray(stride)
    for x,v in enumerate(src):
        a=row[x-4] if x>=4 else 0;b=prev[x];c=prev[x-4] if x>=4 else 0
        if f==0: value=v
        elif f==1: value=(v+a)&255
        elif f==2: value=(v+b)&255
        elif f==3: value=(v+((a+b)//2))&255
        elif f==4: value=(v+paeth(a,b,c))&255
        else: raise SystemExit(f'unsupported_filter_{f}')
        row[x]=value
    rows.append(row);prev=row
visible=[]
for y,row in enumerate(rows):
    for x in range(width):
        alpha=row[x*4+3]
        if alpha>8: visible.append((x,y))
if not visible: raise SystemExit('no_visible_pixels')
xs=[p[0] for p in visible];ys=[p[1] for p in visible]
bbox=(min(xs),min(ys),max(xs)+1,max(ys)+1)
bbox_ratio=((bbox[2]-bbox[0])*(bbox[3]-bbox[1]))/(width*height)
visible_ratio=len(visible)/(width*height)
if bbox_ratio<0.45: raise SystemExit(f'visible_bbox_too_small_{bbox_ratio:.3f}')
if visible_ratio<0.15: raise SystemExit(f'alpha_coverage_too_small_{visible_ratio:.3f}')
print(f'{path}: {width}x{height}, bbox={bbox}, bbox_ratio={bbox_ratio:.3f}, visible_ratio={visible_ratio:.3f}')
