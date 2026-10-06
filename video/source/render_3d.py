"""A deterministic, genuinely 3D product film. EGL/OpenGL + captured website media.

Run with .venv/bin/python render_3d.py --stills, --draft or --render.
The shared beat timeline is 128 BPM, 60 frames per second, 15 seconds.
"""
from pathlib import Path
import argparse, json, math, subprocess, time
import numpy as np
import moderngl
from PIL import Image, ImageDraw, ImageFont
import trimesh

ROOT=Path(__file__).resolve().parents[1]/'rebuild'
ASSETS=ROOT.parent/'assets'
FPS=60; DURATION=15; BEAT=60/128
FONT='/usr/share/fonts/noto/NotoSans-Regular.ttf'
BOLD='/usr/share/fonts/noto/NotoSans-Bold.ttf'
BLACK='/usr/share/fonts/noto/NotoSans-Black.ttf'
CREAM=np.array([.91,.85,.73]); BROWN=np.array([.54,.38,.25])

def smooth(x):
    x=np.clip(x,0,1);return x*x*x*(x*(x*6-15)+10)
def window(t,a,b):
    # Quarter beats align the small moves with hats; large arrivals hit kicks.
    a=round(a/(BEAT/4))*(BEAT/4);b=round(b/(BEAT/4))*(BEAT/4)
    return float(smooth((t-a)/max(b-a,BEAT/4)))
def selection_spring(t,start=7*BEAT,duration=.75*BEAT):
    # A finite damped spring: the first overshoot lands on the next quarter beat.
    p=(t-start)/duration
    if p<=0:return 0.
    if p>=1:return 1.
    damping=.65;root=math.sqrt(1-damping*damping);frequency=3*math.pi/root
    response=1-math.exp(-damping*frequency*p)*(math.cos(frequency*root*p)+damping/root*math.sin(frequency*root*p))
    return 1+(response-1)*(1-float(smooth((p-.84)/.16)))

def selection_state(t):
    start=7*BEAT;duration=.75*BEAT
    trailing=selection_spring(t,start,duration)
    leading=min(1.,selection_spring(t,start,duration*.94))
    # Lead slightly with the right edge. The trailing edge compresses on overshoot.
    left=float(lerp(394/1014,674/1014,trailing))
    right=float(lerp(688/1014,1010/1014,leading))
    align=1-window(t,3.90,4.20)
    shift=35/147*align
    center=135/147-shift
    return (left,right,center,6/147),window(t,3.34,3.57),shift

def lerp(a,b,p):return np.asarray(a)*(1-p)+np.asarray(b)*p
def tr(x=0,y=0,z=0):
    m=np.eye(4,dtype='f4');m[:3,3]=[x,y,z];return m
def sc(x=1,y=None,z=None):
    return np.diag([x,x if y is None else y,x if z is None else z,1]).astype('f4')
def rx(a):
    c,s=np.cos(a),np.sin(a);return np.array([[1,0,0,0],[0,c,-s,0],[0,s,c,0],[0,0,0,1]],dtype='f4')
def ry(a):
    c,s=np.cos(a),np.sin(a);return np.array([[c,0,s,0],[0,1,0,0],[-s,0,c,0],[0,0,0,1]],dtype='f4')
def rz(a):
    c,s=np.cos(a),np.sin(a);return np.array([[c,-s,0,0],[s,c,0,0],[0,0,1,0],[0,0,0,1]],dtype='f4')
def norm(v):return np.asarray(v)/np.linalg.norm(v)
def look(eye,target,up=(0,1,0)):
    f=norm(np.asarray(target)-eye);s=norm(np.cross(f,up));u=np.cross(s,f)
    m=np.eye(4,dtype='f4');m[:3,:3]=[s,u,-f];m[:3,3]=-m[:3,:3]@eye;return m
def perspective(fov,aspect,near=.08,far=100):
    f=1/math.tan(fov*math.pi/360)
    return np.array([[f/aspect,0,0,0],[0,f,0,0],[0,0,(far+near)/(near-far),2*far*near/(near-far)],[0,0,-1,0]],dtype='f4')
def ortho(s=15):
    return np.array([[1/s,0,0,0],[0,1/s,0,0],[0,0,-2/50,-1],[0,0,0,1]],dtype='f4')

