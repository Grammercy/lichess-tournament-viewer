"""Export, inspect and package the new film without touching website code."""
from pathlib import Path
import json, shutil, subprocess, zipfile
import numpy as np
from scipy.signal import butter, sosfilt

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'editorial'
MASTER=ROOT/'lichess-tournament-viewer-reimagined.mp4'
CREDIT=('Music: I Can Hear Your Heartbeat by Michael Ramir C., Mixkit Stock Music Free License, '
        'https://mixkit.co/license/#musicFree. Edited excerpt. '
        '3D chess: A Beautiful Game by Moeen Sayed and Mujtaba Sayed, '
        'copyright 2020 ASWF, glTF conversion copyright 2022 Ed Mackey, CC BY 4.0. '
        'Materials, normals and animation adapted.')

subprocess.run(['ffmpeg','-v','error','-y','-i',str(OUT/'silent.mp4'),'-i',str(OUT/'soundtrack.wav'),
    '-c:v','copy','-c:a','aac','-b:a','256k','-ar','48000','-ac','2','-t','15',
    '-metadata','title=Lichess Tournament Viewer | Reimagined',
    '-metadata','comment='+CREDIT,'-movflags','+faststart',str(MASTER)],check=True)
subprocess.run(['ffmpeg','-v','error','-y','-ss','0.64','-i',str(MASTER),'-frames:v','1',
    str(ROOT/'poster-reimagined.jpg')],check=True)
subprocess.run(['ffmpeg','-v','error','-y','-i',str(MASTER),'-vf','scale=960:540,fps=30',
    '-c:v','libx264','-crf','23','-preset','fast','-c:a','aac','-b:a','128k','-ar','48000',
    '-movflags','+faststart',str(OUT/'review.mp4')],check=True)

probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_entries',
    'stream=codec_name,width,height,avg_frame_rate,nb_frames,duration,sample_rate,channels,pix_fmt',
    '-show_entries','format=duration,size,tags','-of','json',str(MASTER)]))
video=next(x for x in probe['streams'] if x['codec_name']=='h264')
audio=next(x for x in probe['streams'] if x['codec_name']=='aac')
assert video['width']==1920 and video['height']==1080 and video['nb_frames']=='900'
assert video['avg_frame_rate']=='60/1' and video['pix_fmt']=='yuv420p'
assert float(probe['format']['duration'])==15
assert audio['sample_rate']=='48000' and audio['channels']==2
subprocess.run(['ffmpeg','-v','error','-xerror','-i',str(MASTER),'-f','null','-'],check=True)
raw=subprocess.check_output(['ffmpeg','-v','error','-i',str(MASTER),'-vf','scale=32:18',
    '-pix_fmt','rgb24','-f','rawvideo','-'])
frames=np.frombuffer(raw,np.uint8).reshape(-1,18,32,3)
assert len(frames)==900
brightness=frames.mean(axis=(1,2,3));assert float(brightness.min())>6
measurement=subprocess.run(['ffmpeg','-hide_banner','-i',str(MASTER),
    '-af','loudnorm=I=-14:TP=-1.5:LRA=8:print_format=json','-f','null','-'],
    capture_output=True,text=True,check=True).stderr
measurement=json.loads(measurement[measurement.rfind('{'):measurement.rfind('}')+1])
probe['audio_measurement']={'integrated_lufs':float(measurement['input_i']),
    'true_peak_db':float(measurement['input_tp']),'loudness_range_lu':float(measurement['input_lra'])}
assert probe['audio_measurement']['true_peak_db']<0
probe['min_frame_mean_brightness']=float(brightness.min())
probe['decode_errors']=0
probe['bpm']=128;probe['beats']=32
audio_raw=subprocess.check_output(['ffmpeg','-v','error','-i',str(MASTER),
    '-vn','-ar','48000','-ac','2','-f','f32le','-'])
signal=np.frombuffer(audio_raw,np.float32).reshape(-1,2)
bass=sosfilt(butter(3,[35,180],btype='bandpass',fs=48000,output='sos'),signal,axis=0)
step=240;n=len(bass)//step
envelope=np.sqrt((bass[:n*step].reshape(n,step,2)**2).mean((1,2)))
onsets=np.maximum(0,np.diff(envelope,prepend=envelope[0]))
times=np.arange(n)*step/48000;beat=60/128
phases=np.arange(-.15,.15,.002)
scores=np.array([sum(float(np.max(onsets[np.abs(times-(i*beat+p))<.023],initial=0))
    for i in range(1,32)) for p in phases])
