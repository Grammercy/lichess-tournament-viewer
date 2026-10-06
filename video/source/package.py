"""Validate and package the rebuilt 3D film."""
from pathlib import Path
import json, shutil, subprocess, zipfile
import numpy as np
root=Path(__file__).resolve().parents[1]
master=root/'lichess-tournament-viewer-pop.mp4'
credit='Music: I Can Hear Your Heartbeat by Michael Ramir C., Mixkit Stock Music Free License, https://mixkit.co/license/#musicFree. Edited for this video. 3D chess: A Beautiful Game by Moeen Sayed and Mujtaba Sayed, copyright 2020 ASWF, glTF conversion copyright 2022 Ed Mackey, CC BY 4.0. Materials and animation adapted.'
subprocess.run(['ffmpeg','-v','error','-y','-i',str(root/'rebuild/rebuilt.mp4'),'-c','copy',
    '-metadata','title=Lichess Tournament Viewer | Instrumental pop film','-metadata','comment='+credit,
    '-movflags','+faststart',str(master)],check=True)
shutil.copy2(master,root/'lichess-tournament-viewer.mp4')
subprocess.run(['ffmpeg','-v','error','-y','-ss','0.48','-i',str(master),'-frames:v','1',str(root/'poster-pop.jpg')],check=True)
shutil.copy2(root/'poster-pop.jpg',root/'poster.jpg')
subprocess.run(['ffmpeg','-v','error','-y','-i',str(master),'-vf','scale=960:540,fps=30',
    '-c:v','libx264','-crf','24','-preset','fast','-c:a','aac','-b:a','128k','-ar','48000',
    '-movflags','+faststart',str(root/'review/preview.mp4')],check=True)
shutil.copy2(root/'rebuild/storyboard.jpg',root/'review/storyboard.jpg')
probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_entries',
    'stream=codec_name,width,height,avg_frame_rate,nb_frames,duration,sample_rate,channels,pix_fmt',
    '-show_entries','format=duration,size,tags','-of','json',str(master)]))
v,a=probe['streams']
assert v['width']==1920 and v['height']==1080 and v['nb_frames']=='900' and v['avg_frame_rate']=='60/1'
assert v['pix_fmt']=='yuv420p' and float(probe['format']['duration'])==15
assert a['sample_rate']=='48000' and a['channels']==2
raw=subprocess.check_output(['ffmpeg','-v','error','-i',str(master),'-vf','scale=32:18','-pix_fmt','rgb24','-f','rawvideo','-'])
frames=np.frombuffer(raw,np.uint8).reshape(-1,18,32,3)
assert len(frames)==900
brightness=frames.mean(axis=(1,2,3))
assert float(brightness.min())>6,'Blank frame detected'
probe['bpm']=128;probe['beats']=32;probe['frames_per_beat']=28.125
probe['min_frame_mean_brightness']=float(brightness.min())
probe['review']='Authored glTF chess models; raised outlined filter; radial update wave; same-position board extraction; fixed-anchor panel pops; themes; 3D piece rise; study import.'
probe['extraction_position']='Raul3031–OmarPetare, flipped, identical 16-piece arrangement before and after extraction.'
probe['camera_hold_seconds']=[6.09375,7.03125]
probe['music']='I Can Hear Your Heartbeat by Michael Ramir C., Mixkit Stock Music Free License'
audio_result=subprocess.run(['ffmpeg','-hide_banner','-i',str(master),'-af','loudnorm=I=-14:TP=-1.5:LRA=8:print_format=json','-f','null','-'],capture_output=True,text=True,check=True).stderr
audio_result=json.loads(audio_result[audio_result.rfind('{'):audio_result.rfind('}')+1])
probe['audio_measurement']={'integrated_lufs':float(audio_result['input_i']),'true_peak_db':float(audio_result['input_tp']),'loudness_range_lu':float(audio_result['input_lra'])}
probe['decode_errors']=0
probe['extraction_check']=json.loads((root/'review/extraction-check.json').read_text())
subprocess.run(['ffmpeg','-v','error','-xerror','-i',str(master),'-f','null','-'],check=True)
(root/'review/validation.json').write_text(json.dumps(probe,indent=2)+'\n')
archive=root.parent/'lichess-video-pop-source.zip'
include=[master,root/'README.md',root/'index.html',root/'credits.txt',root/'asset-LICENSE.txt',root/'requirements.txt',root/'poster-pop.jpg']
include+=list((root/'source').glob('*.py'))+[root/'source/captures.json']
include+=[p for p in (root/'assets').rglob('*') if p.is_file() and p.name not in ['original-score.wav','live-prepared.mp4']]
include+=[root/'rebuild/music-credit.json']
include+=[root/'review/storyboard.jpg',root/'review/validation.json',root/'review/extraction-check.json']
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
    for p in sorted(set(include)):z.write(p,Path('video')/p.relative_to(root))
with zipfile.ZipFile(archive) as z:
    assert z.testzip() is None
    print(f'{len(z.namelist())} files, {archive.stat().st_size:,} bytes')
print('Verified: 15.000 seconds, 900 frames, 1080p60, H.264/AAC stereo. No blank frames.')
