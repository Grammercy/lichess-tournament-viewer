"""15-second product film: a readable editorial composition and real chess geometry.

Python/ModernGL renders deterministic frames. Recorded site cards remain live;
isolated controls are reconstructed from the site's typography, values and colors.
The 128 BPM timeline is shared with compose_editorial.py.
"""
from pathlib import Path
import argparse, json, math, subprocess, time
import numpy as np
import moderngl
from PIL import Image, ImageDraw, ImageFont
import trimesh

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'editorial'
ASSETS=ROOT/'assets'
FPS=60; DURATION=15; BEAT=60/128
BG='#171916'; PANEL='#252622'; CREAM='#f1eee6'; MUTED='#a9ada1'; GREEN='#629924'
FONT='/usr/share/fonts/noto/NotoSans-Regular.ttf'
BOLD='/usr/share/fonts/noto/NotoSans-Bold.ttf'
DISPLAY='/usr/share/fonts/gsfonts/NimbusSans-Bold.otf'

def smooth(x):
    x=np.clip(x,0,1);return x*x*x*(x*(x*6-15)+10)
def ease(t,a,b):return float(smooth((t-a)/max(.001,b-a)))
def mix(a,b,p):return np.asarray(a)*(1-p)+np.asarray(b)*p
def spring(t,a,d=.75*BEAT):
    p=(t-a)/d
    if p<=0:return 0.
    if p>=1:return 1.
    z=.65;k=math.sqrt(1-z*z);w=3*math.pi/k
    v=1-math.exp(-z*w*p)*(math.cos(w*k*p)+z/k*math.sin(w*k*p))
    return 1+(v-1)*(1-float(smooth((p-.84)/.16)))
def rgb(s):return np.array([int(s[i:i+2],16)/255 for i in (1,3,5)])
def tr(x=0,y=0,z=0):
    m=np.eye(4,dtype='f4');m[:3,3]=[x,y,z];return m
def sc(s):return np.diag([s,s,s,1]).astype('f4')
def scale3(x,y,z):return np.diag([x,y,z,1]).astype('f4')
def rx(a):
    c,s=math.cos(a),math.sin(a);return np.array([[1,0,0,0],[0,c,-s,0],[0,s,c,0],[0,0,0,1]],dtype='f4')
def ry(a):
    c,s=math.cos(a),math.sin(a);return np.array([[c,0,s,0],[0,1,0,0],[-s,0,c,0],[0,0,0,1]],dtype='f4')
def rz(a):
    c,s=math.cos(a),math.sin(a);return np.array([[c,-s,0,0],[s,c,0,0],[0,0,1,0],[0,0,0,1]],dtype='f4')
def normal(v):return np.asarray(v)/np.linalg.norm(v)
def look(eye,target):
    f=normal(np.asarray(target)-eye);s=normal(np.cross(f,[0,1,0]));u=np.cross(s,f)
    m=np.eye(4,dtype='f4');m[:3,:3]=[s,u,-f];m[:3,3]=-m[:3,:3]@eye;return m
def ortho(l,r,b,t,n=.1,f=70):
    return np.array([[2/(r-l),0,0,-(r+l)/(r-l)],[0,2/(t-b),0,-(t+b)/(t-b)],[0,0,-2/(f-n),-(f+n)/(f-n)],[0,0,0,1]],dtype='f4')
def px(x,y,z=0,size=1):return tr((x-960)/90,(540-y)/90,z)@sc(size)

