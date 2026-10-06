# Lichess tournament viewer pop film

`lichess-tournament-viewer-pop.mp4` is the revised master. It is 15.000 seconds,
1920 × 1080, 60 fps, with H.264 video and stereo AAC audio at 48 kHz.

The opening uses individually authored, carved marble chess meshes from
[A Beautiful Game](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/ABeautifulGame).
The knight moves and the board's 64 squares turn over to reveal recorded live
play on the hosted viewer.

At 3–4 seconds, the status control lifts out of the fixed interface with a
green outline. Its selection changes to Finished, then a radial highlight
wave updates the tournament and game grid. The captured Finished view is
from the same Hourly SuperBlitz Arena as the live footage.

At six seconds, the board lifts out of the enlarged Raul3031–OmarPetare
flipped game. Its screen center, initial size and exact chess position stay
consistent. The camera pauses for the extraction. The two side panels turn
and pop at their existing anchors, exchanging the placement of the theme
menu and site view. The board carries the subsequent color and piece-set
changes, then the authored 3D pieces rise. The site's 3D game view folds into
study chapters and the actual import form. The ending holds the project name
and complete domain.

Charcoal, cream, brown and Lichess green form the palette. Green and blue
board themes and a light appearance change come from the site's options.
There are no persistent corner captions or beat indicators.

The actual website captures cover live games and clocks, rankings, status
filters, player search, enlarged and flipped boards, appearance, board and
piece catalogs, 3D display and study import. Controls without separate shots
remain visible in the captured interface. The raised board is a cinematic
render of the captured game, not a claim that the website itself has this
extraction animation.

## Soundtrack

"I Can Hear Your Heartbeat" by Michael Ramir C., from [Mixkit's pop catalog](https://mixkit.co/free-stock-music/pop/).
The [Mixkit Stock Music Free License](https://mixkit.co/license/#musicFree)
applies. The 15-second instrumental pop excerpt starts at 7.70 seconds.
Pitch-preserving retiming changes its 125 BPM groove to 128 BPM. The film spans
32 beats. Small actions use quarter beats, and the interface pops use the
same timeline. A beat spans 28.125 frames at 60 fps. The mix includes short
original pop effects at the control lift, selection and panel changes.

The archive contains the finished video, credits and download/render scripts.
It omits standalone music. `compose_music.py` fetches the original track from
Mixkit to rebuild the soundtrack. Credit is included in the MP4 metadata,
player and `credits.txt`.

## Render

Python 3, FFmpeg, EGL/OpenGL and `requirements.txt` are required. The renderer
uses Noto Sans at `/usr/share/fonts/noto`. Change the font paths near the top
of `source/render_3d.py` on other systems.

```sh
python3 -m venv --system-site-packages video/rebuild/.venv
video/rebuild/.venv/bin/pip install -r video/requirements.txt
video/rebuild/.venv/bin/python video/source/compose_music.py
video/rebuild/.venv/bin/python video/source/render_3d.py --stills --render
video/rebuild/.venv/bin/python video/source/package.py
```

Use `--draft` for 960 × 540 at 30 fps, or `--time 6.3` for a single frame.
Edit `camera()` and `make_scene()` to change motion. Meshes, material maps,
lights, the highlight-wave shader and postprocessing are in the same file.
`source/captures.json` stores both the intro and exact extraction positions.

`review/storyboard.jpg` is the visual review sheet. `review/validation.json`
records the output format, full decode, brightness and extraction checks.
The source ZIP excludes previous films, old music, the environment and drafts.

## Asset credits

3D chess: **A Beautiful Game**, by Moeen Sayed and Mujtaba Sayed.
Original model © 2020 ASWF / MaterialX Project. glTF conversion © 2022 Ed Mackey.
[Source and documentation](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/ABeautifulGame),
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
The film adapts scale, orientation, material color, lighting and animation.
Original meshes, texture maps, metadata and license are in `assets/models/`.

Website: [Lichess tournament viewer](https://lichess-tournament-viewer.aralani.chatgpt.site/).
2D chess assets: [Lichess copying information](https://github.com/lichess-org/lila/blob/master/COPYING.md).
Cburnett pieces are by Colin M. L. Burnett, GPL-3.0-or-later. Original SVG
sources and the GPL license are included.