VS='''#version 330
in vec3 in_pos;in vec3 in_normal;in vec2 in_uv;
uniform mat4 model;uniform mat4 vp;uniform mat4 lightvp;
out vec3 pos;out vec3 normal;out vec2 uv;out vec4 lightpos;
void main(){vec4 p=model*vec4(in_pos,1);pos=p.xyz;normal=normalize(mat3(transpose(inverse(model)))*in_normal);uv=in_uv;lightpos=lightvp*p;gl_Position=vp*p;}
'''
FS='''#version 330
in vec3 pos;in vec3 normal;in vec2 uv;in vec4 lightpos;
uniform vec3 color;uniform vec3 eye;uniform float opacity;uniform float metallic;
uniform sampler2D image;uniform sampler2D shadow;uniform sampler2D normalmap;uniform sampler2D roughmap;uniform sampler2D alternate;uniform vec4 rect;
uniform float waveRadius;uniform vec2 waveOrigin;
uniform vec4 selectionBar;uniform float selectionMix;uniform float selectionShift;
uniform int mode;uniform float lightTheme;uniform float roundness;uniform vec2 aspect;
out vec4 frag;
float visibility(vec3 n,vec3 l){
 vec3 p=lightpos.xyz/lightpos.w*.5+.5;
 if(p.x<0||p.x>1||p.y<0||p.y>1)return 1.;
 float b=max(.0018*(1-dot(n,l)),.0005),v=0;
 for(int i=0;i<64;i++){float a=float(i)*2.399963;float r=sqrt((float(i)+.5)/64.);
  v+=p.z-b<=texture(shadow,p.xy+vec2(cos(a),sin(a))*r*14./2048.).r?1.:0.;}
 return v/64.;
}
void main(){
 vec2 q=(abs(uv-.5)-.5)*aspect+roundness;
 if(length(max(q,0.))+min(max(q.x,q.y),0.)>roundness)discard;
 vec2 tuv=rect.xy+vec2(uv.x,1.-uv.y)*rect.zw;
 vec4 tex=texture(image,mode==2?uv:tuv);
 if(mode==5){
   vec2 newuv=vec2(tuv.x,clamp(tuv.y+selectionShift,0.,1.));
   vec3 oldc=tex.rgb,newc=texture(alternate,newuv).rgb;
   // Remove both captured underlines. Labels keep their captured anti-aliasing.
   if(tuv.y>.60)oldc=texture(image,vec2(tuv.x,.99)).rgb;
   if(newuv.y>.77)newc=texture(alternate,vec2(tuv.x,.99)).rgb;
   vec3 c=mix(oldc,newc,selectionMix);
   float ax=fwidth(tuv.x),ay=fwidth(tuv.y);
   float bar=smoothstep(selectionBar.x-ax,selectionBar.x+ax,tuv.x)
      *(1.-smoothstep(selectionBar.y-ax,selectionBar.y+ax,tuv.x))
      *(1.-smoothstep(selectionBar.w*.5-ay,selectionBar.w*.5+ay,abs(tuv.y-selectionBar.z)));
   c=mix(c,vec3(.384,.549,.208),bar);
   frag=vec4(c,opacity);return;
 }
 if(mode==4){
   float dist=length((tuv-waveOrigin)*vec2(1.6,1.));
   float changed=1.-smoothstep(waveRadius-.025,waveRadius+.025,dist);
   vec3 c=mix(tex.rgb,texture(alternate,tuv).rgb,changed);
   float band=exp(-pow((dist-waveRadius)/.026,2.));
   c=mix(c,vec3(.59,.77,.32),band*.50);
   frag=vec4(c*color,opacity);return;
 }
 if(mode==1){if(tex.a<.015)discard;frag=vec4(tex.rgb,tex.a*opacity);return;}
 vec3 n=normalize(normal),v=normalize(eye-pos),l=normalize(vec3(-5,12,9)-pos),l2=normalize(vec3(8,7,-7)-pos);
 vec3 base=color;float rough=.28,met=metallic;
 if(mode==2){
   vec3 dp1=dFdx(pos),dp2=dFdy(pos);vec2 du1=dFdx(uv),du2=dFdy(uv);
   vec3 tangent=normalize(dp1*du2.y-dp2*du1.y);
   vec3 bitangent=normalize(-dp1*du2.x+dp2*du1.x);
   vec3 sampled=texture(normalmap,uv).xyz*2.-1.;sampled.xy*=.65;
   n=normalize(mat3(tangent,bitangent,n)*sampled);
   base=tex.rgb*color;float gray=dot(base,vec3(.2126,.7152,.0722));base=mix(base,vec3(gray),.62);vec3 mr=texture(roughmap,uv).rgb;rough=clamp(mr.g,.18,.85);met=mr.b;
 }
 float sh=visibility(n,l),diff=max(dot(n,l),0.),rim=max(dot(n,l2),0.);
 vec3 h=normalize(l+v),h2=normalize(l2+v);
 float sp=pow(max(dot(n,h),0.),mix(180.,18.,rough));
 float sp2=pow(max(dot(n,h2),0.),90.);
 float fres=pow(1.-max(dot(n,v),0.),4.);
 vec3 ambient=mix(vec3(.28,.25,.21),vec3(.48,.45,.40),lightTheme);
 vec3 lit=base*(ambient+diff*sh*.79+rim*.20)+vec3(1,.9,.73)*sp*sh*(.16+met*.45)+vec3(.72,.78,.82)*sp2*.14+fres*vec3(.15,.13,.10)*met;
 // A broad studio softbox reflected in the lacquer.
 vec3 ref=reflect(-v,n);float softbox=pow(max(dot(ref,normalize(vec3(-.4,1,.3))),0.),30.);
 lit+=softbox*vec3(.38,.34,.27)*(.10+met*.38);
 lit=pow(lit,vec3(1./1.1));
 if(pos.y< -4.70)lit=mix(lit,mix(vec3(.045,.039,.032),vec3(.74,.70,.63),lightTheme),smoothstep(8.,29.,length(pos.xz)));
 frag=vec4(lit,opacity);
}
'''
SVS='''#version 330
in vec3 in_pos;uniform mat4 model;uniform mat4 lightvp;
void main(){gl_Position=lightvp*model*vec4(in_pos,1);}
'''
SFS='''#version 330
void main(){}
'''
QVS='''#version 330
in vec2 in_pos;out vec2 uv;void main(){uv=in_pos*.5+.5;gl_Position=vec4(in_pos,0,1);}
'''
BFS='''#version 330
in vec2 uv;uniform float lightTheme;out vec4 frag;
void main(){float glow=exp(-length((uv-vec2(.5,.58))*vec2(1.3,1.))*4.);
 vec3 c=mix(vec3(.045,.039,.032),vec3(.13,.105,.075),glow);
 c=mix(c,mix(vec3(.72,.69,.62),vec3(.90,.87,.81),glow),lightTheme);
 frag=vec4(c,1);}
'''
PFS='''#version 330
in vec2 uv;uniform sampler2D scene;uniform sampler2D depth;
uniform vec2 resolution;uniform float focus;uniform float aperture;uniform float time;out vec4 frag;
float linearDepth(vec2 p){float z=texture(depth,p).r*2.-1.;return 16./(100.08-z*99.92);}
void main(){
 float d=linearDepth(uv);float coc=clamp(abs(d-focus)/max(d,.1)*aperture,0.,7.);
 vec3 c=texture(scene,uv).rgb;float weight=1.;
 for(int i=0;i<16;i++){float a=float(i)*2.399963;float r=sqrt(float(i+1)/16.);vec2 p=uv+vec2(cos(a),sin(a))*r*coc/resolution;
 float pd=linearDepth(p);float w=pd<d-.4?.25:1.;c+=texture(scene,p).rgb*w;weight+=w;}
 c/=weight;
 float vig=1.-.16*pow(length((uv-.5)*vec2(1.1,1.)),1.8);c*=vig;
 float grain=fract(sin(dot(uv*resolution,vec2(12.9898,78.233))+time*.17)*43758.5453)-.5;
 c+=grain*.005;frag=vec4(c,1);
}
'''

