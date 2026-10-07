# Lichess Tournament Viewer film

The rebuilt film is 15 seconds, 1920 × 1080, 60 fps, with a 128 BPM instrumental pop excerpt.

The composition uses recorded live games and the actual study-import dialog from
https://lichess-tournament-viewer.aralani.chatgpt.site/. Controls are isolated and
reconstructed at a larger size for the film. Captured tournament counts describe
the recorded event, not the current status of that tournament.

The customization shot uses the captured Raul3031 versus OmarPetare position in
source/captures.json. The board turns in its own plane, previews Merida pieces,
then lifts into 3D at 6.09375 seconds. The planar center stays at (1220, 616).
Piece geometry emerges at its full proportions. Side controls pop at fixed
anchors. Appearance fades to Light, then colors propagate by file to Green and
Blue. The study chapter thumbnails are an illustration of the import workflow.
The sign-in dialog is a capture; the film does not claim to create a signed-in study.

## Rebuild

Requires Python 3.11 or newer, FFmpeg, and OpenGL/EGL. Install video/requirements.txt.
The renderer uses Noto Sans and Nimbus Sans fonts installed under /usr/share/fonts.

Run from the project root:

```sh
python video/source/render_editorial.py --stills
python video/source/compose_editorial.py
python video/source/render_editorial.py --render
python video/source/package_editorial.py
```

The package script muxes the audio, exports the master, checks duration and format,
decodes every frame, measures audio loudness, and creates a source ZIP.

The music script downloads the original licensed track from Mixkit. The source
ZIP includes the finished audiovisual film and the download recipe, not a
standalone copy of the music.

## Credits

Music: I Can Hear Your Heartbeat by Michael Ramir C.
Source: https://mixkit.co/free-stock-music/pop/
License: https://mixkit.co/license/#musicFree
Excerpt starts at 23.174688 seconds. Pitch-preserving retiming changes 125 BPM to
128 BPM. A measured 112 ms phase correction aligns the drum attacks with the
edit. The soundtrack includes original short interface sounds.

3D chess: A Beautiful Game by Moeen Sayed and Mujtaba Sayed.
Original model © 2020 ASWF / MaterialX Project.
glTF conversion © 2022 Ed Mackey.
Source: https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/ABeautifulGame
CC BY 4.0: https://creativecommons.org/licenses/by/4.0/
Materials, normals, scale, orientation, lighting and animation adapted for this film.

2D chess assets are from Lichess. Cburnett pieces are by Colin M. L. Burnett,
GPL-3.0-or-later. SVG sources and the asset licenses accompany the source ZIP.

Review files include the shot plan, sampled frames, transition contact sheet,
and technical validation. Drafts are kept outside the deliverable archive.
