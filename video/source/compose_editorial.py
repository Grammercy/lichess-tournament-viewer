"""A fresh melodic pop phrase, retimed to the renderer's 128 BPM grid."""
from pathlib import Path
import json, subprocess, urllib.request
import numpy as np
from scipy.signal import butter, sosfilt
from scipy.io.wavfile import write

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'editorial'
OUT.mkdir(exist_ok=True)
SOURCE=ROOT/'rebuild/music-options/1000.mp3'
SOURCE.parent.mkdir(parents=True,exist_ok=True)
if not SOURCE.exists():
    urllib.request.urlretrieve('https://assets.mixkit.co/music/1000/1000.mp3',SOURCE)

sr=48000;beat=60/128;source_start=23.174688
# A later phrase supplies melodic development rather than repeating the old opening.
# The source is 125 BPM. Preserve pitch and fit 32 beats into exactly 15 seconds.
# Measured bass attacks were 112 ms behind the frame grid at a 23.06s seek.
# Advance the source by 112ms × atempo so the film and groove share a phase.
subprocess.run(['ffmpeg','-v','error','-y','-ss',str(source_start),'-i',str(SOURCE),'-t','15.36',
    '-af','atempo=1.024,atrim=duration=15,afade=t=in:d=0.012,afade=t=out:st=14.74:d=0.26',
    '-ar',str(sr),'-ac','2','-f','f32le',str(OUT/'excerpt.f32')],check=True)
a=np.fromfile(OUT/'excerpt.f32',dtype='f4').reshape(-1,2)
a=np.pad(a,((0,max(0,sr*15-len(a))),(0,0)))[:sr*15]
rng=np.random.default_rng(901)
events=[(1*beat,.05,.1),(7.25*beat,.055,-.3),(13*beat,.07,.1),
        (15*beat,.035,-.3),(17*beat,.035,.3),(20*beat,.035,0),(28*beat,.045,.1)]
for when,gain,pan in events:
    n=int(.10*sr);t=np.arange(n)/sr
    phase=2*np.pi*(420*t-1280*t*t)
    tone=np.sin(phase)*np.exp(-t*65)
    noise=sosfilt(butter(2,[700,2800],btype='bandpass',fs=sr,output='sos'),rng.normal(0,1,n))*np.exp(-t*120)
    sound=(tone*.8+noise*.18)*gain
    j=round(when*sr);a[j:j+n,0]+=sound*(1-pan);a[j:j+n,1]+=sound*(1+pan)
write(OUT/'mix.wav',sr,a)
subprocess.run(['ffmpeg','-v','error','-y','-i',str(OUT/'mix.wav'),
    '-af','loudnorm=I=-14:TP=-1.5:LRA=8','-ar',str(sr),'-ac','2',str(OUT/'soundtrack.wav')],check=True)
for filename in ['excerpt.f32','mix.wav']:(OUT/filename).unlink()
(OUT/'music-credit.json').write_text(json.dumps({
    'title':'I Can Hear Your Heartbeat','artist':'Michael Ramir C.',
    'source':'https://mixkit.co/free-stock-music/pop/',
    'download':'https://assets.mixkit.co/music/1000/1000.mp3',
    'license':'Mixkit Stock Music Free License',
    'license_url':'https://mixkit.co/license/#musicFree',
    'source_start_seconds':source_start,'source_bpm':125,'film_bpm':128,
    'measured_phase_correction_seconds':.112,
    'atempo':1.024,'beats':32,'duration_seconds':15,
    'original_interface_sound_events_seconds':[round(x[0],6) for x in events],
    'distribution':'Music is included only in the finished film. Source archive contains a download recipe, no standalone music.'
},indent=2)+'\n')
print('Prepared a fresh 15-second instrumental pop phrase at 128 BPM.')