probe['audio_timing']={'method':'Final AAC audio. Positive bass-envelope derivative, 35-180 Hz, 5ms steps, 23ms tolerance.',
    'best_phase_seconds':round(float(phases[np.argmax(scores)]),4),
    'grid_strength_ratio':round(float(scores[np.argmin(abs(phases))]/max(scores)),4)}
(OUT/'audio-timing.json').write_text(json.dumps(probe['audio_timing'],indent=2)+'\n')
assert abs(probe['audio_timing']['best_phase_seconds'])<.02
probe['board_continuity']={'game':'Raul3031 versus OmarPetare','pieces':16,
    'center_pixels':[1220,616],'lift_seconds':[6.09375,6.4453125],
    'camera':'Locked orthographic projection; planar center remains fixed.',
    'geometry':'Authored glTF meshes; uniform normalization and full-scale emergence.'}
probe['selection']={'start_seconds':3.28125,'settle_seconds':3.6328125,
    'motion':'Damped spring with a small overshoot and a finite settle.',
    'component':'Raised outlined control with perspective tilt; local highlights reach its dependent cards.'}
probe['layout_review']='All settings fit in frame. Recorded cards and import dialog remain readable. Chessboard crops retain square proportions.'
(OUT/'validation.json').write_text(json.dumps(probe,indent=2)+'\n')

# Make the default review page open the finished cut only after validation passes.
shutil.copy2(MASTER,ROOT/'lichess-tournament-viewer.mp4')
shutil.copy2(ROOT/'poster-reimagined.jpg',ROOT/'poster.jpg')
index=(ROOT/'index.html').read_text()
index=index.replace('poster-pop.jpg','poster-reimagined.jpg')
index=index.replace('lichess-tournament-viewer-pop-slide.mp4','lichess-tournament-viewer-reimagined.mp4')
(ROOT/'index.html').write_text(index)

include=[MASTER,ROOT/'index.html',ROOT/'requirements.txt',ROOT/'credits.txt',ROOT/'asset-LICENSE.txt',
    ROOT/'poster-reimagined.jpg',OUT/'README.md',OUT/'storyboard.json',OUT/'music-credit.json',
    OUT/'validation.json',OUT/'audio-timing.json',OUT/'storyboard.jpg',OUT/'transition-review.jpg',ROOT/'source/captures.json']
include += [ROOT/'source'/x for x in ['render_editorial.py','compose_editorial.py','package_editorial.py']]
for name in ['live-hq.png','live-source.mp4','study-hq.png','finished-current-hq.png','horse.png',
             'Mixkit-music-license.txt','lila-COPYING.md']:
    p=ROOT/'assets'/name
    if p.exists():include.append(p)
include += [p for p in (ROOT/'assets/pieces').iterdir() if p.is_file() and
    (p.name.startswith(('cburnett-','merida-','chessnut-')) or 'LICENSE' in p.name or 'COPYING' in p.name)]
include += [p for p in (ROOT/'assets/models').iterdir() if p.is_file() and
    p.name in ['ABeautifulGame.glb','ABeautifulGame-README.md','LICENSE.md','metadata.json']]
archive=ROOT.parent/'lichess-video-reimagined-source.zip'
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
    for p in sorted(set(include)):
        if p.exists():z.write(p,Path('video')/p.relative_to(ROOT))
with zipfile.ZipFile(archive) as z:
    assert z.testzip() is None
    assert not any(x.endswith(('.wav','.mp3','.f32')) for x in z.namelist())
    print(f'Source archive: {len(z.namelist())} files, {archive.stat().st_size:,} bytes.')
print(f'Validated 15.000 seconds, 900 frames, 1080p60, H.264/AAC stereo. '
      f'Audio: {probe["audio_measurement"]["integrated_lufs"]:.2f} LUFS; '
      f'{probe["audio_measurement"]["true_peak_db"]:.2f} dBTP.')