class Renderer:
    def __init__(self,w=1920,h=1080):
        self.w,self.h=w,h;self.ctx=moderngl.create_standalone_context(backend='egl')
        c=self.ctx
        self.prog=c.program(vertex_shader=VS,fragment_shader=FS)
        self.shprog=c.program(vertex_shader=SVS,fragment_shader=SFS)
        self.bg=c.program(vertex_shader=QVS,fragment_shader=BFS)
        self.post=c.program(vertex_shader=QVS,fragment_shader=PFS)
        q=c.buffer(np.array([-1,-1,1,-1,-1,1,1,1],dtype='f4').tobytes())
        self.bgquad=c.vertex_array(self.bg,[(q,'2f','in_pos')]);self.postquad=c.vertex_array(self.post,[(q,'2f','in_pos')])
        self.ms=c.framebuffer(c.renderbuffer((w,h),4,samples=4),c.depth_renderbuffer((w,h),samples=4))
        self.color=c.texture((w,h),4);self.depth=c.depth_texture((w,h));self.depth.compare_func=''
        self.scene=c.framebuffer(self.color,self.depth)
        self.out=c.simple_framebuffer((w,h),components=3)
        self.shadow=c.depth_texture((2048,2048));self.shadow.compare_func='';self.sf=c.framebuffer(depth_attachment=self.shadow)
        self.lightvp=ortho(14)@look(np.array([-7.,15.,12.]),np.zeros(3))
        self.meshes={};self.textures={};self.objects=[]
        self.white=self.texture('white',Image.new('RGBA',(2,2),'white'))
        self.prog['image']=0;self.prog['shadow']=1;self.prog['normalmap']=2;self.prog['roughmap']=3;self.prog['alternate']=4;self.post['scene']=0;self.post['depth']=1
        self.prog['lightvp'].write(self.lightvp.T.astype('f4').tobytes());self.shprog['lightvp'].write(self.lightvp.T.astype('f4').tobytes())
        self.mesh('box',self.box());self.mesh('plane',self.plane());self.build_pieces()
        capture=json.loads((ROOT.parent/'source/captures.json').read_text());self.position=capture['position']['squares'];self.continuity=capture['continuity_position']['squares']
        self.load_assets()
        self.live_frames=None

    def mesh(self,name,data):
        data=np.asarray(data,dtype='f4');v=self.ctx.buffer(data.tobytes())
        self.meshes[name]=(self.ctx.vertex_array(self.prog,[(v,'3f 3f 2f','in_pos','in_normal','in_uv')]),self.ctx.vertex_array(self.shprog,[(v,'3f 20x','in_pos')]))
    @staticmethod
    def plane():
        return [[x,y,0,0,0,1,(x+1)/2,(y+1)/2] for x,y in [(-1,-1),(1,-1),(1,1),(-1,-1),(1,1),(-1,1)]]
    @staticmethod
    def box():
        data=[]
        # Small bevels turn the stage lights into an edge highlight.
        points=[]
        for x in [-1,1]:
            for y in [-1,1]:
                for z in [-1,1]:
                    for axis in range(3):
                        p=np.array([x,y,z],dtype=float)*.965;p[axis]=[x,y,z][axis];points.append(p)
        m=trimesh.convex.convex_hull(np.array(points));v=m.vertices
        for face,n in zip(m.faces,m.face_normals):
            for p in v[face]:data.append([*p,*n,0,0])
        return data
    def build_pieces(self):
        # Authored CC BY 4.0 glTF geometry, UVs and PBR materials from A Beautiful Game.
        scene=trimesh.load(ASSETS/'models/ABeautifulGame.glb',force='scene')
        self.chess={};loaded={}
        nodes={'K':'King','Q':'Queen','R':'Castle','N':'Knight','B':'Bishop','P':'Pawn_Body'}
        for col in 'wb':
            for typ,prefix in nodes.items():
                node=prefix+'_'+col.upper()+('' if typ in 'KQ' else '1')
                world,name=scene.graph[node];g=scene.geometry[name]
                base_y=g.bounds[0,1]
                components=[(g,np.eye(4))]
                if typ=='P':
                    top_world,top_name=scene.graph['Pawn_Top_'+col.upper()+'1']
                    components.append((scene.geometry[top_name],np.linalg.inv(world)@top_world))
                result=[]
                for geom,relative in components:
                    key=geom.metadata.get('name',str(id(geom)))
                    if key not in loaded:
                        key='asset-'+str(len(loaded))
                        faces=geom.faces.reshape(-1)
                        data=np.column_stack([geom.vertices[faces],geom.vertex_normals[faces],geom.visual.uv[faces]])
                        self.mesh(key,data)
                        mat=geom.visual.material
                        albedo=mat.baseColorTexture or Image.new('RGBA',(2,2),'white')
                        normal=mat.normalTexture or Image.new('RGB',(2,2),(128,128,255))
                        rough=mat.metallicRoughnessTexture or Image.new('RGB',(2,2),(255,120,0))
                        factor=np.ones(3) if mat.baseColorFactor is None else np.asarray(mat.baseColorFactor[:3])/255
                        material=(self.texture(key+'-base',albedo),self.texture(key+'-normal',normal),self.texture(key+'-rough',rough),factor)
                        loaded[geom.metadata.get('name',str(id(geom)))]=(key,material)
                    key,material=loaded[geom.metadata.get('name',str(id(geom)))]
                    local=rx(np.pi/2)@sc(11.1)@tr(0,-base_y,0)@relative
                    if typ=='N':local=rz(np.pi/2 if col=='w' else -np.pi/2)@local
                    result.append((key,local,material))
                self.chess[col+typ]=result

    def texture(self,name,im):
        im=im.convert('RGBA');t=self.ctx.texture(im.size,4,im.tobytes());t.build_mipmaps();t.filter=(moderngl.LINEAR_MIPMAP_LINEAR,moderngl.LINEAR);t.anisotropy=8
        self.textures[name]=t;return t
    def image(self,name,file,crop=None):
        im=Image.open(file).convert('RGBA');
        if crop:im=im.crop(crop)
        return self.texture(name,im)
    def text(self,name,lines,size=72,color='#eee4d2',width=1600,spacing=20,weight=BOLD):
        font=ImageFont.truetype(weight,size);h=len(lines)*(size+spacing)+40
        im=Image.new('RGBA',(width,h));d=ImageDraw.Draw(im)
        for i,line in enumerate(lines):d.text((width/2,20+i*(size+spacing)),line,font=font,fill=color,anchor='mt')
        return self.texture(name,im)
    def load_assets(self):
        for n in ['live-hq','light','landscape','all','finished','search','blue','green']:
            self.image(n,ASSETS/(n+'.png'))
        self.image('finished-current',ASSETS/'finished-current-hq.png')
        self.image('filter-playing',ASSETS/'live-hq.png',tuple(int(x*2860/1440) for x in [296,231,634,280]))
        im=Image.open(ASSETS/'finished-current-hq.png');k=im.width/1440
        self.texture('filter-finished',im.crop(tuple(int(x*k) for x in [296,231,634,280])))
        self.image('continuity-board',ASSETS/'flip.png',(422,150,867,597))
        self.image('detail',ASSETS/'detail.png',(404,40,884,766))
        self.image('flip',ASSETS/'flip.png',(404,40,884,766))
        self.image('three',ASSETS/'three-hq.png',tuple(int(x*2860/1440) for x in [450,50,990,850]))
        self.image('study',ASSETS/'study-hq.png',tuple(int(x*2860/1440) for x in [480,239,960,661]))
        self.image('appearance',ASSETS/'appearance.png',(932,20,1275,793))
        self.image('boards',ASSETS/'board_menu.png',(932,20,1275,793))
        self.image('pieces',ASSETS/'pieces_menu.png',(932,20,1275,793))
        logo=Image.open(ASSETS/'horse.png').convert('RGBA')
        a=logo.getchannel('A');logo=Image.new('RGBA',logo.size,'#eee4d2');logo.putalpha(a)
        self.texture('horse-logo',logo)
        for typ in 'KQRBNP':
            for col in 'wb':
                for style in ['cburnett','merida','chessnut']:
                    self.image(f'{style}-{col}{typ}',ASSETS/f'pieces/{style}-{col}{typ}.png')
        self.text('live-title',['Every game. Live.'],size=74,width=1400,weight=BLACK)
        self.text('theme-title',['Your board. Your way.'],size=68,width=1400,weight=BLACK)
        self.text('theme-count',['44 boards  ·  53 piece sets'],size=34,width=1200,color='#c5bda9')
        self.text('study-title',['Turn the tournament into a study.'],size=54,width=1600,weight=BOLD)
        self.text('end-title',['Lichess','Tournament Viewer'],size=104,width=1600,spacing=6,weight=BLACK)
        self.text('end-url',['lichess-tournament-viewer.aralani.chatgpt.site'],size=40,width=1700,color='#ddd1bd',weight=FONT)
        self.text('end-sub',['Arena & Swiss  /  Live boards  /  Your themes'],size=30,width=1400,color='#bfb6a5',weight=FONT)

    def add(self,mesh,model,color=CREAM,tex=None,alpha=1,metal=.2,shadow=True,rect=(0,0,1,1),radius=0,aspect=(1,1),material=None,wave=None,selection=None):
        if alpha<.004:return
        self.objects.append((mesh,model,np.asarray(color,dtype='f4'),tex,alpha,metal,shadow,rect,radius,aspect,material,wave,selection))
    def panel(self,model,width,height,tex,alpha=1,frame=True,rect=(0,0,1,1),selection=None):
        if alpha<.005:return
        if frame:
            self.add('box',model@tr(z=-.10)@sc(width/2+.055,height/2+.055,.115),[.11,.105,.095],alpha=alpha,metal=.7)
            self.add('box',model@tr(z=-.20)@sc(width/2-.04,height/2-.04,.055),[.27,.23,.18],alpha=alpha,metal=.8)
        self.add('plane',model@tr(z=.021)@sc(width/2,height/2,1),tex=tex,alpha=alpha,shadow=False,rect=rect,radius=.022,aspect=(width,height),selection=selection)
    def words(self,name,x,y,z,width,alpha=1,rotation=0):
        t=self.textures[name];h=width*t.height/t.width
        self.panel(tr(x,y,z)@ry(rotation),width,h,t,alpha=alpha,frame=False)
    def piece(self,typ,col,model,alpha=1,scale=1):
        for mesh,local,material in self.chess[col+typ]:
            tint=np.array([.97,.95,.90]) if col=='w' else np.array([.85,.88,.83])
            self.add(mesh,model@sc(scale)@local,tint*material[3],alpha=alpha,material=material)

    def outline(self,model,width,height,alpha=1):
        green=[.49,.69,.26];th=.018
        for x in [-width/2,width/2]:self.add('box',model@tr(x,0,.065)@sc(th,height/2+th,.026),green,alpha=alpha,metal=.5)
        for y in [-height/2,height/2]:self.add('box',model@tr(0,y,.065)@sc(width/2,th,.026),green,alpha=alpha,metal=.5)

    def board(self,rig,t,alpha=1,theme='brown',flat=False,style='cburnett',wave=None,pieces=True,scale=1):
        palette={'brown':(CREAM,BROWN),'green':(np.array([.87,.88,.74]),np.array([.43,.55,.34])),'blue':(np.array([.80,.85,.88]),np.array([.33,.46,.57]))}
        light,dark=palette[theme]
        self.add('box',rig@tr(z=-.16)@sc(4.14,4.14,.18),[.16,.10,.055],alpha=alpha,metal=.4)
        self.add('box',rig@tr(z=-.03)@sc(4.05,4.05,.032),[.65,.51,.33],alpha=alpha,metal=.65)
        for row in range(8):
            for col in range(8):
                z=0.;c=light if (col+row)%2==0 else dark
                if wave:
                    previous,new,start=wave;local=window(t,start+(row+col)*.032,start+.24+(row+col)*.032)
                    c=lerp(palette[previous][(row+col)%2],palette[new][(row+col)%2],local)
                    z=.15*np.sin(local*np.pi)
                self.add('box',rig@tr(col-3.5,3.5-row,z)@sc(.493,.493,.043),c,alpha=alpha,metal=.12)
        if pieces:
            for idx,p in enumerate(self.position):
                if not p:continue
                row,col=divmod(idx,8);m=rig@tr(col-3.5,3.5-row,.055)
                if flat:
                    self.add('plane',m@tr(z=.025)@sc(.43,.43,1),tex=self.textures[style+'-'+p],alpha=alpha,shadow=False)
                else:self.piece(p[1],p[0],m,alpha,scale)

    def live_rect(self,col,row):
        return ((302+282*col)/1440,(281+436*row)/900,262/1440,416/900)
    def camera(self,t):
        # Position and aim are interpolated together to keep a stable point of attention.
        keys=[
          (0,[1.5,1.0,5.9],[-1.5,-.67,1.5],39),
          (.55,[2.5,2.5,7.5],[-1.2,-.8,1.1],42),
          (1.55,[5.6,6.1,12.2],[0,-.4,0],43),
          (2.30,[1.0,.5,16.6],[0,0,0],43),
          (3.75,[.0,.0,15.4],[0,0,0],43),
          (4.40,[.2,.4,15.4],[-1.3,-.2,0],43),
          (5.00,[1.2,.2,13.2],[0,0,1.2],42),
          (6.05,[.0,.6,13.0],[0,0,1.3],42),
          (7.05,[.0,.6,13.0],[0,0,1.3],42),
          (7.85,[2.7,3.1,13.3],[0,.1,.3],43),
          (8.55,[-3.4,4.4,13.2],[0,.1,0],44),
          (9.45,[-5.0,4.0,12.8],[0,.1,0],44),
          (10.35,[-2.8,1.5,14.7],[0,0,0],43),
          (11.05,[1.4,.4,13.4],[0,0,1.0],43),
          (12.25,[.0,.0,12.7],[0,0,1.0],43),
          (13.10,[.0,.6,15.4],[0,.15,0],43),
          (14.10,[.0,.2,15.1],[0,.1,0],43),
          (15,[.0,.2,15.1],[0,.1,0],43)]
        keys=[(round(a/(BEAT/4))*(BEAT/4),e,t,f) for a,e,t,f in keys]
        for i in range(len(keys)-1):
            a,b=keys[i],keys[i+1]
            if a[0]<=t<=b[0]:
                p=window(t,a[0],b[0]);return lerp(a[1],b[1],p),lerp(a[2],b[2],p),float(lerp(a[3],b[3],p))
        return np.array(keys[-1][1]),np.array(keys[-1][2]),43

    def make_scene(self,t):
        self.objects=[];light=float(window(t,6.40,6.78)*(1-window(t,7.32,7.65)))
        self.light=light
        # A quiet studio floor gives every suspended object a shared space.
        self.add('box',tr(0,-4.8,-3)@sc(35,.03,35),lerp([.075,.061,.047],[.73,.69,.62],light),metal=.28)
        live=self.textures['live-hq']
        if self.live_frames is not None and t<4.3:
            idx=min(int((t+2)*30),len(self.live_frames)-1);live.write(self.live_frames[idx].tobytes());live.build_mipmaps()
        # 1. Start inside the game, pull back, and turn the board into a screen.
        if t<2.35:
            p=window(t,1.17,2.11)
            rig=tr(0,lerp(-1.55,0,p),0)@ry(.06*(1-p))@rx(-np.pi/2*(1-p))
            sx=lerp(1,14.6/8,p);sy=lerp(1,9.18/8,p)
            r=rig@sc(sx,sy,1)
            self.add('box',r@tr(z=-.14)@sc(4.04,4.04,.13),[.10,.085,.066],metal=.6)
            for row in range(8):
                for col in range(8):
                    start=1.53+(row+col)*.025
                    local=float(smooth((t-start)/.40))
                    m=r@tr(col-3.5,3.5-row,.03+.18*np.sin(local*np.pi))@ry(np.pi*local)
                    if local<.5:
                        color=CREAM if (row+col)%2==0 else BROWN
                        if (row,col) in [(5,2),(3,3)]:
                            pulse=window(t,.12,.47)*(1-window(t,.94,1.29))*.24
                            color=lerp(color,[.65,.69,.36],pulse)
                        self.add('box',m@sc(.497,.497,.035),color,metal=.12)
                    else:
                        self.panel(m@ry(np.pi),.996,.996,live,frame=False,rect=(col/8,row/8,1/8,1/8))
            collapse=window(t,1.06,1.53)
            if collapse<1:
                for i,piece in enumerate(self.position):
                    if not piece:continue
                    row,col=divmod(i,8)
                    x,y,z=col-3.5,3.5-row,.055
                    if i==42:
                        jump=window(t,.117,.938)
                        y+=2*window(t,.117,.586);x+=window(t,.352,.938)
                        z+=.95*np.sin(np.pi*jump)
                    self.piece(piece[1],piece[0],rig@tr(x,y,z)@sc(1,1,max(.01,1-collapse)),scale=1)
        # 2. Lift only the control. A radial selection wave updates the fixed site.
        if 2.34<t<4.80:
            fade=1-window(t,4.22,4.65)
            wave=window(t,7.75*BEAT,8.75*BEAT)
            lift=window(t,3.00,3.28)*(1-window(t,3.90,4.20))
            m=tr(0,0,0)
            self.add('box',m@tr(z=-.10)@sc(7.355,4.645,.115),[.11,.105,.095],alpha=fade,metal=.5)
            self.add('plane',m@tr(z=.021)@sc(7.3,4.59,1),color=np.ones(3)*(1-.22*lift*(1-wave)),tex=live,alpha=fade,shadow=False,
                     aspect=(14.6,9.18),wave=(self.textures['finished-current'],wave*1.45-.045,(.444,.26)))
            if lift>0:
                control=tr(-2.60,1.98,1.65*lift)@rx(-.10*lift)@ry(.025*lift)
                width=lerp(3.43,5.70,lift);height=width*49/338
                bar,mix,shift=selection_state(t)
                self.panel(control,width,height,self.textures['filter-playing'],fade,
                           selection=(self.textures['filter-finished'],bar,mix,shift))
                self.outline(control,width+.08,height+.08,fade*lift)
        # 3. Search isolates one live game. The card carries a physical flip.
        if 4.0<t<6.80:
            p=window(t,4.03,4.57);out=window(t,6.26,6.73)
            a=p*(1-out);search_alpha=(1-window(t,4.69,5.04))*a
            self.panel(tr(0,0,.9)@ry(-.06),14.5,9.13,self.textures['search'],search_alpha)
            detail_alpha=window(t,4.46,4.64)*(1-out)
            enlarge=window(t,4.45,5.05)
            flip=window(t,5.36,5.98)
            m=tr(lerp(-2.9,0,enlarge),lerp(-1.03,-.05,enlarge),lerp(1.05,1.5,enlarge))@ry(np.pi*flip)@rz(.015*np.sin(flip*np.pi))
            tex=self.textures['detail'] if flip<.5 else self.textures['flip']
            if flip>=.5:m=m@ry(np.pi)
            self.panel(m,float(lerp(2.35,4.78,enlarge)),float(lerp(3.74,7.23,enlarge)),tex,detail_alpha)
            # The other games recede rather than competing with the enlarged one.
            if t<6.08:
                for side in [-1,1]:
                    self.panel(tr(side*5.8,-.2,-1.4)@ry(-side*.27),3.0,4.76,live,detail_alpha*.22,rect=self.live_rect(0 if side==-1 else 2,0))
        # 4. Extract the exact flipped board on the same viewing ray and chess position.
        if 6.04<t<10.82:
            pop=window(t,6.09,6.56);flipout=window(t,9.83,10.55)
            rise=window(t,8.84,9.42);grow=window(t,7.02,7.60)
            eye,_,_=self.camera(6.05);anchor=np.array([.005,.243,1.521])
            ray=norm(eye-anchor);distance=np.linalg.norm(eye-anchor)
            travel=.80*pop+.10*np.sin(pop*np.pi)
            center=anchor+ray*travel
            size=(4.44/8)*(distance-travel)/distance
            size=lerp(size,.88,grow)
            center=lerp(center,[0,.18,.25],grow)
            sx=lerp(size,4.88/8,flipout);sy=lerp(size,7.23/8,flipout)
            rig=tr(*lerp(center,[0,.05,.9],flipout))@ry(np.pi*flipout)@rx(lerp(-.20*pop,-1.13,rise)*(1-flipout))@sc(sx,sy,1)
            theme='brown';wave=None
            if t>7.17:theme='green';wave=('brown','green',7.17)
            if t>8.05:theme='blue';wave=('green','blue',8.05)
            if t>9.1:theme='brown';wave=('blue','brown',9.1)
            if flipout<.5:
                self.board(rig,t,theme=theme,wave=wave,pieces=False)
                vector=window(t,6.86,6.98)
                self.add('plane',rig@tr(z=.058)@sc(4,4,1),tex=self.textures['continuity-board'],alpha=1-vector,shadow=False)
                # Preserve the two last-move squares when vector pieces take over.
                for idx in [31,37]:
                    row,col=divmod(idx,8)
                    self.add('plane',rig@tr(col-3.5,3.5-row,.065)@sc(.493,.493,1),[.69,.73,.32],alpha=vector*.43,shadow=False)
                style='cburnett' if t<7.67 else ('merida' if t<8.35 else 'chessnut')
                for i,piece in enumerate(self.continuity):
                    if not piece:continue
                    row,col=divmod(i,8);m=rig@tr(col-3.5,3.5-row,.085)
                    if rise<1:self.add('plane',m@sc(.43,.43,1),tex=self.textures[style+'-'+piece],alpha=vector*(1-rise),shadow=False)
                    if rise>0:self.piece(piece[1],piece[0],m,rise,max(.01,rise*(1-flipout)))
            if flipout>=.5:
                screenrig=tr(0,.05,flipout*.9)@ry(np.pi*flipout)@rx(lerp(-.20,-1.13,rise)*(1-flipout))@ry(np.pi)
                self.panel(screenrig,4.88,7.23,self.textures['three'])
            # The two fixed side anchors turn and pop to exchange their content.
            swap=window(t,6.09,6.56)
            menu='appearance' if t<7.35 else ('boards' if t<8.4 else 'pieces')
            backdrop='light' if t<7.35 else ('landscape' if t<8.12 else 'blue')
            decoration=1-window(t,9.9,10.3)
            for side in [-1,1]:
                theta=np.pi*swap;front=swap<.5
                depth=-1.4+1.0*np.sin(swap*np.pi)
                bounce=1+.12*np.sin(swap*np.pi)
                m=tr(side*5.8,-.2,depth)@ry(-side*.27+side*theta)
                if not front:m=m@ry(-side*np.pi)
                tex=live if front else self.textures[menu if side==-1 else backdrop]
                width=lerp(3.0,2.74 if side==-1 else 5.1,swap)*bounce
                height=lerp(4.76,6.18 if side==-1 else 3.20,swap)*bounce
                rect=self.live_rect(2 if side==-1 else 0,0) if front else (0,0,1,1)
                self.panel(m,width,height,tex,decoration*(.22 if front else .58),rect=rect)
            self.words('theme-count',0,-3.58,2.4,7.0,window(t,7.2,7.4)*(1-window(t,9.5,9.8)))
        # 5. Show the site's real 3D game, then turn games into study chapters.
        if 10.56<t<13.05:
            p=1;q=window(t,10.68,11.10);end=window(t,12.38,13.00)
            remaining=1-window(t,11.18,11.64)
            self.panel(tr(-q*5.4,.0,.9)@ry(q*.65),4.88,7.23,self.textures['three'],p*(1-end)*remaining)
            for i in range(6):
                u=window(t,10.71+i*.045,11.29+i*.045)
                x=lerp(5.5+i*.22,0,u);y=lerp((i-2.5)*.33,0,u);z=lerp(-1.8-i*.15,.9-i*.14,u)
                self.panel(tr(x,y,z)@ry((1-u)*(-.65+i*.13)),4.82,7.18,live,p*(1-end)*remaining,rect=self.live_rect(i%3,0))
            study=window(t,11.05,11.48)*(1-end)
            if study>0:
                self.panel(tr(0,.1,2.0)@ry(np.pi/2*(1-study)),6.52,5.73,self.textures['study'],1-end)
        # 6. An uncluttered, held final title. No corner furniture.
        if t>12.35:
            p=window(t,12.35,13.22)
            for i in range(9):
                col=i%3;row=i//3
                m=tr((col-1)*5.9,-4.2-(row*.20),-2.2-row*2.3)@rx(-1.17)@rz((col-1)*.06)
                self.panel(m,3.0,4.76,live,p*.10,rect=self.live_rect(col,0))
            self.panel(tr(0,2.60,1.3),1.03,1.03,self.textures['horse-logo'],p,frame=False)
            self.words('end-title',0,.43,1.5,11.8,p)
            self.words('end-url',0,-1.83,1.5,13.5,window(t,13.36,13.72))
        return light

    def draw(self,o,shadow=False):
        mesh,m,color,tex,a,metal,casts,rect,radius,aspect,material,wave,selection=o
        if shadow:
            if not casts or a<.6:return
            self.shprog['model'].write(m.T.astype('f4').tobytes());self.meshes[mesh][1].render();return
        p=self.prog;p['model'].write(m.T.astype('f4').tobytes());p['color'].value=tuple(color);p['opacity']=float(a);p['metallic']=float(metal)
        p['mode']=5 if selection else (4 if wave else (2 if material else (1 if tex is not None else 0)));p['rect'].value=rect;p['roundness']=radius;p['aspect'].value=aspect
        if material:
            material[0].use(0);material[1].use(2);material[2].use(3)
        else:(tex or self.white).use(0)
        if wave:
            wave[0].use(4);p['waveRadius']=float(wave[1]);p['waveOrigin'].value=wave[2]
        if selection:
            selection[0].use(4);p['selectionBar'].value=selection[1];p['selectionMix']=selection[2];p['selectionShift']=selection[3]
        self.meshes[mesh][0].render()
    def frame(self,t):
        light=self.make_scene(t);c=self.ctx
        eye,target,fov=self.camera(t);view=look(eye,target);vp=perspective(fov,self.w/self.h)@view
        c.enable(moderngl.DEPTH_TEST);c.disable(moderngl.BLEND);c.disable(moderngl.CULL_FACE)
        self.sf.use();self.sf.clear(depth=1);c.viewport=(0,0,2048,2048)
        for o in self.objects:self.draw(o,True)
        self.ms.use();self.ms.clear(0,0,0,1,depth=1);c.viewport=(0,0,self.w,self.h)
        c.disable(moderngl.DEPTH_TEST);self.bg['lightTheme']=light;self.bgquad.render(moderngl.TRIANGLE_STRIP);c.enable(moderngl.DEPTH_TEST)
        p=self.prog;p['vp'].write(vp.T.astype('f4').tobytes());p['eye'].value=tuple(eye);p['lightTheme']=light
        self.shadow.use(1);c.enable(moderngl.BLEND);c.blend_func=(moderngl.SRC_ALPHA,moderngl.ONE_MINUS_SRC_ALPHA)
        # Opaque first, then translucent objects back-to-front.
        opaque=[o for o in self.objects if o[4]>=.995]
        transparent=[o for o in self.objects if o[4]<.995]
        transparent.sort(key=lambda o:np.linalg.norm(o[1][:3,3]-eye),reverse=True)
        for o in opaque+transparent:self.draw(o)
        c.copy_framebuffer(self.scene,self.ms)
        self.out.use();c.disable(moderngl.DEPTH_TEST);c.disable(moderngl.BLEND)
        self.color.use(0);self.depth.use(1)
        self.post['resolution'].value=(self.w,self.h);self.post['focus']=float(np.linalg.norm(eye-target));self.post['aperture']=11.0 if t<1.15 else 2.3;self.post['time']=t
        self.postquad.render(moderngl.TRIANGLE_STRIP)
        return self.out.read(components=3,alignment=1)

    def load_live(self):
        t=self.textures['live-hq'];w,h=t.size
        p=subprocess.run(['ffmpeg','-v','error','-ss','3','-i',str(ASSETS/'live-source.mp4'),'-t','7','-vf',f'fps=30,scale={w}:{h}','-f','rawvideo','-pix_fmt','rgba','-'],capture_output=True,check=True)
        self.live_frames=np.frombuffer(p.stdout,np.uint8).reshape((-1,h,w,4))

