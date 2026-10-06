"""Prepare an instrumental pop excerpt and frame-synced interface sounds."""
from pathlib import Path
import subprocess, urllib.request
import numpy as np
from scipy.signal import butter, sosfilt
from scipy.io.wavfile import write
root=Path(__file__).resolve().parents[1]/'rebuild'
root.mkdir(exist_ok=True)
source=root/'music-options/1000.mp3'
source.parent.mkdir(exist_ok=True)
if not source.exists():
    urllib.request.urlretrieve('https://assets.mixkit.co/music/1000/1000.mp3',source)
sr=48000;beat=60/128
# The source groove is 125 BPM. Pitch-preserving retiming gives 32 beats in 15s.
subprocess.run(['ffmpeg','-v','error','-y','-ss','7.70','-i',str(source),'-t','15.36',
    '-af','atempo=1.024,atrim=duration=15,afade=t=in:d=0.012,afade=t=out:st=14.70:d=0.30',
    '-ar',str(sr),'-ac','2','-f','f32le',str(root/'pop-excerpt.f32')],check=True)
a=np.fromfile(root/'pop-excerpt.f32',dtype='f4').reshape(-1,2)
a=np.pad(a,((0,max(0,sr*15-len(a))),(0,0)))[:sr*15]
rng=np.random.default_rng(71)
for timing,gain,pan in [(3.28,.12,-.25),(3.43,.16,-.15),(6.09,.10,0),(6.33,.17,0),(7.17,.06,-.3),(8.05,.06,.3)]:
    timing=round(timing/(beat/4))*(beat/4)
    n=int(.115*sr);t=np.arange(n)/sr
    # A short falling wooden click with air, rather than another repeating music loop.
    phase=2*np.pi*(620*t-1850*t*t)
    tone=np.sin(phase)*np.exp(-t*57)
    noise=sosfilt(butter(2,[600,2600],btype='bandpass',fs=sr,output='sos'),rng.normal(0,1,n))*np.exp(-t*110)
    pop=(tone*.8+noise*.3)*gain
    j=round(timing*sr);a[j:j+n,0]+=pop*(1-pan);a[j:j+n,1]+=pop*(1+pan)
write(root/'pop-mix.wav',sr,a)
subprocess.run(['ffmpeg','-v','error','-y','-i',str(root/'pop-mix.wav'),
 '-af','loudnorm=I=-14:TP=-1.5:LRA=8','-ar',str(sr),'-ac','2',str(root/'soundtrack.wav')],check=True)
(root/'pop-excerpt.f32').unlink();(root/'pop-mix.wav').unlink()
print('Prepared I Can Hear Your Heartbeat by Michael Ramir C., Mixkit Stock Music Free License. 32 beats at 128 BPM.')