VS='''#version 330
in vec3 in_pos;in vec3 in_normal;
uniform mat4 model;uniform mat4 vp;uniform mat4 lightvp;
out vec3 pos;out vec3 normal;out vec4 lightpos;
void main(){vec4 p=model*vec4(in_pos,1);pos=p.xyz;
 normal=normalize(mat3(transpose(inverse(model)))*in_normal);
 lightpos=lightvp*p;gl_Position=vp*p;}
'''
FS='''#version 330
in vec3 pos;in vec3 normal;in vec4 lightpos;
uniform vec3 color;uniform float roughness;uniform float lighting;uniform sampler2D shadow;
out vec4 frag;
float visibility(vec3 n,vec3 l){
 vec3 p=lightpos.xyz/lightpos.w*.5+.5;
 if(p.x<0.||p.x>1.||p.y<0.||p.y>1.)return 1.;
 float bias=max(.0011*(1.-dot(n,l)),.0003),s=0.;
 for(int i=0;i<24;i++){float a=float(i)*2.399963;float r=sqrt((float(i)+.5)/24.);
 s+=p.z-bias<=texture(shadow,p.xy+vec2(cos(a),sin(a))*r*4./2048.).r?1.:0.;}
 return s/24.;
}
vec3 illumination(vec3 base,vec3 n,vec3 v,vec3 l,float power,float shadowAmount){
 vec3 h=normalize(v+l);float nv=max(dot(n,v),.001),nl=max(dot(n,l),0.),nh=max(dot(n,h),0.);
 float a=roughness*roughness,a2=a*a,den=nh*nh*(a2-1.)+1.;
 float D=a2/(3.141593*den*den);
 float k=pow(roughness+1.,2.)/8.;
 float G=(nv/(nv*(1.-k)+k))*(nl/(nl*(1.-k)+k));
 vec3 F=vec3(.04)+(1.-vec3(.04))*pow(1.-max(dot(h,v),0.),5.);
 return (base/3.141593+D*G*F/max(4.*nv*nl,.001))*nl*power*shadowAmount;
}
void main(){
 vec3 n=normalize(normal),v=normalize(vec3(0,0,25)-pos);
 vec3 base=pow(color,vec3(2.2));
 vec3 l=normalize(vec3(-4,9,14)-pos);
 vec3 c=base*(.28+.12*max(n.y,0.));
 c+=illumination(base,n,v,l,2.5,visibility(n,l));
 c+=illumination(base,n,v,normalize(vec3(9,6,8)-pos),1.2,1.);
 c+=illumination(base,n,v,normalize(vec3(1,5,-9)-pos),1.0,1.);
 vec3 reflection=reflect(-v,n);
 float box=pow(max(dot(reflection,normalize(vec3(-.35,.5,.7))),0.),55.);
 c+=vec3(.07)*box;
 c=clamp((c*(2.51*c+.03))/(c*(2.43*c+.59)+.14),0.,1.);
 c=pow(c,vec3(1./2.2));
 frag=vec4(mix(color,c,lighting),1.);
}
'''
SVS='''#version 330
in vec3 in_pos;uniform mat4 model;uniform mat4 lightvp;
void main(){gl_Position=lightvp*model*vec4(in_pos,1);}
'''
SFS='''#version 330
void main(){}
'''
UVS='''#version 330
in vec2 in_pos;out vec2 uv;uniform vec4 box;uniform float tilt;uniform float rotation;
void main(){uv=in_pos;vec2 local=(in_pos-.5)*box.zw;
 local=mat2(cos(rotation),sin(rotation),-sin(rotation),cos(rotation))*local;
 float z=local.y*sin(tilt);float f=1200./(1200.+z);
 vec2 p=box.xy+box.zw*.5+vec2(local.x,local.y*cos(tilt))*f;
 gl_Position=vec4(p.x/1920.*2.-1.,1.-p.y/1080.*2.,0,1);}
'''
UFS='''#version 330
in vec2 uv;uniform sampler2D image;uniform vec4 crop;uniform float alpha;
uniform float flip;uniform float radius;uniform vec2 size;out vec4 frag;
uniform float wipeProgress;uniform int wipe;
void main(){
 vec2 q=abs((uv-.5)*size)-size*.5+radius;
 float dist=length(max(q,0.))+min(max(q.x,q.y),0.)-radius;
 float mask=1.-smoothstep(-.6,.6,dist);
 if(wipe==1){
  vec2 cell=floor(min(uv,vec2(.9999))*vec2(8,6));
  float delay=(cell.x+cell.y*.12)/8.8;
  float p=clamp((wipeProgress-delay)*9.5,0.,1.);
  mask*=1.-smoothstep(p-.005,p+.005,fract(uv.x*8.));
 }
 vec2 p=vec2(uv.x,mix(uv.y,1.-uv.y,flip));
 vec4 c=texture(image,crop.xy+p*crop.zw);
 frag=vec4(c.rgb,c.a*alpha*mask);}
'''