def main():
    ROOT.mkdir(exist_ok=True)
    (ROOT/'stills').mkdir(exist_ok=True)
    ap=argparse.ArgumentParser();ap.add_argument('--stills',action='store_true');ap.add_argument('--draft',action='store_true');ap.add_argument('--render',action='store_true');ap.add_argument('--time',type=float);args=ap.parse_args()
    w,h=(960,540) if args.draft else (1920,1080);r=Renderer(w,h)
    if args.stills or args.time is not None:
        times=[0,.6,1.3,1.8,2.5,3.5,4.4,5.15,5.65,6.7,7.5,8.4,9.4,10.4,11.7,13.8] if args.time is None else [args.time]
        for t in times:
            a=Image.frombytes('RGB',(w,h),r.frame(t)).transpose(Image.Transpose.FLIP_TOP_BOTTOM);a.save(ROOT/f'stills/{t:05.2f}.jpg',quality=95)
        if args.stills:
            sheet=Image.new('RGB',(1920,4*310),'#181510');d=ImageDraw.Draw(sheet)
            for i,t in enumerate(times):
                a=Image.open(ROOT/f'stills/{t:05.2f}.jpg');a.thumbnail((480,270));x=i%4*480;y=i//4*310;sheet.paste(a,(x,y));d.text((x+12,y+278),f'{t:.2f}s',fill='#d9c9ad',font=ImageFont.truetype(FONT,18))
            sheet.save(ROOT/'storyboard.jpg',quality=95)
    if args.draft or args.render:
        r.load_live();fps=30 if args.draft else FPS;out=ROOT/('draft.mp4' if args.draft else 'rebuilt.mp4')
        command=['ffmpeg','-v','error','-y','-f','rawvideo','-pixel_format','rgb24','-video_size',f'{w}x{h}','-framerate',str(fps),'-i','-','-i',str(ROOT/'soundtrack.wav'),'-vf','vflip','-c:v','libx264','-preset','fast','-crf','18' if args.render else '22','-pix_fmt','yuv420p','-c:a','aac','-b:a','256k','-ar','48000','-t','15','-movflags','+faststart',str(out)]
        p=subprocess.Popen(command,stdin=subprocess.PIPE);start=time.time()
        for i in range(15*fps):
            p.stdin.write(r.frame(i/fps))
            if i%(fps*2)==0:print(f'{i}/{fps*15} frames, {time.time()-start:.1f}s',flush=True)
        p.stdin.close();p.wait()
        if p.returncode:raise RuntimeError('ffmpeg failed')
        print(out,flush=True)

if __name__=='__main__':main()