class Film:
    def __init__(self,w=1920,h=1080):
        self.w,self.h=w,h;self.c=moderngl.create_standalone_context(backend='egl')
        c=self.c;self.p=c.program(vertex_shader=VS,fragment_shader=FS)
        self.sp=c.program(vertex_shader=SVS,fragment_shader=SFS)
        self.up=c.program(vertex_shader=UVS,fragment_shader=UFS)
        q=c.buffer(np.array([0,0,1,0,0,1,1,1],dtype='f4').tobytes())
        self.quad=c.vertex_array(self.up,[(q,'2f','in_pos')])
        self.ms=c.framebuffer(c.renderbuffer((w,h),4,samples=4),c.depth_renderbuffer((w,h),samples=4))
        self.ct=c.texture((w,h),4);self.scene=c.framebuffer(self.ct)
        self.out=c.simple_framebuffer((w,h),components=3)
        self.transition_textures=[c.texture((w,h),3),c.texture((w,h),3)]
        self.transition_frames=[c.framebuffer(t) for t in self.transition_textures]
        self.sh=c.depth_texture((2048,2048));self.sh.compare_func=''
        self.sf=c.framebuffer(depth_attachment=self.sh)
        self.lightvp=ortho(-14,14,-14,14,.1,65)@look(np.array([-4.,9.,14.]),np.zeros(3))
        self.vp=ortho(-1920/180,1920/180,-6,6,.1,70)@look(np.array([0.,0.,25.]),np.zeros(3))
        self.p['vp'].write(self.vp.T.astype('f4').tobytes())
        for program in [self.p,self.sp]:program['lightvp'].write(self.lightvp.T.astype('f4').tobytes())
        self.p['shadow']=1;self.up['image']=0
        self.meshes={};self.textures={};self.fonts={};self.objects=[]
        self.canvas=Image.new('RGBA',(1920,1080));self.canvas_texture=self.texture('canvas',self.canvas)
        self.canvas_texture.filter=(moderngl.LINEAR,moderngl.LINEAR)
        self.make_mesh('box',self.box())
        self.build_chess()
        self.pos=json.loads((ROOT/'source/captures.json').read_text())['continuity_position']['squares']
        for name in ['live-hq','study-hq','horse','finished-current-hq']:
            self.texture(name,Image.open(ASSETS/(name+'.png')))
        for style in ['cburnett','merida','chessnut']:
            for code in [c+p for c in 'wb' for p in 'KQRBNP']:
                self.texture(style+'-'+code,Image.open(ASSETS/f'pieces/{style}-{code}.png'))
        self.live=None;self.live_texture=None
        self.tabs_texture=self.c.texture((756,84),4);self.tabs_texture.filter=(moderngl.LINEAR,moderngl.LINEAR)
        self.piece_images={code:Image.open(ASSETS/f'pieces/cburnett-{code}.png').convert('RGBA') for code in [c+p for c in 'wb' for p in 'KQRBNP']}

    def font(self,size,bold=False,display=False):
        key=(size,bold,display)
        if key not in self.fonts:self.fonts[key]=ImageFont.truetype(DISPLAY if display else BOLD if bold else FONT,size)
        return self.fonts[key]
    def texture(self,key,im):
        im=im.convert('RGBA');t=self.c.texture(im.size,4,im.tobytes());t.build_mipmaps()
        t.filter=(moderngl.LINEAR_MIPMAP_LINEAR,moderngl.LINEAR);self.textures[key]=t;return t
    def make_mesh(self,key,m):
        if key.startswith('chess-'):
            # UV seams split the glTF vertices. Weld equal positions and derive
            # continuous studio normals while preserving the authored silhouette.
            m=m.copy();m.merge_vertices(merge_tex=True,merge_norm=True);m._cache.clear()
        v=self.c.buffer(np.column_stack([m.vertices,m.vertex_normals]).astype('f4').tobytes())
        indices=self.c.buffer(m.faces.astype('i4').tobytes())
        self.meshes[key]=(self.c.vertex_array(self.p,[(v,'3f 3f','in_pos','in_normal')],indices),
            self.c.vertex_array(self.sp,[(v,'3f 12x','in_pos')],indices))
    @staticmethod
    def box():
        points=[]
        for x in [-1,1]:
            for y in [-1,1]:
                for z in [-1,1]:
                    for axis in range(3):
                        p=np.array([x,y,z],dtype=float)*.978;p[axis]=[x,y,z][axis];points.append(p)
        return trimesh.convex.convex_hull(points)
    def build_chess(self):
        scene=trimesh.load(ASSETS/'models/ABeautifulGame.glb',force='scene')
        loaded={};self.chess={}
        for col in 'wb':
            for typ,prefix in {'K':'King','Q':'Queen','R':'Castle','N':'Knight','B':'Bishop','P':'Pawn_Body'}.items():
                node=prefix+'_'+col.upper()+('' if typ in 'KQ' else '1')
                world,name=scene.graph[node];body=scene.geometry[name];bottom=body.bounds[0,1]
                components=[(name,np.eye(4))]
                if typ=='P':
                    tw,tn=scene.graph['Pawn_Top_'+col.upper()+'1'];components.append((tn,np.linalg.inv(world)@tw))
                self.chess[col+typ]=[]
                for name,rel in components:
                    if name not in loaded:
                        key='chess-'+str(len(loaded));self.make_mesh(key,scene.geometry[name]);loaded[name]=key
                    local=rx(math.pi/2)@sc(11.1)@tr(0,-bottom,0)@rel
                    if typ=='N':local=rz(math.pi/2 if col=='w' else -math.pi/2)@local
                    self.chess[col+typ].append((loaded[name],local))

    def blit(self,tex,box,alpha=1,crop=(0,0,1,1),radius=0,flip=False,tilt=0,rotation=0,wipe_progress=None):
        if alpha<=.001:return
        self.c.disable(moderngl.DEPTH_TEST);self.c.enable(moderngl.BLEND)
        self.c.blend_func=(moderngl.SRC_ALPHA,moderngl.ONE_MINUS_SRC_ALPHA)
        self.up['box']=tuple(float(x) for x in box);self.up['crop']=crop;self.up['alpha']=float(alpha)
        self.up['flip']=float(flip);self.up['radius']=radius;self.up['size']=tuple(float(x) for x in box[2:])
        self.up['tilt']=float(tilt)
        self.up['rotation']=float(rotation)
        self.up['wipe']=int(wipe_progress is not None);self.up['wipeProgress']=float(wipe_progress or 0)
        tex.use(0);self.quad.render(moderngl.TRIANGLE_STRIP)
    def flush(self,alpha=1):
        self.canvas_texture.write(self.canvas.tobytes())
        self.blit(self.canvas_texture,(0,0,1920,1080),alpha)
        self.canvas=Image.new('RGBA',(1920,1080))
    def component(self,key,box,alpha=1,size=1,tilt=0):
        x,y,w,h=box;x,y,w,h=map(int,[x,y,w,h])
        im=self.canvas.crop((x,y,x+w,y+h))
        if key not in self.textures:
            self.texture(key,im);self.textures[key].filter=(moderngl.LINEAR,moderngl.LINEAR)
        else:self.textures[key].write(im.tobytes())
        self.blit(self.textures[key],(x+w*(1-size)/2,y+h*(1-size)/2,w*size,h*size),alpha,radius=14,tilt=tilt)
        self.canvas=Image.new('RGBA',(1920,1080))
    def text(self,s,x,y,size=32,color=CREAM,bold=False,display=False):
        ImageDraw.Draw(self.canvas).text((int(x),int(y)),s,font=self.font(size,bold,display),fill=color,stroke_width=0)
    def rolling_title(self,t):
        p=ease(t,10*BEAT,10*BEAT+.35)
        for y,old,new in [(87,'Every game.','Your board.'),(195,'One view.','Your way.')]:
            im=Image.new('RGBA',(758,111));d=ImageDraw.Draw(im)
            d.text((0,-111*p),old,font=self.font(100,display=True),fill=CREAM)
            d.text((0,111*(1-p)),new,font=self.font(100,display=True),fill=CREAM)
            self.canvas.alpha_composite(im,(96,y))
    def rect(self,box,color=PANEL,radius=12,outline=None,width=2):
        x,y,w,h=map(int,box);ImageDraw.Draw(self.canvas).rounded_rectangle((x,y,x+w,y+h),radius,fill=color,outline=outline,width=width)
    def line(self,xy,color=GREEN,width=3):ImageDraw.Draw(self.canvas).line(xy,fill=color,width=width)
    def dot(self,x,y,r=5,color=GREEN):ImageDraw.Draw(self.canvas).ellipse((x-r,y-r,x+r,y+r),fill=color)
    def piece_icon(self,code,x,y,size,style='cburnett'):
        key=(style,code)
        if key not in self.piece_images:self.piece_images[key]=Image.open(ASSETS/f'pieces/{style}-{code}.png').convert('RGBA')
        im=self.piece_images[key].resize((size,size),Image.Resampling.LANCZOS);self.canvas.alpha_composite(im,(int(x),int(y)))
    def panel_shadow(self,box,p=1):
        x,y,w,h=box
        for i in range(10,0,-1):
            self.rect((x-i*2,y+i*2,w+i*4,h),color=(0,0,0,int(p*2)),radius=16)

    def add(self,key,model,color,rough=.38,lighting=1):self.objects.append((key,model,rgb(color) if isinstance(color,str) else color,rough,lighting))
    def chess_piece(self,code,model):
        for key,local in self.chess[code]:self.add(key,model@local,'#ecefe2' if code[0]=='w' else '#454b40',.31 if code[0]=='w' else .27)
    def board(self,rig,t,small=False,pop=1):
        n=3 if small else 8
        lit=1 if small else float(np.clip(pop,0,1))
        self.add('box',rig@tr(z=-.12)@scale3(n/2+.08,n/2+.08,.12),'#574330',.43,lit)
        green=0 if small else ease(t,15*BEAT,15*BEAT+.34);blue=0 if small else ease(t,17*BEAT,17*BEAT+.34)
        light=mix(mix(rgb('#f0d9b5'),rgb('#d9e7ca'),green),rgb('#dbe4e9'),blue)
        dark=mix(mix(rgb('#b58863'),rgb('#84a06b'),green),rgb('#87a4b8'),blue)
        for row in range(n):
            for col in range(n):
                x=col-(n-1)/2;y=(n-1)/2-row;color=light if (row+col)%2==0 else dark
                if not small and row*8+col in [31,37]:color=mix(color,rgb('#a3b057'),.46)
                # Small per-file timing makes theme changes propagate across the board.
                if not small:
                    a=ease(t,15*BEAT+col*.022,15*BEAT+.32+col*.022)
                    b=ease(t,17*BEAT+col*.022,17*BEAT+.32+col*.022)
                    color=mix(mix(rgb('#f0d9b5') if (row+col)%2==0 else rgb('#b58863'),
                        rgb('#d9e7ca') if (row+col)%2==0 else rgb('#84a06b'),a),
                        rgb('#dbe4e9') if (row+col)%2==0 else rgb('#87a4b8'),b)
                    if row*8+col in [31,37]:color=mix(color,rgb('#a3b057'),.46)
                self.add('box',rig@tr(x,y,-.015)@scale3(.5,.5,.018),color,.56,lit)
        if small:
            fall=(1-ease(t,.03,BEAT))*.38 if t<2 else 0
            self.chess_piece('wN',rig@tr(z=.025+fall)@rz(.15*(1-ease(t,0,1.10)))@sc(1.35))
        else:
            for i,code in enumerate(self.pos):
                if not code:continue
                row,col=divmod(i,8)
                rise=ease(t,13*BEAT+row*.002,13.25*BEAT+row*.002)
                self.chess_piece(code,rig@tr(col-3.5,3.5-row,.025-(1-rise)*1.72))

    def render_objects(self,alpha=1):
        c=self.c;c.disable(moderngl.BLEND);c.enable(moderngl.DEPTH_TEST)
        self.sf.use();self.sf.clear(depth=1);c.viewport=(0,0,2048,2048)
        for key,m,color,rough,lighting in self.objects:
            self.sp['model'].write(m.T.astype('f4').tobytes());self.meshes[key][1].render()
        self.ms.use();self.ms.clear(0,0,0,0,depth=1);c.viewport=(0,0,self.w,self.h);self.sh.use(1)
        for key,m,color,rough,lighting in self.objects:
            self.p['model'].write(m.T.astype('f4').tobytes());self.p['color']=tuple(color);self.p['roughness']=rough
            self.p['lighting']=lighting;self.meshes[key][0].render()
        c.copy_framebuffer(self.scene,self.ms);self.out.use()
        self.blit(self.ct,(0,0,1920,1080),alpha,flip=True)
        self.objects=[]

    def live_cards(self,t,alpha=1):
        tex=self.live_texture or self.textures['live-hq']
        focus=math.sin(math.pi*ease(t,3.00,3.86))
        for i,x in enumerate([936,1412]):
            box=(x,182,446,708);crop=((302+i*282)/1430,281/900,262/1430,416/900)
            self.blit(tex,box,alpha*(1-.23*focus)*(1-(.72*ease(t,4.03,4.29) if i==1 else 0)),crop=crop,radius=11)
            if i==1 and 3.63<t<4.03:
                a=ease(t,3.63,3.97)*alpha*(1-.23*focus)
                self.blit(self.textures['finished-current-hq'],box,a,crop=crop,radius=11)

    def status_tabs(self,t,alpha=1):
        focus=math.sin(math.pi*ease(t,3.00,3.86))
        im=Image.new('RGBA',(756,84));d=ImageDraw.Draw(im)
        d.rounded_rectangle((1,1,754,82),11,fill=PANEL,outline=GREEN if focus>.03 else '#383b32',width=3 if focus>.03 else 1)
        for label,x,count in [('All games',24,'596'),('Playing',267,'67'),('Finished',492,'529')]:
            d.text((x,16),label,font=self.font(27,True),fill=CREAM)
            d.text((x+(144 if label=='All games' else 119),21),count,font=self.font(20),fill=MUTED)
        left=float(mix(253,16,spring(t,7*BEAT)))
        right=float(mix(458,227,min(1,spring(t,7*BEAT,.70*BEAT))))
        d.rounded_rectangle((left,75,right,79),2,fill=GREEN)
        self.tabs_texture.write(im.tobytes())
        size=1+.055*focus;box=(96-756*(size-1)/2,478-26*focus,756*size,84*size)
        self.blit(self.tabs_texture,box,alpha,radius=11,tilt=.16*focus)
    def live_widgets(self,t,alpha=1):
        self.text('Every game.',96,87,100,display=True)
        self.text('One view.',96,195,100,display=True)
        self.text('Hourly SuperBlitz Arena',99,323,30,color=MUTED)
        self.rect((96,378,756,74));self.text('596 games',120,395,30,bold=True)
        self.dot(376,415);self.text('67 playing',395,395,30)
        self.text('529 finished',604,395,28,color=MUTED)
        lift=math.sin(math.pi*ease(t,3.00,3.86))*26
        box=(96-lift/2,478-lift,756+lift,84+lift/3)
        self.panel_shadow(box,lift/12)
        # Propagate the changed control to the dependent components, without a full-screen halo.
        p=ease(t,3.6328125,4.09)
        for delay,bb in [(0,(936,182,446,708)),(.09,(1412,182,446,708))]:
            u=ease(t,3.63+delay,3.95+delay)
            strength=math.sin(math.pi*u)
            if strength>.005:
                col=(122,167,62,int(180*strength))
                self.rect(bb,None,12,col,3)
        self.rect((96,590,756,66),BG,10,'#45483f')
        self.dot(124,620,8,color='#adb2a4')
        self.dot(124,620,5,color=BG);self.line((130,626,137,633),MUTED,3)
        chars=int(ease(t,3.93,4.34)*8)
        self.text('Raul3031'[:chars] if t>=3.93 else 'Find a player',156,603,27,color=CREAM if t>=3.93 else MUTED)
        if t>=3.93 and t<4.45:self.line((156+chars*17,607,156+chars*17,638),GREEN,2)
        self.text('TOP PLAYERS',98,695,23,color=MUTED,bold=True)
        self.rect((96,738,756,240))
        players=[('1','largoenroque','37'),('2','Raul3031','34'),('3','NartaiErdihanov1','32'),('4','Petrovich38','28')]
        for i,(rank,name,points) in enumerate(players):
            yy=752+i*54
            if name=='Raul3031' and t>4.10:self.rect((107,yy-2,732,51),'#303b25',6)
            self.text(rank,119,yy,24,color=GREEN,bold=True);self.text(name,159,yy,26)
            self.text(points,774,yy,26,bold=True)
        self.dot(951,124);self.text('LIVE',970,105,25,color=MUTED,bold=True)
        self.text('Moves and clocks update live.',1190,934,30,color=MUTED)
        self.flush(alpha*(1-.23*math.sin(math.pi*ease(t,3.00,3.86))))
        self.status_tabs(t,alpha)

    def player_rows(self,box,t,alpha=1,light=False):
        x,y,w,h=box
        flipped=t>=5.33
        names=[('Raul3031','2051','0:45'),('OmarPetare','1960','0:52')]
        if not flipped:names.reverse()
        for i,(name,rating,clock) in enumerate(names):
            yy=y-63 if i==0 else y+h+10
            self.rect((x,yy,w,52),'#eeece5' if light else PANEL,9)
            self.dot(x+22,yy+26,5,'#46493f' if light else '#c5cbbd')
            self.text(name,x+39,yy+7,25,'#30342a' if light else CREAM,bold=True)
            self.text(rating,x+225,yy+11,20,'#71776a' if light else MUTED)
            self.rect((x+w-101,yy+6,90,40),'#ddddcf' if light else '#171916',7)
            self.text(clock,x+w-93,yy+8,25,'#30342a' if light else CREAM,bold=True)
        self.flush(alpha)

    def flat_board(self,box,t,alpha=1,grid=True,rig=None):
        x,y,w,h=box;n=w/8
        angle=ease(t,5.06,5.54)*math.pi
        turn_scale=1/(abs(math.cos(angle))+abs(math.sin(angle)))
        n*=turn_scale
        rotated=(x+w/2-w*turn_scale/2,y+h/2-h*turn_scale/2,w*turn_scale,h*turn_scale)
        key='flat-grid'
        if key not in self.textures:
            im=Image.new('RGBA',(800,800));d=ImageDraw.Draw(im)
            for i in range(64):
                r,c=divmod(i,8);d.rectangle((c*100,r*100,c*100+100,r*100+100),fill='#f0d9b5' if (r+c)%2==0 else '#b58863')
            self.texture(key,im)
        if grid:self.blit(self.textures[key],rotated,alpha,rotation=angle)
        for idx,code in enumerate(self.pos[::-1]):
            if not code:continue
            row,col=divmod(idx,8);v=np.array([col-3.5,row-3.5])
            v=np.array([[math.cos(angle),-math.sin(angle)],[math.sin(angle),math.cos(angle)]])@v
            cx=x+w/2+v[0]*n;cy=y+h/2+v[1]*n
            if grid and idx in [26,32]:
                self.rect((cx-n/2,cy-n/2,n,n),(156,171,73,145),0)
        self.flush(alpha)
        style='merida' if t>=5.67 else 'cburnett'
        for idx,code in enumerate(self.pos[::-1]):
            if not code:continue
            row,col=divmod(idx,8);v=np.array([col-3.5,row-3.5])
            v=np.array([[math.cos(angle),-math.sin(angle)],[math.sin(angle),math.cos(angle)]])@v
            cx=x+w/2+v[0]*n;cy=y+h/2+v[1]*n
            if rig is not None:
                point=self.vp@rig@np.array([v[0],-v[1],.03,1])
                cx=960*(1+point[0]/point[3]);cy=540*(1-point[1]/point[3])
            self.blit(self.textures[style+'-'+code],(cx-n*.46,cy-n*.46,n*.92,n*.92),alpha)

    def info(self,box,light=False,compact=False):
        x,y,w,h=box;fg='#30342a' if light else CREAM;mut='#6d7464' if light else MUTED
        self.rect(box,'#eeece5' if light else PANEL,14)
        self.text('TOURNAMENT',x+26,y+23,21,mut,bold=True)
        if compact:
            self.text('Hourly',x+24,y+70,28,fg,bold=True)
            self.text('SuperBlitz',x+24,y+106,28,fg,bold=True)
            self.text('Arena',x+24,y+142,28,fg,bold=True)
            for i,(a,b) in enumerate([('Time control','3 + 0'),('Players','349'),('Duration','57 min')]):
                self.text(a,x+24,y+210+i*90,20,mut)
                self.text(b,x+24,y+239+i*90,29,fg,bold=True)
            self.dot(x+29,y+509);self.text('LIVE',x+44,y+492,23,mut,bold=True)
        else:
            self.text('Hourly SuperBlitz',x+26,y+69,40,fg,bold=True)
            self.text('Arena',x+26,y+121,40,fg,bold=True)
            for i,(a,b) in enumerate([('Time control','3 + 0'),('Players','349'),('Duration','57 minutes')]):
                self.text(a,x+26,y+221+i*68,27,mut)
                self.text(b,x+w-180,y+221+i*68,27,fg,bold=True)
            self.dot(x+34,y+h-54);self.text('Moves and clocks update live',x+53,y+h-76,24,mut)

    def settings(self,box,t,light=False,compact=False):
        x,y,w,h=box;fg='#30342a' if light else CREAM;mut='#6d7464' if light else MUTED
        self.rect(box,'#eeece5' if light else PANEL,14,outline='#8da650' if 6.1<t<6.6 else None)
        if compact:
            self.text('YOUR',x+21,y+22,22,mut,bold=True);self.text('BOARD',x+21,y+51,22,mut,bold=True)
            self.text('Flip board',x+21,y+123,24,fg,bold=True)
            self.rect((x+20,y+176,w-40,56),'#3a472d',8)
            self.text('Flip',x+58,y+186,24,fg,bold=True)
            self.text('Piece set',x+21,y+280,24,fg,bold=True)
            self.piece_icon('wN',x+44,y+332,100,'merida' if t>=5.67 else 'cburnett')
            self.text('Merida' if t>=5.67 else 'Cburnett',x+28,y+460,24,mut)
            return
        self.text('Display settings',x+28,y+26,32,fg,bold=True)
        self.text('Appearance',x+28,y+88,25,fg,bold=True)
        for i,label in enumerate(['Light','Dark']):
            bx=x+28+i*220
            self.rect((bx,y+132,201,74),'#e0e4d7' if light else '#30332b',8,outline=GREEN if (light and i==0) or (not light and i==1) else None,width=3)
            self.rect((bx+66,y+143,70,20),'#f2f1eb' if i==0 else '#171916',3)
            self.text(label,bx+73,y+173,22,fg)
        self.text('Board colors',x+28,y+244,25,fg,bold=True)
        selected=2 if t>=17*BEAT+.15 else 1 if t>=15*BEAT+.15 else 0
        for i,(label,l,d) in enumerate([('Brown','#f0d9b5','#b58863'),('Green','#d9e7ca','#84a06b'),('Blue','#dbe4e9','#87a4b8')]):
            bx=x+28+i*149
            self.rect((bx-3,y+292,137,131),None,8,outline=GREEN if i==selected else '#59614e',width=3 if i==selected else 1)
            for r in range(4):
                for c in range(4):self.rect((bx+c*32,y+298+r*21,32,21),l if (r+c)%2==0 else d,0)
            self.text(label,bx+20,y+392,22,fg)
        self.text('Piece set',x+28,y+458,25,fg,bold=True)
        for i,label in enumerate(['Cburnett','Merida','Chessnut']):
            bx=x+28+i*149
            self.rect((bx-3,y+503,137,123),'#e0e4d7' if light else '#30332b',8,outline=GREEN if label=='Merida' else None,width=3)
            self.piece_icon('wN',bx+29,y+508,76,label.lower())
            self.text(label,bx+(14 if i!=2 else 8),y+595,20,fg)
        self.text('Board mode',x+28,y+661,24,fg,bold=True)
        for i,label in enumerate(['2D','3D']):
            bx=x+259+i*100
            self.rect((bx,y+650,85,52),GREEN if i==1 else '#c9cebf' if light else '#363b30',7)
            self.text(label,bx+24,y+659,24,CREAM if i==1 else fg,bold=True)

    def customization(self,t,alpha=1):
        entry=1
        self.rolling_title(t)
        self.flush(alpha)
        # One locked board center; side-panel changes are depth pops at fixed anchors.
        pop=spring(t,13*BEAT,.75*BEAT)
        light=ease(t,6.48,6.80)
        if t<13*BEAT+.16:
            p=1-ease(t,13*BEAT,13*BEAT+.16)
            box1=(96,340,570,570);box2=(1627,339,225,570)
            self.info(box1);self.component('info-large',box1,alpha*p,1-.09*(1-p))
            self.settings(box2,t,compact=True);self.component('settings-small',box2,alpha*p,1-.09*(1-p))
        else:
            p=spring(t,13*BEAT+.16,.45*BEAT)
            sy=340+18*(1-p)
            for state,opacity in ([(True,1)] if light>.999 else [(False,1),(True,light)]):
                if opacity<.001:continue
                b1=(96,sy,510,723);b2=(1640,340+12*(1-p),220,570)
                self.settings(b1,t,state)
                self.component('settings-full',b1,alpha*min(1,max(0,p))*opacity,.88+.12*p,-.10*(1-p))
                self.info(b2,state,compact=True)
                self.component('info-small',b2,alpha*min(1,max(0,p))*opacity,.88+.12*p,.10*(1-p))
        # Lift at the exact planar center, with full-scale geometry emerging through the surface.
        zoom=ease(t,10*BEAT,11*BEAT)
        box=tuple(mix((936,306,446,446),(840,236,760,760),zoom))
        if t<13*BEAT:self.flat_board(box,t,alpha)
        else:
            rig=px(1220,616,1.25*pop,760/720)@ry(-.075*pop)@rx(-.66*pop)
            self.board(rig,t,pop=pop);self.render_objects(alpha)
            icon_alpha=1-ease(t,13*BEAT,13.25*BEAT+.012)
            if icon_alpha>.001:self.flat_board(box,t,alpha*icon_alpha,grid=False,rig=rig)
        for state,opacity in ([(True,1)] if light>.999 else [(False,1),(True,light)]):
            if opacity>.001:self.player_rows(box,t,alpha*entry*opacity,state)

    def study(self,t,alpha=1):
        p=ease(t,20*BEAT,20*BEAT+.30)
        self.text('Keep the',96,87,100,display=True)
        self.text('tournament.',96,195,100,display=True)
        self.text('Every game becomes a chapter.',100,323,30,color=MUTED)
        for i in range(3):
            q=ease(t,20*BEAT+.14+i*.10,20*BEAT+.50+i*.10)
            x=98+i*220;y=556+32*(1-q)
            self.rect((x,y,195,242),PANEL,12)
            self.text('CHAPTER '+str(i+1),x+14,y+205,19,color=MUTED,bold=True)
        self.flush(alpha)
        for i in range(3):
            q=ease(t,20*BEAT+.14+i*.10,20*BEAT+.50+i*.10)
            self.blit(self.live_texture or self.textures['live-hq'],(106+i*220,564+32*(1-q),179,179),alpha*q,
                crop=((302+i*282)/1430,354/900,262/1430,262/900),radius=5)
        q=spring(t,20*BEAT,.85*BEAT)
        self.blit(self.textures['study-hq'],(974,179+25*(1-q),850,747),alpha*min(1,q),
            crop=(480/1430,239/900,480/1430,422/900),radius=14)

    def ending(self,t,alpha=1,ready=False):
        p=1 if ready else ease(t,27*BEAT,28*BEAT)
        self.text('Lichess',96,215,124,display=True)
        self.text('Tournament',96,352,112,display=True)
        self.text('Viewer',96,475,112,display=True)
        self.text('Arena & Swiss. Live play. Your study.',102,665,31,color=MUTED)
        self.text('lichess-tournament-viewer.aralani.chatgpt.site',102,760,32)
        self.flush(alpha*p)
        rig=px(1433,779,0,2.25)@ry(-.19)@rx(-.94)
        self.board(rig,t,small=True);self.render_objects(alpha*p)

    def frame(self,t):
        c=self.c;self.out.use();c.viewport=(0,0,self.w,self.h);self.out.clear(*rgb(BG),1)
        self.canvas=Image.new('RGBA',(1920,1080))
        if self.live is not None and 1.5<t<13:
            j=min(len(self.live)-1,int((t-1.5)*30));self.live_texture.write(self.live[j].tobytes())
        if t<4.6875:
            live=1 if t>=4*BEAT else 0
            if t<4*BEAT:
                self.text('Every game.',96,87,100,display=True)
                self.text('One view.',96,195,100,display=True)
                self.text('A tournament in motion.',101,323,30,color=MUTED)
                self.flush(1-live)
                settle=ease(t,1.18,4*BEAT)
                rig=px(float(mix(1380,1182,settle)),float(mix(667,667,settle)),0,float(mix(3.05,2.35,settle)))@ry(-.20)@rx(-.94)
                self.board(rig,t,small=True);self.render_objects(1-live)
            leave=1
            self.live_cards(t,live*leave);self.live_widgets(t,live*leave)
        if 10*BEAT<=t<20*BEAT:self.customization(t)
        if 20*BEAT<=t<28*BEAT:self.study(t)
        if 27*BEAT<=t<28*BEAT:
            c.copy_framebuffer(self.transition_frames[0],self.out)
            self.out.clear(*rgb(BG),1);self.ending(t,ready=True)
            c.copy_framebuffer(self.transition_frames[1],self.out)
            self.out.use();self.out.clear(*rgb(BG),1)
            self.blit(self.transition_textures[0],(0,0,1920,1080),flip=True)
            self.blit(self.transition_textures[1],(0,0,1920,1080),flip=True,wipe_progress=ease(t,27*BEAT,28*BEAT))
        if t>=28*BEAT:self.ending(t)
        self.out.use()
        return self.out.read(components=3,alignment=1)

    def load_live(self):
        raw=subprocess.check_output(['ffmpeg','-v','error','-ss','3','-i',str(ASSETS/'live-source.mp4'),'-t','8',
            '-vf','scale=1440:900,fps=30','-f','rawvideo','-pix_fmt','rgba','-'])
        self.live=np.frombuffer(raw,np.uint8).reshape(-1,900,1440,4)
        self.live_texture=self.c.texture((1440,900),4);self.live_texture.filter=(moderngl.LINEAR,moderngl.LINEAR)
        self.live_texture.write(self.live[0].tobytes())

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--stills',action='store_true');ap.add_argument('--draft',action='store_true')
    ap.add_argument('--render',action='store_true');args=ap.parse_args()
    OUT.mkdir(exist_ok=True);(OUT/'stills').mkdir(exist_ok=True)
    film=Film(960,540) if args.draft else Film()
    if args.stills:
        times=[.55,2.50,3.43,4.17,5.05,5.80,6.43,6.91,7.61,8.54,10.60,14.20]
        for t in times:
            im=Image.frombytes('RGB',(film.w,film.h),film.frame(t)).transpose(Image.Transpose.FLIP_TOP_BOTTOM)
            im.save(OUT/f'stills/{t:05.2f}.png')
        sheet=Image.new('RGB',(1920,4*292),BG);d=ImageDraw.Draw(sheet)
        for i,t in enumerate(times):
            im=Image.open(OUT/f'stills/{t:05.2f}.png');im.thumbnail((640,270))
            x=(i%3)*640;y=(i//3)*292
            sheet.paste(im,(x,y+22));d.text((x+10,y+2),f'{t:.2f}s',font=film.font(15),fill=CREAM)
        sheet.save(OUT/'storyboard.jpg',quality=94);print('Rendered 12 layout frames.');return
    film.load_live()
    target=OUT/('draft.mp4' if args.draft else 'silent.mp4')
    cmd=['ffmpeg','-v','error','-y','-f','rawvideo','-pixel_format','rgb24','-video_size',f'{film.w}x{film.h}',
        '-framerate',str(FPS),'-i','-','-vf','vflip','-c:v','libx264','-preset','fast','-crf','18' if args.draft else '17',
        '-pix_fmt','yuv420p','-movflags','+faststart',str(target)]
    process=subprocess.Popen(cmd,stdin=subprocess.PIPE);start=time.time()
    for i in range(FPS*DURATION):process.stdin.write(film.frame(i/FPS))
    process.stdin.close();assert process.wait()==0
    print(f'Rendered {target.name}, 900 frames, in {time.time()-start:.1f}s.')

if __name__=='__main__':main()
