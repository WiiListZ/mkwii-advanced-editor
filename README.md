<p align="center"><img src="web/icon.png" alt="MKWii Advanced Editor icon" width="96" height="96"></p>

# MKWii Advanced Editor

A desktop track editor for **Mario Kart Wii**. It opens track archives (`.szs`), course data (`course.kmp`) and collision (`course.kcl`), shows everything in 3D, and lets you move, rotate, scale, add and remove anything on the track. It can also generate a brand-new drivable track from a layout you draw. With an extracted game folder, it can edit menu text, music, sound effects, characters and object models too.

Built with **Bun** (backend and executable), **React + shadcn/ui** (Radix primitives, Tailwind CSS, lucide icons, sonner, cmdk, resizable panels) for the interface, **Three.js** for the 3D view and the system **WebView2** for a frameless native window with an integrated title bar. Moving model parts and replacing textures use the built-in BRRES writer. Adding or duplicating model geometry uses the included ABMatt command-line tool.

**Help and questions:** join the editor's [Discord server](https://discord.gg/wrDyU9E7zs) for help with the editor, questions about modding and news. Bugs can also be reported on [GitHub](https://github.com/WiiListZ/mkwii-advanced-editor/issues).

![Mario Circuit in the current editor UI: track list, real game models and Inspector](docs/images/editor.png)

*Mario Circuit opened from the game files. The 3D view renders the track's original models and textures.*

![Track editing view with area boxes, route and checkpoint overlays, objects, the full element list and an area selected in the Inspector](docs/images/editor-elements.png)

*Track editing view: areas, routes, checkpoints and objects are visible together; Area #0 is selected with its properties in the Inspector.*

![Separate 2D track map with collision background, checkpoint lines and editable point handles](docs/images/map-2d.png)

*2D editor: edit checkpoints and routes directly on the flat track map, then switch back to 3D.*

## Editor preview

<table>
  <tr>
    <td width="50%"><img src="docs/images/collision.png" alt="Collision Paint: semitransparent surface colours and triangle edges over the original track model"><br><sub><b>Collision Paint</b>: translucent surface colours over the model, adjustable opacity and visible triangle edges.</sub></td>
    <td width="50%"><img src="docs/images/collision-edit.png" alt="Collision Edit: draw new triangles and select several"><br><sub><b>Collision Edit</b>: draw custom triangles, select several, then transform or change them together.</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/images/game-text.png" alt="Game text editor showing a live course-selection screen with the game's font"><br><sub><b>Game text</b>: edit a message and preview its place on a game selection screen with the game's font.</sub></td>
    <td width="50%"><img src="docs/images/texture-editor.png" alt="Texture painter dialog editing a real model texture"><br><sub><b>Textures</b>: paint directly on a model texture and see the result on the track.</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/images/model-parts.png" alt="Model-part browser with a selected lamp-post piece in its 3D preview"><br><sub><b>Model parts</b>: pick one piece from another track and inspect it in 3D before adding it.</sub></td>
    <td width="50%"><img src="docs/images/object-picker.png" alt="Object picker showing the Race category and a selected item box with preview and Add to track button"><br><sub><b>Objects</b>: filter by category, click an object, inspect its preview, then add it to the track.</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/images/welcome.png" alt="Home screen with track tiles, game file tools in a grid, the recent files under them and the workspace on the right"><br><sub><b>Home and Workspace</b>: tiles for tracks (Cups and tracks first) and game files, the recent files under them, and on the right the game folder (full path), Common.szs and the object documentation.</sub></td>
    <td width="50%"><img src="docs/images/cameras.png" alt="Cameras tab with intro shots and a corner preview of the selected camera"><br><sub><b>Cameras</b>: reorder intro shots and inspect the selected camera's view.</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/images/audio.png" alt="Sounds and music editor showing Koopa Cape's four separate audio tracks"><br><sub><b>Sounds and music</b>: play and export the mix or a native track separately, and replace music, effects and voices.</sub></td>
    <td width="50%"><img src="docs/images/audio-loop.png" alt="Music loop controls with an editable start position and unsaved change marker"><br><sub><b>Music loops</b>: enable or disable looping and choose the return point without re-encoding the music.</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/images/assets.png" alt="Characters and models editor previewing Dry Bowser's driver model, model parts, textures and animations"><br><sub><b>Characters and models</b>: browse original game archives, inspect the 3D model, and edit its textures, parts and CHR0 animations.</sub></td>
    <td width="50%"><img src="docs/images/assets-texture.png" alt="Texture painter open as a separate modal over the character and model editor"><br><sub><b>Texture painter</b>: each game-resource texture opens in its own modal; changes return to the resource and are saved with the archive.</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/images/tutorials.png" alt="Help center with step-by-step editing tutorials"><br><sub><b>Help</b>: step-by-step tutorials inside the editor.</sub></td>
    <td width="50%"><img src="docs/images/riivolution.png" alt="Riivolution mod editor with region selection and an applies checkbox beside the patch"><br><sub><b>Riivolution mods</b>: choose regions and patch checkboxes, then export the edited files for the SD card or Dolphin (<a href="#riivolution-mod-editor">guide</a>).</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/images/effects.png" alt="Effects editor listing every archive of the game folder with effects, the torch flame of Bowser's Castle playing in a preview, and its emitter values"><br><sub><b>Effects</b>: every archive of the game folder with particle effects; watch the effect play and edit emitters and particles with Undo, Redo and Save.</sub></td>
    <td width="50%"><img src="docs/images/effects-texture.png" alt="Torch flame texture of an effect open in the texture painter"><br><sub><b>Effect textures</b>: paint, overlay or replace the textures (BREFT) the particles draw.</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/images/game-params.png" alt="Vehicle stats of the Flame Runner with an explanation under every value"><br><sub><b>Vehicle stats</b>: kartParam.bin and driverParam.bin, every value explained.</sub></td>
    <td width="50%"><img src="docs/images/item-chances.png" alt="Item chances table: one row per item, one column per race position"><br><sub><b>Item chances</b>: ItemSlot.bin, one row per item and one column per position.</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/images/archive.png" alt="Archive window listing the files of Common.szs with their type, icon and Open buttons"><br><sub><b>Archives without a track</b>: each file with its type; open models, effects, parameters and text in their editor.</sub></td>
    <td width="50%"><img src="docs/images/sky.png" alt="Sky editor of Rainbow Road with a preview from inside the dome and a galaxy texture open"><br><sub><b>Sky</b>: paint the sky textures with a live preview, or replace the sky of the track.</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/images/home-tools.png" alt="Home screen tiles, including Effects and Game data"><br><sub><b>Home tools</b>: Effects and Game data appear when the game folder has them.</sub></td>
    <td width="50%"><img src="docs/images/skeleton.png" alt="Skeleton editor with the bone tree, the bones over the model and the selected bone's values"><br><sub><b>Skeleton</b>: the bone tree, the bones over the model and the rest position, rotation and scale of each bone.</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/images/export-3d.png" alt="Donkey Kong's driver model exported as a 3D model with 17 bones and 17 animations"><br><sub><b>Export 3D model</b>: save a game model as glTF (.glb) with its skeleton, textures and every bone animation, ready for Blender.</sub></td>
    <td width="50%"><img src="docs/images/convert-animations.png" alt="Convert 3D to BRRES dialog offering all 17 animations of a model"><br><sub><b>All animations</b>: Convert 3D to BRRES can turn every animation of the model into its own CHR0.</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/images/check.png" alt="Check tab reporting no problems on Mario Circuit"><br><sub><b>Check</b>: finds mistakes that crash the game or break races, with one-click fixes.</sub></td>
    <td width="50%"><img src="docs/images/track-generator.png" alt="Create a new track window: an oval layout with its height profile, the Shape, Road and Race steps and the layout check"><br><sub><b>New track</b>: pick a shape or draw it by hand, then road and race settings in three steps; the layout is checked as you draw (<a href="#creating-a-new-track">guide</a>).</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/images/cups-swap.png" alt="Cups and tracks window: Coconut Mall moved into Luigi Circuit's place and a custom track replacing Moo Moo Meadows in the Mushroom Cup"><br><sub><b>Cups and tracks</b>: move tracks between cups with the arrows, swap any two, or put your own track in a cup (<a href="#cups-and-tracks">guide</a>).</sub></td>
    <td width="50%"><img src="docs/images/cups-backups.png" alt="Backups of the Cups and tracks window with the change that was applied and a Restore button"><br><sub><b>Cup backups</b>: choose whether to back up before applying, then restore a saved backup with one click.</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/images/thp.png" alt="Preview videos window: the Mushroom Cup video with its four track previews, Coconut Mall's preview placed in Luigi Circuit's part"><br><sub><b>Preview videos</b>: play the menu videos (THP) and replace a track's preview with a picture, a video or another preview (<a href="#preview-videos">guide</a>).</sub></td>
    <td width="50%"><img src="docs/images/audio-export.png" alt="Export menu of Sounds and music with WAV, MP3, M4A, Ogg Opus, FLAC, AIFF and BRSTM"><br><sub><b>Audio export</b>: music, effects and voices as WAV, MP3, M4A (AAC), Ogg Opus, FLAC, AIFF or BRSTM.</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/images/cups-pulsar.png" alt="Cups and tracks showing the 1208 cups of the Insane Kart Wii Pulsar pack with their icons, the first cup's tracks, authors and settings"><br><sub><b>Mods with many cups</b>: the cups of Pulsar packs (Insane Kart Wii) and LE-CODE distributions, with search, icons, authors, moving tracks and cups (<a href="#mods-with-their-own-cups">guide</a>).</sub></td>
    <td width="50%"><img src="docs/images/cups-pulsar-new.png" alt="A new cup added at the end of the pack, with its own icon and four tracks from a file that passed their checks"><br><sub><b>New cups</b>: add a cup with its own icon and four new tracks to a mod.</sub></td>
  </tr>
</table>

## Animations in the editor

These GIFs are captured from the editor running Mario Circuit with the original game assets.

<table>
  <tr>
    <td width="50%"><img src="docs/images/intro-animation.gif" alt="Animated Mario Circuit intro camera in the editor"><br><sub><b>Intro camera</b>: play and scrub the track's opening fly-over.</sub></td>
    <td width="50%"><img src="docs/images/item-box-animation.gif" alt="Animated item boxes changing texture in the 3D viewport"><br><sub><b>Item boxes</b>: their texture animation runs directly in the 3D view.</sub></td>
  </tr>
</table>

## Features

**Workspace**
- Choose the extracted game's `files` folder, or its parent (`files` or `DATA/files` is found automatically). The Home screen shows which resources are present: `Race/Common.szs`, tracks, menus and game text, music streams and sound effects. The Home screen is a grid of tiles: **Tracks** (Cups and tracks, Open a track, New track, Empty project, with their shortcuts) and **Game files and mods** (Preview videos, Game text, Sounds and music, Characters and models, Effects, Game data, Riivolution mod); hovering a tile shows what it does. Settings, Help and **Discord** (opens the editor's Discord server, for help and questions) are at the top; the column on the right has the game folder (with its full path), **Race/Common.szs** (loaded or not, its path, **Open Common.szs** to see its files, models and game data in the archive window, **Load Common.szs…** and the folder icon to show it in Explorer), **Object documentation** (which documentation is in use, **Replace with JSON…**, **Edit JSON…**, **Restore default**, **Export JSON…**, **JSON format**, **Contribute on GitHub**). The same two cards are in Settings › Game files. Under the tiles, **Recent files** lists the files opened last, two per row, with their folder: click one to open it again. The Home screen always fits the window: on windows lower than 900 pixels the tiles become single rows (icon, title and shortcut).
- **Edit several tracks at once:** Open, recent tracks, the track switcher and tracks in **Cups and tracks** open a separate 3D editor window for each track. Each window has its own selection, changes, Undo/Redo and Save. The file name is in its title, with `*` while unsaved. Home and the cups stay open; closing Home keeps the other editors working. **New track** and **Empty project** also open separate windows. Creating a track from a cup position assigns it directly to that position and opens it separately, without a Save as dialog or replacing another open document. Save keeps its working copy until **Apply** installs it in the cup. The same editor then saves directly to that cup's track archive. If two windows edit the same file, Save asks before overwriting a version changed by the other window.
- **Change…** opens the standard Windows folder picker with the current workspace selected. Empty folders are rejected. When the new workspace contains `Race/Common.szs` and a different copy is loaded, the editor asks whether to use the workspace copy or keep the current one. The choice is remembered between sessions.
- **Settings › Editing › Keep .bak backups** is on by default. Turn it off to save without creating new `.bak` copies; the editor warns before switching it off and retains backups already on disk. The setting covers tracks, game text, models, audio and saved Riivolution XML. Edited files are still found by **Add edited workspace files** in the Riivolution editor.

<img src="docs/images/settings.png" alt="Settings showing Keep .bak backups enabled in the Editing section" width="800">
- If the files are a Riivolution mod instead of an extracted game folder, click **Open Riivolution XML…** on the Workspace card. Choose the XML from `riivolution/` (or next to the mod folder). The editor follows each `<file>` or `<folder>` entry from its disc path to the real file under the SD root, including custom patch roots and renamed files. It shows only resources the XML points to and remembers the XML for the next session. Missing files are not invented; keep the XML and its mod folder together. The same button is offered when a chosen folder contains no recognizable game files.
- The track list is in **Cups and tracks** (it used to be on the Home screen; a note on Home says so once, with a button to open it). There, **All tracks** at the top of the cup list shows every track file of the selected folder as they change, and **Other tracks › Not in a cup** the custom tracks, demos and other archives that are in no cup of the game; the cups themselves show their four tracks. The list has search (name or file number), **Version** (single player, multiplayer `_d` or all files), **Type** (race, battle or both) and pages for large mods. The tracks of the original cups show their cup's icon and position (for example *Flower Cup 2 · shopping_course.szs*); with **Video previews** on (the default), the rows are taller and each one plays the track's preview from the cup selection behind it. Turn it off for the plain, compact list. Click a track to open it in the editor. The track switcher also searches large lists. Yaz0, YLZ, YBZ, WLZ, WBZ and WU8 archives (`.szs`, `.wlz`, `.wbz`, `.wu8`) open in the desktop editor without Wiimm's SZS Tool. WU8 based archives still need the extracted original `Race/Course` tracks for their object files. This also works in the archive index and the model, game-text and UI resource editors. See [Archive compatibility](#archive-compatibility).

  ![All tracks in Cups and tracks: every track file with search, version and type filters, each with its cup icon, its position and its preview video playing behind it](docs/images/library-cups.png)

- **File › Open** (and double-click in Explorer, drag and drop, recent files) also opens game files on their own, each in its editor, without closing the open track: models (`.brres`) in Characters and models, game text (`.bmg`), effects (`.breff` / `.breft`, together when both are in the folder), vehicle, character and item parameters (`kartParam.bin`, `driverParam.bin`, `ItemSlot.bin`), music (`.brstm`), sound archives (`.brsar`) and Riivolution XML. Save writes the same file back (with a `.bak` copy when backups are on).
- Opening a track maximizes the desktop editor. **Home** in the title bar returns to the start screen without closing the track or losing unsaved work; **Continue editing** restores the current 2D or 3D view. **Close track** on Home or in the File menu clears the track, with confirmation for unsaved changes, while Home stays open.

**Sounds and music**
- *Tools › Sounds and music* (also on Home) lists the BRSTM music streams in `sound/strm` and the effects, voices and instrument samples in `sound/revo_kart.brsar`. Search by name, file or group, inspect the waveform and loop point, and listen with optional looping. The timeline shows elapsed and total time; drag it or click the waveform to seek.
- A standalone `.brstm` or `.brsar` also opens directly through **File › Open**, drag and drop, or Explorer's **Open with**. The audio window lets you play, replace, export and save it without loading a game workspace. Browser-picked files without a disk path use **Save** to export the edited file.
- For a music BRSTM, **Loop in file** turns looping on or off. Enter the loop start in seconds or use the current playhead position, then **Apply loop** and **Save**. The loop end is the end of the stream. This edits BRSTM metadata and DSP-ADPCM loop history without re-encoding its audio; the original file is backed up on first save. **Preview loop** affects listening only.
- For multi-track BRSTMs, expand **Separate tracks** with its arrow to see each native audio layer's waveform, play it alone from any point, or export it in any of the formats below (BRSTM as a single-track stream). Collapse the arrow to hide the layers. Twelve of the original streams have two to four separable tracks. A track can contain several instruments; ordinary stereo mixes cannot be split into original instruments by this mode.
- **Export** saves the music, a sound effect, a voice or a single track in the format you choose:

  | Format | Kind | Use it for |
  |---|---|---|
  | WAV | Uncompressed, 16-bit | Any program; the exact game audio |
  | MP3 | 192 kbps | Phones, players, sharing; the game's 32 kHz is kept, other rates become the next MP3 rate (44.1 or 48 kHz) |
  | M4A (AAC) | 192 kbps, 48 kHz | iTunes, phones, video editors; uses the AAC encoder of Windows (the item says so when it is missing) |
  | Ogg Opus | 160 kbps, 48 kHz | Smallest files with good quality |
  | FLAC | Lossless | The exact game audio, smaller than WAV |
  | AIFF | Uncompressed, 16-bit | Mac programs and audio editors |
  | BRSTM | Game format | Replacing music in another game folder or mod; keeps the loop |

  Streams with several tracks are mixed to stereo, except in BRSTM, which keeps them separate.
- Replace a stream or sample with an audio file, adjust its volume and loop, preview it, then **Save** to write the game files. With backups enabled, the first save keeps a `.bak` of each original; unsaved replacements are confirmed before closing.

**Characters and models**
- *Tools › Characters and models* (also on Home) opens a separate editor for character and kart archives in `Race/Kart`, shared objects in `Race/Common.szs`, and track objects in `Race/Course` or the currently open track. Character archives show readable driver and vehicle names (and can be searched by either name or filename). Browse the BRRES resources inside each SZS, rotate and zoom their 3D preview, and inspect individual models and polygons.
- Paint or replace a TEX0 texture with a PNG in a separate modal; replace an entire resource with a compatible BRRES; or move a selected polygon. Models form an expandable tree, with each polygon under its own model. **Replace with 3D file** and **Replace selected part** use ABMatt's patch operation for unrigged, single-model `course` resources. ABMatt cannot patch rigged character BRRES files or add geometry directly to their `model_cpu`/`model_lod`; for these, use **Replace BRRES** with a converted resource containing the same model names. Select a polygon before using **Move part**. A replacement BRRES must keep the model names expected by the game.
- **3D model** saves the selected model as glTF binary (`.glb`): the skinned mesh, its skeleton, its textures and every CHR0 bone animation as a separate glTF animation, ready for Blender or any glTF viewer. Texture animations (SRT0, PAT0, CLR0) have no glTF counterpart and are left out; materials keep their colour and texture, not the game's TEV effects.
- **Convert 3D to BRRES** creates a standalone BRRES from OBJ, FBX, glTF, GLB, DAE, STL, PLY or `.blend` using Blender and ABMatt. When a source has animation, choose **All animations** (each animation of the armature becomes its own CHR0), one CHR0 clip, or **Model and skeleton only**; the latter retains armature bones without exporting animation. All animations needs a single armature; with several rigs, or objects that move without bones, only the main animation is converted. The model keeps its original position, so a model exported with **3D model** comes back exactly where it was. Shape-key animation is not supported by this standalone conversion. The exported BRRES is not automatically game-slot compatible: characters may require their original model names, skeleton, LOD model and other resources. Inspect the result and test it in Dolphin or on hardware before replacing game files.
- Rigged character models can be edited separately from CHR0. **Edit skeleton…** opens the skeleton editor: the bone hierarchy on the left (search by name, children indented under their parent), a 3D preview with every bone drawn over the model and the selected bone marked in orange with its axes (the model can be hidden), and the position, rotation (degrees) and scale of the selected bone. Each value changes when its field loses focus; **Undo** and **Redo** (Ctrl+Z, Ctrl+Y) step through the bone edits; **Done** returns to Characters and models, where **Save** writes the archive. The quick **Move / Rotate / Scale bone…** buttons beside it are still there for one value at a time. Bone edits update the MDL0 rest transforms and world matrices in place, leaving existing animation keyframes unchanged; a clip targeting the same bone may still pose it differently during playback.

![Characters and models editor showing Donkey Kong's driver model with its bones drawn over it and the skeleton controls](docs/images/assets-skeleton.png)

![Skeleton editor of Donkey Kong's driver model with the bone tree, the bones drawn over the model and the selected arm bone marked](docs/images/skeleton.png)
- **Animations** lists the CHR0 clips like the Models tree: the arrow (or the name) opens a clip to show its length, **Loop**, **Delete** and the bones it animates; the play button plays it in the preview and turns into a stop button that returns to the rest pose. Import a CHR0 from another BRRES without replacing the geometry.  Imported bone tracks are matched to the destination model's bone names. External animated 3D imports can include an animation when the format and installed converters support it; other animation types and in-game compatibility should be checked in Dolphin or on hardware.

![Animations tab of Dry Bowser's driver model with the first clip open, its length, Loop, Delete and animated bones](docs/images/assets-animations.png)

- **Save** writes the edited SZS and, when backups are enabled, keeps a `.bak` of the original. Painted textures and skeleton edits are written only by **Save**; until then they live in the editor (the Save button shows how many resources changed). For the track open in the 3D editor, the resources are also written into its SZS straight away (and join its undo history); the track's other unsaved edits (routes, objects, collision) still wait for *File › Save*. Switching archives or closing with unsaved changes asks for confirmation.
- **Other copies.** The game keeps a separate copy of many models and loads the one of the archive it uses: a character's `driver_model.brres` is in every vehicle archive of that character and again in the 2- and 4-player versions (`_2`, `_4`); an object such as `itembox.brres` is in every track and in the track's split-screen version (`_d`). On **Save** the editor looks for those copies and offers to update them: the same character's other vehicles and split-screen versions (on by default), a track's `_d` version (on by default) and other tracks that use the same object (off by default). Identical copies get the whole change; other versions of the model (lighter split-screen models, the driver on a bike instead of a kart) get only the edited textures, where their texture was the same as the edited one. Objects in `Race/Common.szs` exist only there. To give each vehicle or track its own look, switch the copies off in that question, or turn off **Offer to update other copies** in Settings › Editing (the question also has **Ask about other copies next time**): Save then writes only the archive being edited.
- The archive list, the resource list and the details are side by side; drag the line between two columns to make it wider or narrower (double-click the line for the default widths). The widths are remembered.
- In the 3D track editor, right-click a course-model part or placed object and choose **Edit model resource…** or **Edit object resource…** to open this editor at that resource. Right-click selection uses the point where the click began, so a small cursor movement does not select a neighboring element.

**Real game graphics**
- The track's own `course_model.brres` and skybox are shown with their textures, plus the real model of every object (from the track archive or from `Race/Common.szs`).
- Materials are drawn the way the Wii does it: every TEV stage, colour and konst register, swap table, alpha test, blend mode and light channel of each MDL0 material is turned into a shader, so baked shadows (vertex colours and shadow maps such as `p_all_kage`), light maps and colour effects look like in the game. Materials that use a light set are lit by the track's own lights from `posteffect/posteffect.blight`.
- In-game animations: bone animations (CHR0: enemies, flags, trees), texture animations (SRT0: water, item boxes), texture swaps (PAT0: crowds, flags, screens) and colour animations (CLR0: lava glow in Bowser's Castle and Grumble Volcano). They can be turned off.
- Billboards (the item box "?", Mii crowds, suns, flames, Boos…) face the camera like in the game, and item boxes and coins float above their KMP point as the game draws them. The Chain Chomp stands on its point instead of sinking half into the road (its model is built around the centre of the ball). This changes only how it is drawn: the saved position is the same, so the game places it exactly where it always did. Objects the game really shows half underground, such as Monty Mole or the fire snakes in lava, keep their position. The sand piles under the Dry Dry Ruins sandfalls are drawn raised by their second setting, as the game shows them, instead of sunk under the floor.
- **Particle effects** of the track's objects play in the 3D view (**Settings › 3D view › Show effects**, on by default): objects whose effect folder is in the track (`effect/<object>/`, for example `effect/wanwan/` for Chain Chomps or `effect/taimatsu/` for torches) emit the particles of each emitter with its rate, life, speed, colour, size and texture. It is an approximate preview: the game also moves particles along curves and starts many effects only on events (a Thwomp landing, a fire pole erupting), so those look faint or stay hidden, as they do between events in the game.
- Start positions show Mario on the Standard Kart M, built from the game's own `Race/Kart/mdf_kart-mr.szs` (wheel positions and ride height from `bsp/mdf_kart.bsp`, seat position from `kartDriverDispParam.bin` in Common.szs) and playing his driving animation. Respawn points show the game's Lakitu (`jugemu.brres`) with its `wait` animation. Both need Common.szs loaded from the game folder. Until then the editor draws its own models of Mario on the Standard Kart and of Lakitu in his cloud; no game files are included in the editor.
- Areas are outlined in a colour per type (camera areas red), also shown next to each area in the Track list.
- Objects without a model get a recognisable low-poly stand-in; every other element has its own model (kart, Lakitu, camera, cannon, trophy, shells).

**Custom tracks and objects**
- Custom tracks open like the originals: any `.szs` with its own `course_model.brres`, textures and object models.
- Object models and textures are stored per course: an edited object resource is saved in the open course SZS, including when the original came from `Common.szs`; all instances of that object in this course use it, while other courses keep their appearance. The `_d.szs` multiplayer course is a separate archive and can be edited the same way.
- **Track objects…** (Inspector, or *Tools › Track objects of this track*) opens *Characters and models* directly on the open track, with the selected object's BRRES chosen: models, textures and animations are edited there exactly like the game's characters and objects. The header shows which `.szs` is being edited, and **Open in editor** above the list returns to the track open in the editor. Objects with a one-shot texture animation (the Thwomp's face) show their resting texture, which is the one the game draws most of the time.
- **Sky** (Outline, or *Tools › Sky…*) edits the track's `vrcorn_model.brres`: paint its textures with a live preview in the 3D view, replace them with a PNG, export the BRRES, or replace the whole sky with another track's (its model must be named `vrcorn`).
- **Lighting** (*Tools › Lighting of this track…*) edits the track's `posteffect` lights; every change relights the models of the 3D view at once. `posteffect.blight` has 16 lights (type, coordinates, origin and destination, colour and strength with a colour picker, ambient colour, spot and distance falloff; lights 0–7 are the ones the KCL can choose per area) and the ambient colours; `posteffect.blmap` has the light maps that make surfaces shiny (linked `lm_` texture, type, which lights it uses, and the intensity and gradient of its 32 stages). **Open** on a `.blight` or `.blmap` in an archive window, including `lightset/default.blight` and `default.blmap` of `Race/Common.szs` used by tracks without their own, opens the same editor. Layouts and meanings come from the [Custom Mario Kart wiki](https://mkwiiki.org/wiki/BLIGHT).
- Drop loose files together (`course_model.brres`, `course.kcl`, `course.kmp`, object `.brres`…) to assemble a new SZS.
- View › Load reference model shows any `.brres` (or the models inside an `.szs`, or an `.obj`) — handy to preview custom objects.
- Objects with custom IDs get their names and models once you load the mod's own `Common.szs`.
- **Tracks folder** (Settings › Game files, by default the `Race\Course` folder next to the loaded `Common.szs`): every `.szs` in it is indexed, so objects whose model is neither in the open track nor in `Common.szs` — another track's trees, or custom objects of modded tracks — are shown with their real model (blue icon, with the track it comes from). The home screen and the track name in the title bar then list every track of the folder: pick one (or use the arrows beside it) to switch to it directly. When saving, their files (`.brres`, `.kcl`, `effect/<name>/…`, `brasd/<name>/…`) are copied into the SZS so the game finds them too.

**Editing**
- The **3D | 2D** switch immediately before **Add** opens a separate flat X/Z editor, like the layout view used when creating a track. It draws driveable `course.kcl` surfaces beneath KMP points; files without collision show a schematic road from their routes, or the course model when no route data exists. Choose a layer to edit checkpoints, enemy routes, item routes, object routes, starts, objects or respawns. Drag a checkpoint centre to move both edges, or drag an edge to resize it. The selected layer has a named **Add** action; **Select** exits placement. Drag empty space to pan, use the wheel to zoom, or **Fit map** to frame the track. Selected starts, objects and respawns show a white handle: drag it around the point to rotate (Shift snaps to 15°), or press **Q** / **E** to turn by 15° (Shift: 90°). **Ctrl+C** / **Ctrl+V** copy the selection and paste it under the mouse, **Ctrl+D** duplicates it next to the original. The Inspector, Undo/Redo and Save use the same track document as the 3D view.
- Switch between the visual model, the collision coloured by surface type, or both (**Model**, **Collision**, **Both** in the toolbar). Opening the **Collision** tab switches the view to **Both** (and back to **Model** when the tab is left, unless another view was chosen meanwhile); a track that has no model shows its collision.
- Every KMP element: start positions, enemy (CPU) routes, item routes, checkpoints, objects, routes, areas, cameras, respawns, cannons and battle end points.
- **Battle end points** appear in the track list and in **Add** only for battle arenas: a track that has some, an arena file (`*_battle`), or a track without checkpoints (arenas have none, every race track does).
- Selecting a route **point** also shows the settings of its route (**Smooth curves** and **Motion**: cyclic or back and forth) under the point's fields, with **Select whole route**. The original Coconut Mall cars use back-and-forth routes; a new route starts cyclic.
- Gizmo to **move (W), rotate (E) and scale (R)**, on one or many elements at once. Grid and rotation snapping. "Stick to ground" mode while moving.
- **Settings › Editing › Drag to move** (off by default): in Move mode, hold the left button on an object or a point and drag it, without the arrows. It follows the pointer at its height, and an element standing on the ground keeps following the ground; a track model part is dragged the same way once it is selected (pressing on an unselected part of the road and dragging never moves it). Shift or Ctrl + drag still draws a selection box, grid snapping and **Stick to ground** apply, and each drag is one Undo step. **Hide the Move arrows** (off by default) removes the arrows in Move mode; it turns Drag to move on, which it needs, and turning Drag to move off shows the arrows again.
- Inspector with numeric fields. Drag the X/Y/Z labels left or right to change a value.
- Click to select, Shift/Ctrl to add or toggle, or drag a box to select many. Double-click to focus.
- Add elements by clicking in the view. Routes and checkpoints are added one after another, after the selected point. The Track list starts collapsed; open only the section or point group you need.
- Objects stay in the Track list. Click the + beside Objects (or **Add › Other object…**) to open the catalogue: choose a category, click an object to load its 3D preview, then use **Add to track**. The picker can also change an existing object's type. Browsing the list alone does not place or preview an object.
- **Add › Object from a track or my 3D model…** (also in **File › Import** and at the bottom of the catalogue) works like model parts, for objects. **Take from a track**: choose this track, `Race/Common.szs`, any track of your `Race\Course` folder or another archive, then one of the objects it places (with how many there are), check its model as that track has it in the 3D preview and press **Place on the track**. Its model files and effects (`<name>.brres`, `effect/<name>/…`) are copied into this track in the same undoable step, and its settings 1–8, scale and presence can come with it. Files the track already has are kept.
- **Create from a 3D model** makes an object with your own model (.fbx .glb .gltf .dae .obj .blend .stl .ply, through Blender and ABMatt): choose the model, then the object type it replaces, and **Create and place**. Mario Kart Wii cannot have new kinds of objects, so your model is saved in this track as that type's `.brres` (with the model name the game expects) and the object keeps that type's behaviour (collision, movement, sounds); every object of that type in this track shows your model. Choose a decoration that does nothing else.
- The Inspector shows an object's eight settings as separate vertical rows, with a name and explanation wherever their meaning is known. **Settings › 3D view › Area outlines through walls** is off by default: AREA perimeters are shown only where directly visible, not through houses or terrain. Turn it on for faint outlines of hidden edges. The separate **Show area volumes** setting hides all unselected area boxes and outlines when turned off; selected areas remain visible for editing.
- Duplicate, delete, snap to ground, align rotation to the route, distribute evenly.
- Deleting an object also removes its collision from `course.kcl`: the collision made for it with **Generate collision…** (model surfaces, simplified surfaces or box) and the collision the track itself has on the object's model (for example the base of a statue). It is found from the object's model where it stands, so road and walls around it stay; the toast says how many triangles went, and one Ctrl+Z brings back the object and its collision. Objects whose collision is part of the object type (ObjFlow) have none in `course.kcl`, and nothing else is removed.
- Undo/redo for every action.
- Deleting something remaps every index that pointed to it: group links, checkpoint respawns, object/area/camera routes and camera links.

### Object documentation

The **Objects** catalogue and the **Add / Change object** selector show each object's description, notes and all eight settings with their titles, explanations, known values and limits. The Inspector shows the same guidance next to the editable fields. The editor's own documentation, with curated descriptions for over 40 common objects, is the JSON file [web/js/data/object-documentation.json](web/js/data/object-documentation.json), in the same format as the files you can write; it names only setting slots whose meaning is known. Load `Race/Common.szs` to obtain the full official object ID/name list from `ObjFlow.bin`; documentation does not change game data or supply a model.

**Always up to date, and open to everyone.** The default documentation lives in [data/objects.json](https://github.com/WiiListZ/mkwii-advanced-editor-object-info/blob/main/data/objects.json) of the [mkwii-advanced-editor-object-info](https://github.com/WiiListZ/mkwii-advanced-editor-object-info) repository. At every start the editor downloads it and uses it, so corrections and newly documented objects arrive without a new version of the editor. The copy downloaded last is kept for when you are offline; when the file cannot be reached or is not valid, the copy shipped with the editor is used. The Object documentation card says which one is in use and when it was updated.

**Your changes are never overwritten.** When a JSON of yours is in use (chosen with **Replace with JSON…** or saved in **Edit JSON…**), the editor remembers which default documentation it started from. A newer default from GitHub then reaches it object by object: objects you did not change take the new version and objects new in the repository are added, while the objects you changed, added or removed stay exactly as you left them. A message says how many were updated and that yours were kept.

**Anyone can help complete it**: **Contribute on GitHub** on the Object documentation card opens the repository; there, open an issue or a pull request with a description, a setting name, a list of values, a correction, or the `status` and `documented` of an object (the format is below, and **Help › Object documentation** explains every field). The easiest start is **Export JSON…** or **Edit JSON…** in the editor: write and check your changes there, then send them.

On the Home screen, in the Objects catalogue and in **Settings › Game files › Object documentation**:
- **Replace with JSON…** uses a documentation JSON of yours **instead of** the default documentation, entirely: objects it does not describe show as *Unknown*. It asks first, and the card says which documentation is in use.
- **Edit JSON…** opens the documentation in use as JSON in a window of the editor. It is checked as you type, with the same rules as a file: a mistake is shown in red under the box, with its line and column and **Go there** to jump to it. **Format** indents it neatly, **Restore default** puts the editor's default JSON back in the box, and **Save** (Ctrl+S) uses it in place of the default documentation (saving the default unchanged is the same as Restore default). Closing with unsaved changes asks first.
- **Restore default** brings the editor's own documentation back (greyed out while it is already in use). A file of yours on disk is not changed.
- **Export JSON…** saves the documentation in use as a JSON file. Export the default, edit it and choose it with Replace: the easiest way to correct or complete it.
- **JSON format** opens **Help › Object documentation**, which explains the structure, the object keys, every field with its limits and the rules, with the example below and a **Copy** button.

![The documentation JSON edited in the editor, with a value out of range found as it is typed](docs/images/object-documentation-editor.png)

Each object is labelled **Documented**, **Partially documented** or **Unknown**, with a percentage of how much of it is documented: in the object picker and the Objects catalogue (beside each object that is not fully documented), above an object's documentation and in the Inspector. A JSON entry sets them with `"status"` (`"documented"`, `"partial"` or `"unknown"`) and `"documented"` (a whole number from 0 to 100; `"documented"` needs 100). Every object of the default documentation has both, from the settings each object really uses according to the [Custom Mario Kart object table](https://mkwiiki.org/wiki/Object): an object whose description and used settings are all named is *Documented* (objects with no settings, such as Sun, too); the percentage counts the description and each used setting, and settings whose meaning nobody knows (for example settings 1 and 8 of the item box) keep an object *Partially documented*. Objects with no entry are *Unknown*. In a JSON of yours without these fields the editor estimates both, shown with **~**: half for a description, half for the eight settings, by how many of them have a name.

![The object picker with the label and percentage of each object, and the item box marked Partially documented, 75%](docs/images/object-documentation-status.png)

 Start with [docs/object-documentation.example.json](docs/object-documentation.example.json). The file format is:

```json
{
  "version": 1,
  "objects": {
    "itembox": {
      "label": "Item Box",
      "description": "Touching this box starts an item lottery.",
      "notes": "Optional extra guidance.",
      "status": "partial",
      "documented": 75,
      "settings": {
        "2": {
          "label": "Player item type",
          "description": "Item type for human players.",
          "options": { "0": "Default", "1": "Banana", "2": "Mushroom" },
          "otherValues": true,
          "limits": "Other codes are not documented."
        },
        "7": {
          "label": "Height offset",
          "signed": true,
          "min": -1000,
          "max": 1000
        }
      }
    }
  }
}
```

Use an ObjFlow internal name (`itembox`), decimal ID (`101`) or hexadecimal ID (`0x0065`) as the object key. IDs refer to the same object even if a custom `ObjFlow.bin` changes its name; an ID entry wins when both name and ID entries define the same field. Settings keys are `1` through `8`; each documented setting needs a `label`, and can have:
- `min` and `max`: the real limits of the value. The Inspector's box accepts nothing outside them: a lower or higher value, typed or dragged, becomes the limit.
- `signed: true`: the value has a sign and the box shows −32768 to 32767 (the file stores −1 as 65535); `min` and `max` are then signed too.
- `options`: `{ "value": "label" }`, 1 to 256 choices inside `min`–`max`. The setting becomes a list in the Inspector instead of a number box; `otherValues: true` adds **Other value…** to type a number that is not listed.
- `description`, plus `values` and `limits` as notes shown under the setting. Object entries need at least one of `label`, `description`, `notes`, `status`, `documented` or `settings`. The chosen JSON is kept in the editor's `settings.json` and works across tracks and launches until **Restore default**. Entries imported with an earlier version (which were added to the old built-in documentation) are replaced by the new default documentation; choose your file again with **Replace with JSON…** to use it. Documentation is for the editor UI; it is not written into the track SZS.

Every setting is stored as an unsigned 16-bit number (`0–65535`). Without `min`/`max` the box takes that whole **file-format range**, which is not a claim that every value is valid for that object, and the guide says that the game-specific range is unknown. The built-in documentation uses lists for the settings whose values are known (item box item types and lottery timing, Thwomp route behaviour, Cataquack, car and truck colours, crab and propeller directions…), always with **Other value…** where other values are not ruled out, and signed values where the game reads them with a sign (item box height offset, Chain Chomp target, fire-bar rotation speed: positive turns counterclockwise, negative clockwise). The built-in values are based on the [Custom Mario Kart object table](https://mkwiiki.org/wiki/Object) and [item-box settings](https://mkwiiki.org/wiki/Item_Settings_-_Item_Boxes); custom game patches may interpret them differently.

**Collision** (full walkthrough in [Collision editor](#collision-editor))
- Three modes in the Collision tab: **Show**, **Paint** and **Edit**.
- Paint surface types with four brushes over the track model; variant and shadow can be set.
- Draw new collision as triangles, rectangles, walls, boxes, cylinders, spheres or polygons; they are split into triangles automatically.
- Select a track model part, or one or more placed objects, and choose **Generate collision…** in the Inspector or context menu to give them collision they lack. Copy the model surfaces as they are, simplify them to a triangle budget (useful for detailed models), or use one bounding box per object, turned with the object. The dialog counts how much of the model already lies on course collision and can fill only the parts that have none, so nothing is doubled. The surface can be one KCL type or *Auto* (road on the floors, wall on steep sides). The new triangles are appended to `course.kcl` with undo/redo and left selected so their type can be changed; an object produces static collision at its current position, not collision that follows its route or animation.
- **Remove all collision…**, beside Generate collision and in the context menu, removes the collision matching the selected model parts or objects while keeping their models. A confirmation shows the triangle count before removal. **Ctrl+Z** restores it; save the SZS to keep the change.
- Select, move, rotate, scale, retype, duplicate, flip or delete triangles.
- Import an OBJ model as collision, export the collision as OBJ. Built-in KCL encoder (positions, normals, prisms, octree).

**Track creation** (full walkthrough in [Creating a new track](#creating-a-new-track))
- *File › Create new track* (Ctrl+N, or **New track** on Home) works in three steps: **Shape** (pick a ready shape or draw the track by hand with the mouse, then drag, add and remove points and set their height and width), **Road** (width, off-road, walls, boost panels) and **Race** (laps, item boxes, checkpoints, respawns). Every value is explained under its box.
- The layout is checked while you draw, and the generator takes care of what would break the track: where the road crosses itself it builds a bridge, the inside of turns tighter than the road is narrowed so it does not fold over, and slopes too steep to climb are spread out; these places are marked in blue on the drawing. Very short tracks are marked in orange. Changes to the layout can be undone (Ctrl+Z / Ctrl+Y).
- The generator builds the collision (road, off-road, walls, boost panels, fall boundary) and a complete KMP: start, checkpoints with key checkpoints, enemy and item routes, respawns, item boxes and cameras.
- Exports the visual model as OBJ + MTL with UVs, ready to be turned into `course_model.brres`. Once the track has its models, **Tools › Cups and tracks** puts it in a cup of the game.

**Preview videos** (full walkthrough in [Preview videos](#preview-videos))
- *Tools › Preview videos (THP)…* (also on Home) plays the game's THP movies: the track previews of each cup, the cup and arena selection, the menu buttons, the title and the ending. The parts of a movie that show one track, cup or arena are outlined and named.
- Replace a part, or the whole video, with a picture, a video file (MP4, WebM…) or a part of another preview, see the result in the player, and **Save**: every frame is encoded again, no frame larger than the original's largest, with frame count, frame rate and sound kept. A backup is made first, as for the cups. A frame can be saved as PNG.

**Cups and tracks** (full walkthrough in [Cups and tracks](#cups-and-tracks))
- *Tools › Cups and tracks…* (also first on Home) has the list of every track file (**All tracks**, **Not in a cup**) and shows the eight race cups and the two battle cups of the game folder with the tracks in each position, named as the game shows them and with the cups' own icons from the game's menus.
- Move a track with the arrows (up and down in the cup, left and right to the same place of another cup) or **Swap with** any other track: Coconut Mall can take Luigi Circuit's place, and Luigi Circuit takes Coconut Mall's. **Replace** puts a track archive from disk (a custom track, a WBZ/WU8, or the track open in the editor) into a position, after checking that the game can load it. Track and cup names can be renamed. Click a track's music to give it the **music of another track** or an **audio file** of yours (WAV, MP3, Ogg, FLAC, BRSTM…), converted to the game's format.
- **Apply** writes the track archives and their `_d` copies, the music, the track previews of the cup videos and the names in every language, after a backup of every file it changes.
- **Rename…** sits beside **Replace** on each track row. **Replace → Create a new track…** opens the track generator, builds its track model, sky and minimap, saves the complete archive and assigns it to that position. The new track stays open in the editor. Cancelling creation or saving keeps the previous track in that cup position; a failed model conversion does not save an incomplete archive.
- **New cups** (beta): **New cup** puts a cup of your own into a mod, or creates a new Pulsar mod for the game with your cups after the game's 8 (see [New cups](#new-cups)). Renaming a cup or a track opens the game text editor on its name.
- **Mods with their own cups** (beta): the cups of a Pulsar pack (such as Insane Kart Wii, 1208 cups) or of an LE-CODE distribution open in the same window. There, cups can also be added (with their own icon and four new tracks from files or drawn with the track generator), moved and removed, and hundreds of cups searched by cup, track or author. See [Mods with their own cups](#mods-with-their-own-cups). **Backups** puts them back. With `.bak` backups turned off in Settings, the editor still asks whether to make this backup, and recommends it.

**Track model**
- Use **Track → Track model → Import 3D model** (or **File → Import**) to add OBJ, FBX, glTF, GLB, DAE, STL, PLY or Blender `.blend` models. They appear near the camera target and are selected for moving, rotating or scaling. Keep a `.gltf` file beside its `.bin` and image files. Base-color image textures are carried into the BRRES when available; an OBJ texture written with a path from another computer is looked up by name in the model's folder and its subfolders. A texture that cannot be found is skipped with a warning and the model is imported without it.
- FBX, glTF, GLB, DAE and `.blend` imports can carry animation into the course model. Bone and object motion becomes CHR0; Blender shape key motion becomes SHP0 with alternative vertex sets; animated material Mapping nodes become SRT0 UV transforms; animated base colour becomes CLR0. Animations are sampled at 60 fps. A rigged model is first converted by ABMatt as its own BRRES, then its bones, materials, geometry and weighted matrices are merged into the course model. This retains multiple bone influences per vertex; the real-track smoke test checks a 50/50 two-bone vertex. The existing course objects and animation resources are checked after import. When a file holds several animations, choose one in the import dialog or import a static model. UV conversion covers Blender Mapping-node scale, rotation and translation; other shader graphs may need manual conversion.
- Animated imports require [Blender](https://www.blender.org/) and [RiiStudio's](https://github.com/riidefi/RiiStudio) `rszst.exe` in `Documents\RiiStudio` or `MKWII_RSZST`. ABMatt and Wiimm's `wszst` are included in the Windows executable. SHP0 v4 is written and read back in the smoke test; whether Mario Kart Wii plays a SHP0 in `course_model.brres` still needs an in-game or Dolphin check. Shape morphs are not yet animated in the editor's 3D viewport.
- Click an animation under **Track model** to play or pause it, move to any frame with the slider, turn looping on or off, see the bones it moves, or delete it. The Validator reports animations that move bones the model does not have (they can crash the game) and more than 8 texture animations.
- 3D models can also be dropped on the window, together with their textures, `.bin` or `.mtl` files. A confirmation is shown first; tick **Don't show this again** to skip it (Settings › Editing turns it back on).
- Click a visible part of `course_model.brres` directly in the 3D view, or select it under **Track → Track model** in the left panel, then move it with the 3D arrows. Model editing is enabled by default and can be disabled with **Edit on/off** beside Track model. This includes individual mushrooms in Luigi Circuit even though the game stores all of them in one polygon. The modified vertices are written back into the BRRES when saving the SZS, with undo/redo.
- Select a model object and use **Ctrl+C**, **Ctrl+V**, **Ctrl+D** or **Ctrl+X** to copy, paste near the camera target, duplicate next to the original or delete it. The **+** beside Track model adds a new instance from any polygon already in the track. These operations add real geometry to `course_model.brres`, including UVs, normals, and vertex colors.
- **Add → Model part from the game…** (also **Track model → +** and **File → Import**) copies any part of another game model into the track: pick a track from your game's `Race\Course` folder, `Race/Common.szs`, the open track or any `.szs`/`.brres`, then a polygon of any of its models (or a single object of a polygon that holds many, such as one lamp post), and check it in the rotating 3D preview before adding it. It is copied into `course_model.brres` with its vertex colours, UVs, materials (shader, blending, layers, texture-swap animation) and textures, where you click on the track (default), at the centre of the 3D view or at its original coordinates. **Include collision** also copies the source track's collision triangles of that part (for example the walls of a building), moved to the same place. Textures the track already holds unchanged are reused. The tracks folder is taken from the loaded `Common.szs` (its `Course` folder) or chosen in Settings › Game files. ABMatt is included in the Windows executable.
- Star game-model sources and individual parts, or objects in the catalogue, to keep them at the top of their lists. Favorites are saved between sessions.
- **File → Export → Track model** saves `course_model.brres`, or the whole track model as Collada (`.dae`) or Wavefront (`.obj`) with its textures (uses the included ABMatt tool).
- **Edit texture…** in the Inspector or an object's course appearance opens the texture painter: paint, eraser (brings back the original pixels), colour picker, mouse-wheel zoom and right-drag pan. **Replace PNG…** replaces the texture, stretched to its size. **Overlay PNG…** places the PNG over the texture as a separate layer that stays editable: with **Move overlay** drag it to move it and drag its handles to resize it (corners keep the proportions, Shift resizes freely), whenever you want, also after undo/redo. **Fit to texture** stretches it over the whole texture, **Merge** makes it part of the texture and **Delete overlay** removes it while restoring the texture underneath. The 3D view and the saved texture always show the result.
- The Inspector can replace a selected model part's TEX0 texture with a PNG. The image is resized to the existing texture dimensions and all mip levels are regenerated. Any other part using the same texture changes as well. Supported formats: I4, I8, IA4, IA8, RGB565, RGB5A3, RGBA32, and CMPR.

**Cameras and intro**
- The **Cameras** tab edits the intro fly-over with keyframes on a timeline under the 3D view (drag its top edge to make it taller or shorter). Click the timeline: with **View follows playhead** the 3D view moves onto the intro camera at that time. Frame the view and press **K** (**Add keyframe** / **Update keyframe**): the camera flies from one keyframe to the next in the time between them. Drag a diamond to retime it, type its time, position, look-at point and zoom in the Cameras tab, switch it between **Smooth** and **Cut**, or delete it (**Del**). **,** and **.** jump between keyframes, the arrows move the playhead (Shift: one second), **Space** plays the intro in 16:9 as the game shows it and stops where you are.
- Shots are written like Nintendo's own intros: type 5 (OP_FixMoveAt) cameras, routes that go back and forth, one speed on every route point (two points on the line switch it from v to v + 1 so the camera reaches each keyframe on its frame), smooth routes only with three points or more. A shot too short for its change of view is marked on the timeline: its look-at point cannot reach the next keyframe because the speed fields are 16-bit. Intro shots that the game would play differently (type 6, a replay camera that follows the kart; routes that run past their end; smooth routes of two points) are reported in the Cameras and Check tabs and fixed automatically when saving.
- Selecting any camera shows what it sees in a corner of the 3D view, with a slider to move through its duration. Set its position, look-at start or look-at end from the current view, or move the view to the camera.
- The course selection camera (shown behind the menu) can be chosen too. Deleting a camera keeps the intro links and the section header correct.
- Opening cameras move like in the game: along their route at the speed set on each route point (Setting 1, units per frame); at the last point a speed of 0 stops them, otherwise they go on along the route. The look-at point and the zoom change at their speeds (1/100 per frame). These rules were checked against the original tracks and the timings wkmpt computes. Replay and goal cameras follow the kart in the game; their preview uses the first start position.

**Riivolution mods** (full walkthrough in [Riivolution mod editor](#riivolution-mod-editor))
- *Tools › Riivolution mod…* (also on Home) creates or edits a [Riivolution](https://riivolution.github.io/) patch XML: the sections and options shown in the Riivolution menu, the choices of each option and the patches they turn on, and the files, folders and memory patches of each patch. **Open XML…** reads an existing XML; elements the editor does not know are kept when it is saved again.
- A new mod starts with the files the editor saved in the workspace, each placed in the mod folder under its disc path. The editor tracks these files even with `.bak` backups turned off. **Add file…** and **Add folder…** add anything else; a file inside the workspace gets its disc path automatically.
- **Export mod folder…** writes `riivolution/<mod>.xml` and copies every file and folder into the mod folder where the XML points, ready to copy to the root of an SD card. With **Dolphin launcher** on, it also writes a `.json` launcher for the game image you choose: put it in a Dolphin games folder and it starts the game with the mod. The footer lists problems that keep a mod from loading (missing game ID, options that use a missing patch, files without a path).

**Testing changes in the game**
- The editor writes the files of the workspace. A game started from a `.wbfs` or `.iso` image does not read them: start the extracted folder in Dolphin (add the folder above `files` and `sys` to Dolphin's game paths, or open `sys/main.dol`), rebuild an image (for example `wit copy <folder> game.wbfs`), or export a Riivolution mod.

**Help**
- **Help → Release notes** shows the patch notes of the version you are using (from its GitHub release, or the ones kept by the in-app updater). When an update is available, **Release notes of the update** shows what the new version changes.
- **Help → Discord server** opens the editor's [Discord server](https://discord.gg/wrDyU9E7zs) for help and questions (also in **About** and on the Help center's first page). **Help → GitHub page** opens the project's repository in the browser; **Report an issue on GitHub…** opens a new issue with the editor version filled in.
- Every menu entry has an icon. On Home the menus only list what works without a track; *Edit*, *View* and *Add* appear in the 3D editor.
- Settings › Interface › **Interface font**: *Default* or *Mario Kart Wii*, which uses M PLUS 1, a free font included with the editor that looks like the game's menu lettering (no game files needed).
- **Help → Tutorials** has step-by-step guides inside the editor: intro camera, checkpoints and laps, CPU and item routes, respawns, objects, areas, cannons, painting and drawing collision, track model and textures, creating a track, changing the cups, changing preview videos, checking and saving. The Cameras tab links straight to the intro tutorial.
- Settings has **Reset to defaults** (recent files, favourites and folders are kept).

**Game text**
- Open *Game text* from Home or *Tools › Game text* to edit menu and race messages (`Scene/UI/*_<language>.szs`, including `Common.bmg`, `Menu.bmg` and `Race.bmg`) in any available language. Search by text, ID or place. **Game screen** draws a representative screen from the game's own UI layouts, textures and fonts; choose another screen from the selector or turn it off for a font-only preview. When that screen's scene files are missing, the font-only preview grows to fit the full message. Some runtime 3D and video layers are approximated.
- Text wider than its box is squeezed horizontally to fit, as the game does with long names. The font-size percentage can also be changed by hand; it uses Mario Kart Wii's native BMG font-size code, so the change is saved for the game, not only shown in the preview. The preview is drawn at twice the Wii's resolution so small menu text stays sharp. The modal has an X at the top right and a fixed **Save** button at the bottom right.
- The editor reads each text box's capacity from the game's layouts and shows a used/maximum counter. Typing, pasting, icons and font-size codes must fit that capacity; names and button labels stay on one line. The original course-selection track-name boxes hold 32 characters, character and vehicle names 40, and cup names 20, including game codes. When a layout is unavailable or a message has no known layout, no arbitrary limit is imposed.
- **Insert icon** lists the game's icons (controller buttons, battle modes, ranks… from `tt_kart_extension_font`) and inserts the one you click at the cursor, as the `{1A:08010000XXXX}` code the original messages use.
- The same file is copied in many archives (Common.bmg is in ten English ones): a change is written into every copy, with a `.bak` of each original archive when backups are enabled. Messages with the same text in other screens (a track name is stored twice) can be changed together.
- Colours, button icons and inserted names are kept as `{1A:…}` codes. *Track settings › Track name…* opens the editor on the open track's name.

**Safety**
- **Validator** tab that finds problems that crash the game or break races: missing lap checkpoint, crossed or reversed checkpoints, broken links, missing respawns, invalid indices, too many points, and more. Many problems have a one-click fix.
- With backups enabled (the default), the first save over an existing file keeps a `.bak` copy of the original.

**Updates and credits**
- The Windows executable checks [WiiListZ's GitHub Releases](https://github.com/WiiListZ/mkwii-advanced-editor/releases) at startup. When a newer release has `MKWiiAdvancedEditor.exe` and its SHA-256 file, the editor asks whether to update and shows the patch notes. **Download update** downloads and verifies the release without restarting. Once it is ready, **Restart & install update** saves unsaved track changes and restarts to install it. **Later** keeps the downloaded update ready, with the restart button available in the update banner and **About**. Patch notes are shown formatted (Markdown) in a window; **Release notes** in **About** opens them again. After an in-app update, the first start shows the notes of the new version once; **What's new** in **About** reopens them. A version downloaded by hand from GitHub does not show them at start.
- **Help → About** credits WiiListZ.

**Other tools**
- Generate checkpoints from the enemy route, with width fitted to the road from the collision.
- Copy item routes from enemy routes and the other way round.
- Create respawns from checkpoints, assign the nearest respawn behind each checkpoint, link groups in a loop, reverse directions, swap checkpoint left/right, renumber IDs.
- **SZS contents** browser: extract, replace, add and remove any file inside the archive (models, textures, effects…).
- **Effects** edits particle effects in three ways: **Effects** on the Home screen (or *Tools › Effects in the game folder…*) lists every archive of the game folder that has effects (tracks, `Race/Common.szs`, `Race/Competition/CommonObj`, `Demo`; the first look builds an index, later ones are quick), *Tools › Effects of this track…* edits the open track, and **Open** on a `.breff`/`.breft` in the archive window edits that archive. Then a list has every effect (an effect is a BREFF with its BREFT textures, for example `effect/wanwan/rk_wanwan`), the middle list its emitters and textures, and the right side the selected item:
  - *Emitter*: emitter life, particle life and its randomness, particles per emission, start delay, emission interval, speeds (outwards, upwards, random, along the emitter normal or a set direction) and their spread, and the emitter's scale, rotation and position.
  - *Particles*: the two colour pairs with their transparency, particle size, scale and rotation, and the textures the emitter draws (click one to edit it).
  - *Preview*: above the values, the effect plays on its own in a small 3D view (drag to turn, wheel to zoom), all its emitters or **Only** the selected one, and follows each edit. It is approximate like the effects in the track view: curves and game events are not simulated and one-shot effects repeat.
  - *Textures*: paint, overlay or replace a BREFT texture like a model texture (palette formats C4/C8/C14X2 are shown but cannot be painted yet).
  Values are written when a field loses focus or Enter is pressed. **Undo** and **Redo** (Ctrl+Z, Ctrl+Y) step through the changes made in the window and **Save** (Ctrl+S) writes the track or the archive. Every value keeps its size, so the files never move or grow. The format was checked against every effect of the game (247 BREFF files, 2062 emitters; every texture an emitter uses is found in its BREFT).

  ![Effects editor with the archives of the game folder, the effects and emitters of Bowser's Castle and the torch emitter's values](docs/images/effects.png)
- **Game data** (**Game data** on the Home screen when the game folder has `Race/Common.szs`, or *Tools › Game data…*; **Open** on the file in any archive window; or **File › Open** on the file itself) edits the game's `.bin` files, the `.bcp` cameras, the `.bsp` vehicle physics and the `.kmg`, `.krt` and `.krm` files of `Race/Common.szs`. Three have every value named, each with a short explanation of what it does:
  - `kartParam.bin`, vehicle stats for all 36 vehicles: wheels, drift type, weight class, weight, bump deviation, top speed, speed kept while turning, tilt, the acceleration curve (A0–A3 and the speed ratios T1–T3 where it changes), drift acceleration, manual and automatic handling and drift with their reactivity, outside drift angle and decrement, Mini-Turbo duration, and the speed and turning multipliers on each of the 32 collision surfaces (road, off-road, boost…). Seven values at the end are not documented anywhere and are listed as unknown.
  - `driverParam.bin`, the 24 characters and the three Mii sizes, with the same values, which the game adds to the vehicle's own stats.
  - `ItemSlot.bin`, item chances: five race tables (one column per position, 1st to 12th), the fixed item-box table and six battle tables, one row per item. Values are weights: an item with 40 is twice as likely as one with 20 in the same column.
  - `ObjFlow.bin`, the 316 object types: ID, name and resources (shown, not edited), the sound setting, the clipping mode with the backward and forward draw distances, and the solidity (none, sphere, cylinder, box, KCL) with its sizes.
  - `GeoHitTableKart.bin` and `GeoHitTableKartObj.bin` (what happens to the player who touches each object, and to the object, with no power-up, Star, Mega Mushroom or Bullet Bill), `GeoHitTableItem.bin` and `GeoHitTableItemObj.bin` (the same for the 15 items). One row per object, named after it; each reaction is chosen from a list with its meaning (spin, crush, launch, wall, item passes through, bounces, breaks…).
  - Vehicles and drivers: `kartPartsDispParam.bin` and `bikePartsDispParam.bin` (tyres, control arms, handle, suspensions, exhaust pipes, ice block, balloons of each vehicle), `kartDriverDispParam.bin` (where each character sits on each vehicle), `driverDispParam.bin` (coin stack), `miiDispParam.bin` (Mii head), `DriverIKParam.bin` (driver animation weights between the limits of each parameter) and `kartCameraParam.bin` (the camera behind the vehicle, by vehicle size, mode and screen layout).
  - CPU drivers: `kartAIActionParam.bin` (chance of each action: start boost, drift, Mini-Turbo, trick, wheelie, blocking the player) and `kartAISpdParam.bin` (speed limit by track slot, mode and class).
  - `.bcp` cameras (`race_camera.bcp`, `battle_camera.bcp`, `mission_camera.bcp`, `start_camera.bcp`): the camera that circles the player before the countdown, with its settings, start position and 15 points with the speed of each stretch.
  - `.bsp` vehicle physics (`Race/Common.szs/bsp`, one per vehicle, listed with the vehicle's name): starting height, the 16 collision spheres, the inertia blocks, the suspension and size of each wheel, and the body rumble.
  - `minigame.kmg` (Battle settings): the points of Balloon Battle (for hitting a player, for losing all balloons…), the coins lost in Coin Runners (fewest when falling off or hit, and the share lost), and for each of the 10 arenas and each number of players from 2 to 12 the time limit of both modes and the coins at the start and at most on the stage. Its four undocumented tables are listed as unknown.
  - `ranktimeGP.krt` (Grand Prix time limits): for each of the 32 tracks, the time limit of 50cc, 100cc and 150cc/Mirror in frames (60 per second), with the time shown as minutes and seconds. The game uses them for the hidden score of each Grand Prix race behind the GP rank: finishing faster than the limit, and staying in first place, scores more.
  - `vibration.krm` (rumble patterns): each pattern is a line of marks, `*` rumbles and `-` pauses, shown as a strip of blocks and editable as text (it can become longer or shorter: the file is rebuilt). The wiki documents only the file header, so the two values of each entry, the entries that are not patterns and the other marks are shown as they are and kept.

    ![vibration.krm in Game data: the list of rumble patterns, and pattern 8 as text and as a strip of blocks](docs/images/game-data-krm.png)
    ![ranktimeGP.krt in Game data: Luigi Circuit's time limits for 50cc, 100cc and 150cc, with the time in minutes and seconds](docs/images/game-data-krt.png)
  - Menus: `IconParam_*.bin` (vehicle icons), `machine_para.bin` (the stat bars of the menus, which do not change the real stats), `mission_ui_single.bin` (Mission mode levels) and `DummyDistributionMap.bin` (Time Trial ranking placeholders).
  Layouts and meanings come from the [Custom Mario Kart wiki](https://mkwiiki.org/); what it does not explain is shown as *Unknown*, and where it does not give the order of the rows the names say so. Any other `.bin` opens as a table of values whose layout is read from the data (a count at the start, the size of each row, decimal or whole numbers); **Read as**, **Header bytes** and **Row bytes** change it and **Detected layout** goes back. LZ77-compressed files (`letter_*.bin`, `thumb_*.bin`) are recognised and not edited.
  The files are edited in place and keep their size (except `.krm`, rebuilt when a pattern changes length). **Undo** and **Redo** (Ctrl+Z, Ctrl+Y) step through the changes made in the window, and **Save** (Ctrl+S) writes the archive with the usual `.bak` backup. A **Find a parameter** box filters the long vehicle list. Every box accepts only what the file can store (item weights 0 to 255, whole numbers where the game uses them): typing past the limit stops at the limit, a minus sign is refused where values cannot be negative, and a number below the minimum is raised when the box is left. The same rule applies to every number box with limits in the editor (effects, settings, forms, the track generator, collision tools).

  ![Vehicle stats of the Flame Runner, each value with its explanation](docs/images/game-params.png)
- Opening an SZS that holds no track (no `course.kmp`, `course.kcl` or `course_model.brres`: menus, characters, `Common.szs`…) shows its contents in an archive window instead of an empty track, and leaves the track already open in the editor as it is. Each file has an icon and its type; models open in *Characters and models*, effects in *Effects*, game data files (`.bin`, `.bcp`, `.bsp`, `.kmg`, `.krt`, `.krm`) in *Game data*, game text (BMG in language archives such as `Race_E.szs`) in *Game text*, KMP and KCL in the track editor, and archives inside the archive in another window. BRLYT layouts, BRLAN animations, BRFNT fonts and TPL textures open in a read-only preview using the menu resources in the same archive. Files can also be extracted, replaced, added or removed, then the archive is saved (Yaz0, with the usual `.bak` backup).
- The yellow box around the selected object or model part is off by default; turn it on with **Settings › 3D view › Selection box**.
- Official object names: load `Race/Common.szs` (or its `ObjFlow.bin`) once and the full list of objects is remembered.
- Load an OBJ as a reference model to place things on top of it.

## Cups and tracks

Mario Kart Wii has no cup list in its files. Every position of every cup is a fixed **slot**: Mushroom Cup 1 always loads `Race/Course/beginner_course.szs`, plays the `n_Circuit32` music and shows the name stored in message `0x245C` of `Common.bmg`. To put another track in a cup, its files have to take the place of that slot's files. *Tools › Cups and tracks…* (also on Home) does this for you. It needs the extracted game folder (Settings › Game files).

![Cups and tracks window on the Mushroom Cup, with the explanation of how cups work opened at the top](docs/images/cups.png)

***How it works** at the top opens the explanation of slots, moving, replacing, names, music and backups inside the window; press it again (or **Hide**) to close it.*

### Moving and replacing tracks
1. Choose a cup on the left, or step through the cups with the arrows beside its name. Each row is a position: the track in it (named as the game shows it), the archive the game loads and the music it plays.
   The music sits at the bottom left of each row, with the tracks that originally use it in parentheses and the selection arrow immediately after the text. Under it, the THP filename opens the preview video editor with this track's part selected. Behind each row, the track's preview from the cup's video plays, as in the game's course selection (it follows the track when you move it). Click a row to open that track in the editor.

   ![The Flower Cup with music and clickable THP filenames at the bottom left of every track row, over the playing previews](docs/images/cups-previews.png)

2. Move a track:
   - **↑ / ↓** move it one place up or down; at the end of a cup it continues into the next cup.
   - **← / →** move it to the same place in the previous or next cup.
   - **Swap with…** exchanges it directly with any track of any cup, for example Coconut Mall (Flower Cup 2) with Luigi Circuit (Mushroom Cup 1).
   The track that was in the place it moves to takes its old place, so no track is lost. Race tracks and battle arenas cannot change places, because race slots need checkpoints.
3. **Replace › Track file…** puts a track archive from disk (`.szs`, `.wbz`, `.wu8`, `.wlz`: a custom track, or one made with *Create new track*) into the position. **Replace › Track open in the editor** uses the track you are editing (it is saved first). The archive is checked immediately: it needs `course.kmp`, `course.kcl`, `course_model.brres` and `vrcorn_model.brres`, and a race slot needs checkpoints. Missing files are shown in red and **Apply** stays disabled until you choose another archive. A missing minimap or start position is a warning only. When a `<name>_d.szs` is beside the chosen file, it is used for the multiplayer copy; otherwise the same archive is used for both.
4. Click a cup's name to rename the cup, or use **Rename…** beside **Replace** on a track: both open the **game text editor** on that name (every language archive, with the preview of the cup selection screen), and the window shows the new name when you close it. A track from a file takes its file name, typed in the window and written when you apply.
5. Click the music of a track (♫ and its name, under the track) to change it; see [Music of a position](#music-of-a-position).
6. The circular arrow on a row undoes the changes of that position (track, name and music). **Discard** undoes all of them. Until you click **Apply**, nothing is written.

![Coconut Mall moved into Mushroom Cup 1 and a custom track in Mushroom Cup 2, with its check passed](docs/images/cups-swap.png)

### What Apply writes
- **Tracks**: the archive of each changed slot (`Race/Course/<slot>.szs`) and its multiplayer copy (`<slot>_d.szs`). WBZ, WU8 and WLZ files are rebuilt and saved as Yaz0 SZS.
- **Names**: in every language archive of `Scene/UI` (`*_E.szs`, `*_I.szs`…), the track names follow their track, so each language keeps its own spelling. A name you typed is used in every language. Race tracks have two name messages (`0x2454 + slot` and `0x2490 + slot`) and arenas up to three. All copies are changed.
- **Preview videos** (with **Preview videos follow the tracks** on): when you point at a track, the cup selection plays its part of the cup's video (`thp/course/<cup>.thp`, four previews one above the other; the arenas are in `thp/battle/battle_wii.thp` and `battle_retro.thp`). A moved track takes its part with it: the videos of the cups involved are encoded again (a few seconds each). A track from a file keeps the preview of its position; give it its own in [Preview videos](#preview-videos).
- **Music** (with **Music moves with the track** on): the normal and final-lap streams (`sound/strm/<stream>_n.brstm` and `_f.brstm`) follow the track. Luigi Circuit and Mario Circuit share `n_Circuit32`, so when only one of them moves, that music stays with its position (the row shows *stays: shared file*). A track from a file plays the music of the position it is in, unless you choose its music. Turn the switch off to leave all music as it is, except the music you chose.
- **Chosen music**: the stream of the position gets the music of the chosen track (copied), or your audio file converted to the game's format.

### Music of a position
Click the music under a track (♫ `n_Farm` for example) to choose:
- **Music of another track**: the list of every track of the game, with the music file it plays. Its stream is copied over this position's stream when you apply.
- **Audio file (WAV, MP3, Ogg, FLAC, BRSTM…)…**: any audio the editor can read. It is read straight away (an unreadable file is refused), then a window shows its length and asks for the **Loop** (on by default), **Loop start** in seconds, **Volume** and **Final lap 10% faster** (on by default: like the game's own music, the final lap plays it a little faster and higher; off, the final lap plays the same music). When you apply, it is converted to the game's DSP-ADPCM format in the shape of the music it replaces (its sample rate, channels and stereo tracks), for `<stream>_n.brstm` and `<stream>_f.brstm`.
- **Music that goes with the track** (when music is chosen) takes the choice away.

The row then shows the new music and *music changed*. After applying, the chosen music stays visible, including after reopening the editor; it is remembered separately from pending edits. Chosen music belongs to the track: it moves with it when you move the track, and comes before the music that follows a moved track. Music files shared by two positions (`n_Circuit32` for Luigi Circuit and Mario Circuit) are one file: choosing music for one of them gives it to the other too, and the row says so. With backups selected, every music file written is backed up, like the tracks.

![The music menu of Toad's Factory with the music of every track, and Moo Moo Meadows with an audio file as its music](docs/images/cups-music.png)


Not changed: the picture of each cup on the cup selection (`thp/course/cup_select.thp`, editable in Preview videos), the Time Trial staff ghosts (in `Race/TimeAttack` they belong to the slot, so they follow the original layout) and the few objects the game ties to a slot. Test the result in Dolphin before copying it to a Wii: start the extracted folder, rebuild the image or export a Riivolution mod, as described in *Testing changes in the game* under [Features](#features).

### Backups and going back
**Apply** first shows a summary and a **Make a backup first?** checkbox, checked by default for every operation, regardless of **Keep .bak backups** in Settings. Leave it checked to copy the affected files into a backup in the editor's settings folder (`%APPDATA%\MKWiiAdvancedEditor\snapshots`). Uncheck it to write without creating a snapshot or `.bak` files for that operation. The same choice is offered for mod cups and preview videos.

![Apply window with a choice to back up the files before writing](docs/images/cups-apply.png)

**Backups** at the top of the window lists every backup, newest first, with its changes, date, number of files and size. **Restore…** puts the files back as they were before that change. The files as they are at that moment are backed up first, so a restore can be undone too. To return to the original game, restore the oldest backup. **Delete** removes only the copies; the game files are left as they are.

![Backups list with the cup change and its Restore button](docs/images/cups-backups.png)

### Slots of the original game

| Cup | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| Mushroom | `beginner_course` | `farm_course` | `kinoko_course` | `factory_course` | |
| Flower | `castle_course` | `shopping_course` | `boardcross_course` | `truck_course` | |
| Star | `senior_course` | `water_course` | `treehouse_course` | `volcano_course` | |
| Special | `desert_course` | `ridgehighway_course` | `koopa_course` | `rainbow_course` | |
| Shell | `old_peach_gc` | `old_falls_ds` | `old_obake_sfc` | `old_mario_64` | |
| Banana | `old_sherbet_64` | `old_heyho_gba` | `old_town_ds` | `old_waluigi_gc` | |
| Leaf | `old_desert_ds` | `old_koopa_gba` | `old_donkey_64` | `old_mario_gc` | |
| Lightning | `old_mario_sfc` | `old_garden_ds` | `old_donkey_gc` | `old_koopa_64` | |
| Wii Stages | `block_battle` | `venice_battle` | `skate_battle` | `casino_battle` | `sand_battle` |
| Retro Stages | `old_battle4_sfc` | `old_battle3_gba` | `old_matenro_64` | `old_CookieLand_gc` | `old_House_ds` |

### New cups

The game's own 8 race cups and 2 battle cups are fixed in its code: no file holds a list that could get a ninth. **New cup** under the game's cups therefore puts new cups into a mod that has its own list of cups:

- a mod you already have (a Pulsar pack or an LE-CODE distribution found in the workspace), or
- **a new cup pack**: give it a name (up to 14 letters, digits, - or _) and choose where to save it. The editor prepares one platform-independent **Riivolution** pack with the **Pulsar** engine (included, MIT License, see [vendor/pulsar/NOTICE.md](vendor/pulsar/NOTICE.md)): `<name>/` with the engine, menus and cups, `riivolution/<name>.xml`, and `<name>/HOW TO PLAY.txt`. The game's 8 cups come first and your cups follow.

The new mod opens with **My Cup 1** and four empty places: **+ Add a track** in each one draws a **new custom track** with the track generator, takes a track file, or the track open in the editor. A newly generated track is assigned to the chosen position automatically: no destination file needs to be chosen. Its complete SZS working copy is kept by the editor until **Apply** writes it into the pack. The 3D window says which cup position it belongs to; save any edits there before applying. Rename the cup (click its name), give it an icon (**Change icon…**), add more cups with **New cup**, then **Apply changes…**: the game and pack files stay unchanged until then. After that the window shows the mod like any other, and its names open in the game text editor.

You can apply a cup after adding just one track. If any positions are empty, **Apply changes…** asks which of the pack's tracks to repeat there, then shows the complete summary and backup choice. Each cup has four playable races; replace the repeated tracks whenever you are ready. Cancelling either step leaves the cup and files unchanged. Track errors still need to be fixed before applying.

**Keep original game cups** is checked by default in Pulsar packs: the original eight race cups coexist with your custom cups when the Riivolution pack is enabled. The sidebar lists **Original game cups** and **Custom cups** together; click an original cup to see its four tracks. Original tracks load from the base game and stay separate from the custom archives. This option can also enable the original cups in an existing Pulsar pack that hid them. **Apply changes…** saves the setting and updates this editor's generated play instructions.

Pulsar displays custom cups in pairs. An odd custom-cup count adds a repeated first cup to fill the pair (one custom cup therefore appears twice in the game). Add a second custom cup to give the other entry its own four tracks.

**To play:** after applying, click **Show Riivolution XML**, load `riivolution/<name>.xml` with Riivolution, set **Pack → Enabled** and launch Mario Kart Wii. Keep `<name>/` and `riivolution/` together in the pack's root folder. The generated XML enables Pack by default on its first launch; My Stuff stays off. Opening the original game normally does not load the extra cups. The Cups window keeps these instructions visible and offers **Open Riivolution editor…** for editing or exporting the patch.

![A new mod with its first cup, four tracks from a file and the Add a track buttons](docs/images/cups-new-mod.png)

The new cups exist only when the game is started with the mod (Riivolution on a Wii, or in Dolphin; the Riivolution mod editor can make a Dolphin launcher for the XML): the game started without it still has its 8 cups. For online play a Pulsar mod needs its own Wiimmfi region number, given by Wiimm: the editor writes 0, which is fine offline; set the real one with Pulsar's Pack Creator (it opens the mod's Config.pul).

![The game text editor opened on the name of a mod's cup](docs/images/cups-rename.png)

### Mods with their own cups

**Beta.** Editing the cups of mods and creating new cups is new: it was checked on copies of Insane Kart Wii (Pulsar) and of an LE-CODE distribution built from Wiimm's official binary, not yet in the game. Keep the backup the editor makes, and test the mod in Dolphin before sharing it.

Some mods replace the game's fixed cups with their own list, often hundreds of cups long. The Cups window reads and writes the two common kinds; **Cups of** at the top switches between the game's cups and the mod's, and **Open a mod…** opens one by hand.

| Mod | Where its cups are | Tracks | Names | Icons |
|---|---|---|---|---|
| **Pulsar pack** (Pulsar engine and Pack Creator, for example Insane Kart Wii) | `Binaries/Config.pul` of the pack folder | `Tracks/<cup × 4 + position>.szs`, mapped to Race/Course by the pack's Riivolution XML | In the BMG inside Config.pul: cups, tracks and authors | `Assets/UIAssets.szs` \u203A `button/timg/icon_NNNN.tpl`, one per cup |
| **LE-CODE distribution** (Wiimm's engine) | `rel/lecode-PAL.bin` (and USA, JAP, KOR) | `Race/Course/<slot>.szs`, the slot in hexadecimal (044, 045…) | Common.bmg of every language archive: track 0x7000 + slot, cup 0x6800 + cup | `ct_icons.tpl` in MenuSingle, MenuMulti and Channel, one 128-pixel square per cup |

A Pulsar pack is found by itself when the workspace is its Riivolution XML (Settings \u203A Game files \u203A Open Riivolution XML…) or a folder with `Binaries/Config.pul`; otherwise choose the Config.pul with **Open a mod…**. An LE-CODE distribution is found when its `rel` folder is in the workspace; **Open a mod…** on a `lecode-*.bin` makes its files folder the workspace.

![The 1208 cups of Insane Kart Wii with their icons, and the tracks of the first cup with their authors](docs/images/cups-pulsar.png)

- **Find** a cup by its name, the name of one of its tracks or an author; the list shows a page of cups at a time.
- **Tracks**: the same arrows and **Swap with…** as for the game's cups (the swap list is searched, because a pack has thousands of tracks). **Behaves like** chooses the original track whose game behaviour the track uses, and **Music of** the original track whose music it plays when the mod has none of its own. **Replace** takes a track archive from a file, the track open in the editor, or **New track (generator)…**: draw a track with its course model, sky, minimap and collision included, and it is assigned directly to that position. Its own 3D editor window saves a working copy before Apply and the cup's actual archive afterwards. **Rename…** (the game text editor for names already in the mod) and, in Pulsar packs, **Author…** change the names. An empty place of a new cup has **+ Add a track**.
- **Cups**: click the name to rename a cup (in the game text editor when the name is already in the mod; Pulsar names are kept inside Config.pul and written back there), **Change icon…** takes a picture (resized to the mod's icon size), **Cup up** / **Cup down** move the whole cup with its four tracks, **New cup** adds one at the end, and **Remove** takes away the last cup (move a cup to the end first: removing one in the middle would renumber every track after it).

![A new cup with its own icon and four tracks from a file, ready to apply](docs/images/cups-pulsar-new.png)

**Apply** works as for the game's cups: a summary, a backup of every file (asked when `.bak` backups are off), then the files are written. In a **Pulsar pack**: the moved and new track archives in Tracks, the expert ghosts that belong to moved tracks, Config.pul (cups, names, authors, alphabetical order, icon count) and UIAssets.szs when icons change. A pack with an odd number of cups is written like the Pack Creator writes it. In an **LE-CODE distribution** a cup only lists its four track slots: moving a track changes the lists, not the files; a track from a file gets the next free slot (from 0x44) and its archive in Race/Course; every region's `lecode-*.bin` is written in place, within the room the distribution tool reserved for cups and slots. In both, only the cups and tracks change: the mod's other settings (engine classes, online settings, item rules…) are kept byte for byte.

![The cups of an LE-CODE distribution with a new cup of four tracks](docs/images/cups-lecode.png)

## Preview videos

The menus play THP movies from the game's `thp` folder: JPEG pictures, 60 per second, sometimes with sound. To save memory, one movie often holds several previews: `thp/course/kinoko.thp` has the four tracks of the Mushroom Cup one above the other (400×144 pixels each), and the menu shows only the part of the track you point at. `cup_select.thp` has one picture per cup, `battle_wii.thp` and `battle_retro.thp` one per arena. *Tools › Preview videos (THP)…* (also on Home) edits them; **How it works** at the top explains this inside the window.

![Preview videos: the Mushroom Cup video with Coconut Mall's preview in Luigi Circuit's part](docs/images/thp.png)

1. Choose a video on the left. The movies are grouped by folder with readable names (*Mushroom Cup tracks*, *Cup selection*, *Title screen*…). **Open another THP…** opens any other THP file.
2. **Play**, pause and drag the frame slider. Under the player: size, frame rate, length and sound.
3. Click a part on the video (each one is outlined and named with the track, cup or arena it shows), or choose it on the right; **Whole video** is the full picture.
4. Replace it:
   - **Picture…**: a still image (PNG, JPEG, WebP, BMP, GIF) for the whole movie;
   - **Video file…**: an MP4 (H.264) or WebM, played from its start and repeated to the movie's length; for a custom track, record a lap in Dolphin and cut a few seconds;
   - **From another preview…**: a part of another THP, for example *Flower Cup 2 · Coconut Mall* into Luigi Circuit's part.

   **Fill** crops the source to the shape of the part, keeping its proportions; **Stretch** squeezes all of it in. **Back to the original** undoes the part. The player shows the result at once.
5. **Save video…** shows the changes, makes a backup (asked when `.bak` backups are off in Settings) and encodes all frames again. Each frame is kept within the size of the original's largest frame, because the game reserves memory for that size; the parts you did not change are encoded again too, at a quality close to the original. Frame count, frame rate and sound stay as they were. **Backups** puts the old video back.

**Save this frame as PNG…** exports the frame shown. The editor reads the game's THP 1.1 movies, with or without sound (the sound is kept as it is); the THP frames are JPEG written without byte stuffing, which the editor converts in both directions. An unchanged movie rebuilds byte for byte (checked on the movies of the game).

## Creating a new track

*File › Create new track* (Ctrl+N, or **New track** on Home) builds a drivable track from a layout drawn from above. The window has three steps, as tabs on the right; **Next step** moves through them, and **Generate track** works from any step.

![Create a new track: the oval layout with its control points, the height profile under it, the Shape step and the Check box](docs/images/track-generator.png)

**1 · Shape.** Start from a ready shape (each one says what it is), or choose **Draw by hand** and trace the whole track with the mouse in one stroke. Where you start is the finish line, and the end joins the start by itself. When you release the button, the line becomes control points.

![A figure of eight being drawn by hand in the track generator](docs/images/track-generator-draw.png)

Then shape the layout with **Edit points**:
- drag a point to move it; the cursor shows a hand over a point and a yellow **+** on the road where a click adds a new point;
- right-click a point, or select it and press **Delete**, to remove it; the arrow keys nudge the selected point (Shift: further);
- the selected point's **Height** raises the road there (hills, dips, bridges) and **Width ×** makes the road wider or narrower there; the **height profile** under the drawing shows the road's height from the start line round to it again, with a dot for each point;
- the toolbar can **undo** and **redo** (Ctrl+Z / Ctrl+Y) any change to the layout, **reverse** the driving direction, make the whole layout **smaller** or **larger** by 10%, and **fit** it in the view. The wheel zooms; middle-drag or Alt+drag pans. One grid square is 5000 units, about 17 karts.

**2 · Road.** Road width (shown in karts, a kart is about 300 units wide), off-road grass on both sides, walls and their height, and the number of boost panels (placed on the straightest parts).

**3 · Race.** Laps, rows of item boxes, key checkpoints (they stop drivers from cutting across), checkpoint spacing and how often a respawn point is placed. With a track archive open, **Keep the other files of the open SZS** reuses its models, sky and effects so the new track can be played straight away.

**Check.** The box under the steps checks the layout as you change it, and marks the places on the drawing. What would break the track is handled by the generator itself, so you can draw freely:
- *blue*, **the road crosses itself**: one side becomes a **bridge**, high enough to drive under (the wall height plus 800, plus a margin), with gentle ramps on both sides (the steepest part is well below what karts can climb). The side that is already higher goes over; when both are at the same height, the later part of the lap does. To choose, raise a point of that side with **Height**. The height profile under the drawing shows the bridge.
- *blue*, **turns tighter than the road is wide**: the inside of the turn (road and grass) is made narrower there, so its edge stays short of the centre of the turn and never folds over; the outside keeps its width. The checkpoints and item boxes follow the narrower road.
- *blue*, **slopes too steep to climb**: the height change is spread over a longer stretch.
- *orange*: a very short track (a lap of a few seconds).

Only a layout with fewer than 3 points cannot be generated.

![A hand-drawn figure of eight without a bridge: the crossing is circled in blue and becomes a bridge, which the height profile shows](docs/images/track-generator-check.png)

After **Generate track**, the editor opens the new track with its collision, start, checkpoints, routes, respawns, item boxes and cameras. The visible track model (`course_model.brres`), a basic sky (`vrcorn_model.brres`) and the minimap (`map_model.brres`, including its position bounds) are generated automatically with embedded textures using the included converter; Blender is not required. Save the SZS, then use **Cups and tracks…** to assign it to a cup. Creation from a cup position saves and assigns the complete track directly. **File › Export › Generated track model (OBJ)** is still available for external editing.

## Collision editor

`course.kcl` is the invisible surface the karts actually drive on. Every triangle has a **type** (road, off-road, wall, boost, fall boundary, cannon…) plus a **variant** and a **shadow** value that fine-tune sounds, effects and lighting. Open the **Collision** tab in the left sidebar; it has three modes.

### Show
- Lists the surface types used by the track with their colour and triangle count. Click a type to hide or show it (fall boundaries start hidden so they do not cover the track).
- Opacity and triangle edges of the collision view.
- The toolbar above the 3D view switches between the track model, the collision, or both.

### Paint
1. Choose **Paint**. Track markers are hidden and the collision is drawn over the track model at 55% opacity (the same as **Both**); change it with **Opacity**, or turn off **Track model** to see the collision alone.
2. Pick a surface type in the palette. Hovering a colour explains what it does in the game.
3. Pick a brush:
   - **Triangle**: the triangle under the cursor.
   - **Round**: every triangle within the radius.
   - **Fill**: the connected area of the same type as the clicked triangle.
   - **Flat area**: connected triangles lying on the same plane.
4. Click or drag on the 3D view. The triangle under the cursor is outlined in white. Each stroke is one undo step.

The colours always show the collision surface nearest to the camera, drawn over the model even where the model and the collision do not line up exactly, so the triangle you paint is the one that changes colour.

### Edit: drawing new collision
1. Choose **Edit** and the **Surface of new shapes**.
2. Pick a shape and click on the track. A yellow preview follows the cursor.

| Shape | Clicks | Notes |
|---|---|---|
| Triangle | 3 corners | |
| Rectangle | 2 corners of one side, then the width | Follows slopes: ramps and floors |
| Wall | 2 points on the ground | Rises by **Height** |
| Box | 2 opposite corners on the ground | Rises by **Height**, closed on every side |
| Cylinder | Centre, then a point on the edge | **Height** and **Segments** |
| Sphere | Centre, then a point on the surface | **Segments** |
| Polygon | Any number of corners | **Enter**, or a click on the first corner, closes it; concave outlines are fine |

3. **Backspace** removes the last point, **Esc** cancels.
4. When the shape is complete it is split into triangles and selected. Floors and walls face the camera; boxes, cylinders and spheres face outwards.

### Edit: changing existing triangles
- Click a triangle to select it, **Shift+click** to add, **Ctrl+click** to toggle, **Shift+drag** to select an area.
- Move, rotate or scale the selection with the gizmo (**W / E / R**), or type the coordinates of each vertex of a single triangle.
- Change the surface type of all selected triangles at once, **Duplicate**, **Flip normal** or **Delete** them.

### Import, export and saving
- **Replace with OBJ…** builds the collision from a 3D model, with a material → type table (names such as `road`, `grass`, `wall`, `boost` or `0x000C` are recognised). **Replace with KCL…** loads another `course.kcl`. **Export as OBJ…** writes the collision with one material per type.
- Every change can be undone. When saving, only the flags are patched if no triangle moved; otherwise the KCL is rebuilt (positions, normals, prisms and octree).
- The KCL format holds 65,534 triangles. Detailed, curved models need about four different surface directions per triangle and the format stores at most 65,535; when a course needs more, directions closer than a small step are merged (the step grows only as far as needed), so a course of 64,800 triangles is written with corners on average 0.3 units from the model.
- Cannons: paint the launch area with **Cannon Activator**; its variant is the ID of the Cannon destination the player is shot to.

## Riivolution mod editor

[Riivolution](https://riivolution.github.io/) loads a mod from an SD card (or from a folder in Dolphin) without changing the game disc: an XML in `riivolution/` lists the options of its menu and, for each option, the files, folders and memory values it replaces. *Tools › Riivolution mod…* (also on Home) writes that XML and the folder that goes with it.

![Riivolution mod editor: PAL region selected, patch checkbox ticked and files edited in the workspace listed](docs/images/riivolution.png)

### Making a mod from your edits
1. Edit and save tracks, characters, objects, game text or sounds as usual. The editor records saved files; with backups enabled, it also keeps a `.bak` of the original beside each one.
2. Open *Tools › Riivolution mod…*. A new mod already lists those files, each under its path on the disc (for example `/Race/Course/beginner_course.szs`) and on this computer. **Add edited workspace files** adds files saved later; **Add file…** and **Add folder…** add anything else (a file inside the workspace gets its disc path automatically, others ask for it).
3. Give the mod a name. The name sets the XML file (`riivolution/<Name>.xml`), the patch ID and the mod folder on the SD card (`/<Name>`); they follow the name until you change them by hand.
4. **Export mod folder…** and choose the SD card, or any folder. The editor writes the XML and copies every file into the mod folder where the XML points. Copy the folder's contents to the root of the SD card, start Riivolution, turn the option on and launch.
5. For Dolphin, turn on **Dolphin launcher** and choose your game image (`.wbfs`, `.iso`, `.rvz`…): Export also writes a `.json` launcher. Put it in a folder of Dolphin's game list; Dolphin shows it as a game and starts it with the mod.

### Options, choices and patches
The left side is the menu Riivolution shows: **sections**, the **options** in each section (with **On** for options that start enabled) and the **choices** of each option. Tick the checkbox beside a patch ID under **applies** to add that patch to a choice; untick it to remove it. An option with two choices, for example, can switch between two sets of files. **Regions** next to Game ID lets you select Europe (P), Americas (E), Japan (J) and Korea (K), including multiple regions. **All regions** omits the region restriction from the XML. Region codes already present in an imported XML remain available.

The right side lists the **patches**. A patch has an ID, a **mod folder** (`root`: the folder on the SD card its paths start from) and its entries:
- **file** — a disc file replaced by a file of the mod folder;
- **folder** — the files of a disc folder replaced by those of a mod folder;
- **memory** — a value written in memory at an address, optionally only when the old value matches;
- **savegame** and other elements of an existing XML are kept and shown as they are.

**Open XML…** reads an existing Riivolution XML. Elements the editor does not know are kept when it is saved again, and when the XML sits in a `riivolution/` folder the editor finds its files from that SD root, so the mod can be changed and exported again. **Save XML…** writes only the XML.

To use the mod's files across the main editor (tracks, models, game text and audio), choose **Workspace › Open Riivolution XML…** on Home or in Settings. This resolves the XML's disc paths to the corresponding files in the mod folder even when there is no extracted-game `files` directory. Only mapped, existing resources appear.

![An existing Riivolution pack with PAL and Americas regions, patch checkboxes for each choice and a folder patch](docs/images/riivolution-xml.png)

The footer lists problems that keep a mod from loading: no game ID (`RMC` is Mario Kart Wii in every region; `RMCP`, `RMCE`, `RMCJ` or `RMCK` limit it to one), no section, options using a patch that does not exist, entries without a path. Closing with changes that were not saved or exported asks first.

## Archive compatibility

| File or wrapper | Where it works | Requirement |
|---|---|---|
| Yaz0 and YLZ (`.szs`) | Tracks, `Common.szs`, game text, UI layouts, character and object models, model parts | Built in |
| WLZ/WBZ/WU8 and YBZ (`.szs`, `.wlz`, `.wbz`, `.wu8`) | The same archive readers, including the track list of Cups and tracks and direct file opening | Built in; WU8, WBZ and WLZ need the original game's `Race/Course` tracks or an existing auto-add library |
| U8, KMP, KCL, BRRES | Track archive contents, route/object data, collision and models | Built in after an archive is decoded |
| BMG, BRFNT and UI layouts | Game text and its preview | The corresponding `Scene/UI` game files |
| BRSTM and BRSAR | Music streams, sound effects, voices and instrument samples | Built in; replacement accepts BRSTM or audio the system browser can decode (for example WAV, MP3, Ogg, FLAC and AAC) |
| OBJ, FBX, glTF/GLB, DAE, STL, PLY and BLEND | Model import and conversion | OBJ uses included ABMatt; the other formats also need Blender |

For WLZ/WBZ/WU8, load your extracted original game's `Race/Common.szs` or select its `Race/Course` folder in **Settings › Game files**. The editor reads the required object files directly from those tracks; it does not include Nintendo game files. An existing auto-add library under the editor's settings directory also works. The included Wiimm `wszst.exe` is used as a fallback when native reconstruction fails. A reconstructed archive is edited in memory and **Save** writes a regular Yaz0 SZS; a `.wlz`, `.wbz` or `.wu8` file is saved as a new `.szs` beside it. With backups enabled, the original WLZ is kept as `.bak` on first save. Original tracks from another game or missing object files cannot supply the required data. Audio codecs that the system browser cannot decode need conversion to WAV, FLAC or BRSTM first.

## Requirements

- **Normal use on Windows**: download and run `MKWiiAdvancedEditor.exe` on Windows 10/11 x64 (Windows on ARM runs it through emulation). The editor, its Bun runtime, the interface, ABMatt and the Wiimm commands it needs are included in that one file. No separate installation of Bun, ABMatt or Wiimm's SZS Tools is needed. Select your extracted game's `files` folder in **Settings › Game files** when you want to use its tracks and resources; the game files are not included in the editor.
- **Microsoft runtime components**: the native window uses two components that are already present on many Windows PCs:
  - the **WebView2 Runtime**, part of Windows 11 (on Windows 10 it comes with Microsoft Edge updates, or from [Microsoft](https://developer.microsoft.com/microsoft-edge/webview2/));
  - the **Visual C++ Redistributable (x64)**, used by the window library and installed by most programs and games. If either component is missing, the editor opens in Microsoft Edge instead; install [WebView2](https://developer.microsoft.com/microsoft-edge/webview2/) and/or [Visual C++ (x64)](https://aka.ms/vs/17/release/vc_redist.x64.exe) to use the normal window.
- The executable is not code-signed: the first time, Windows SmartScreen may show "Windows protected your PC". Choose *More info › Run anyway*.
- Some WebView2 versions crash with the default Direct3D 11 graphics on some GPU drivers. The editor then starts again with Vulkan, then with software rendering, and remembers the working choice until WebView2 is updated.
- To run from source or build, rather than use the EXE: [Bun](https://bun.sh) 1.4.3 or newer (`bun upgrade` updates it).
- The Windows executable includes the command-line versions of [ABMatt](https://github.com/Robert-N7/abmatt) and [Wiimm's SZS Tools](https://szs.wiimm.de/) (`wszst` and `wimgt`). On first launch, it extracts them to the editor's settings folder under `%APPDATA%`; no separate installation is needed. Existing installations can still be used, and `MKWII_ABMATT` or `MKWII_WSZST` can select a specific executable. Their licenses and source archives are included; see [the bundled-tool notice](vendor/NOTICE.md).
- To open WU8, WBZ or WLZ archives, provide your extracted original game's `Race/Course` tracks in **Settings › Game files**. YBZ opens without those tracks.
- **Optional formats**: importing BLEND, FBX, glTF, GLB, DAE, STL or PLY also requires [Blender](https://www.blender.org/) installed in its normal Windows location, available on `PATH`, or pointed to by `MKWII_BLENDER`. OBJ import works with the included ABMatt tool. Animated imports also require RiiStudio's `rszst.exe`. Blender 5 removed COLLADA, which DAE files, rigged or animated models and standalone BRRES conversion still need: keep Blender 4.5 LTS installed beside it and the editor uses it for those models. These extra programs are not required to open and edit ordinary tracks or import OBJ models.

## Running

```bash
bun install
bun start            # builds the UI and opens the editor window
```

Other modes:

```bash
bun run dev                          # opens the UI in Edge (app mode) instead of the native window
bun run src/main.ts --server-only    # only prints the local URL
bun run src/main.ts path\to\track.szs   # opens a file directly
```

## Building the executable

```bash
bun run build
```

This creates `release/MKWiiAdvancedEditor.exe`: a single file with the runtime, the UI, the WebView library, ABMatt and Wiimm's command-line tools inside. The file passed on the command line is opened at startup. The executable uses Bun's *baseline* runtime (it runs on every x64 CPU): the build downloads `bun-windows-x64-baseline.zip` of the same Bun version from the Bun releases, checks it against their `SHASUMS256.txt` and keeps it in `.cache/`.

The [Windows build workflow](.github/workflows/build-windows.yml) installs the dependencies, runs the tests and `bun run build`, then uploads the EXE and its SHA-256 file as an artifact. It publishes them in two ways:
- **Every push to `main` without a version tag** replaces the **Auto** pre-release (tag `auto`) with the build of that commit, so the newest executable is always at [Releases › Auto](https://github.com/WiiListZ/mkwii-advanced-editor/releases/tag/auto). Its notes name the commit. Being a pre-release, it is not offered by the in-app updater.
- **A version tag** matching `package.json` (for example `git tag v1.1.0 && git push origin v1.1.0`) publishes that version as a GitHub Release with generated notes. This is what the in-app updater offers.

To serve in-app updates, run that workflow in the [WiiListZ repository](https://github.com/WiiListZ/mkwii-advanced-editor); releases in another fork are not used by the updater.

To open files by double-clicking them, use **Settings › Game files › Associate Mario Kart Wii files** in the built exe; this includes `.brstm` and `.brsar`. Explorer shows each type by what it is (for example Wii music stream or sound archive). Registration applies to your Windows user only (no administrator rights) and adds the editor to the "Open with" menu. Windows may keep a previously chosen default app; if so, right-click one of each file type › Open with › MKWii Advanced Editor › Always once.

## Tests

```bash
bun test                                     # formats (THP rebuilt byte for byte; Pulsar Config.pul and LE-CODE binaries, also real ones with MKWII_PULSAR_DIR / MKWII_LECODE_BIN), audio export (MP3, AIFF, M4A), generator and its layout check, cups and their backups, validator, editing operations
bun run tests/server.smoke.ts                # local server and API
bun run tests/ui.smoke.ts <screenshot-dir>   # real UI in headless Edge: clicks, gizmo drag, title bar, save + reopen
bun run tests/release-notes.smoke.ts [dir]   # release notes as Markdown: shown once after an in-app update, from the update offer and About
bun run tests/object-info.smoke.ts            # object documentation downloaded from the object-info repository (simulated), and offline
MKWII_GAME_DIR=<extracted game>/files bun run tests/map2d.smoke.ts # 2D map editing, undo, save and reopen on a real track
MKWII_GAME_DIR=<original game>/files MKWII_MOD_TRACK=<custom track>.szs bun run tests/map2d-mod.smoke.ts # 2D map background for custom tracks
MKWII_GAME_DIR=<extracted game>/files bun run tests/ui.real.smoke.ts <screenshot-dir> castle_course.szs   # real tracks, models, animations
MKWII_GAME_DIR=<extracted game>/files bun run tests/audio.smoke.ts       # audio preview, exports in every format (decoded back and compared) and replacements on a temporary copy
MKWII_GAME_DIR=<extracted game>/files bun run scripts/capture-overview.ts # refresh Home and audio screenshots
MKWII_GAME_DIR=<extracted game>/files bun run tests/model-parts.smoke.ts <screenshot-dir>   # copy game model parts through the UI (uses included ABMatt on Windows)
MKWII_GAME_DIR=<extracted game>/files bun run tests/import-material-animation.smoke.ts # Blender Mapping/colour → SRT0/CLR0
MKWII_GAME_DIR=<extracted game>/files bun run tests/import-weights.smoke.ts           # two bone influences in a real course
MKWII_GAME_DIR=<extracted game>/files bun run tests/import-shapes.smoke.ts            # Blender shape key → vertex sets + SHP0
MKWII_GAME_DIR=<extracted game>/files bun run tests/auto-collision.smoke.ts           # collision generated from a model part and an object
MKWII_GAME_DIR=<extracted game>/files bun run tests/assets.smoke.ts                   # Characters and models: preview, animations, save and copies
MKWII_GAME_DIR=<extracted game>/files bun run tests/track-resources.smoke.ts          # track object saved into the open track and its _d copy
MKWII_GAME_DIR=<extracted game>/files bun run tests/game-text-screens.smoke.ts <dir>  # game text on the game's own screens
MKWII_GAME_DIR=<extracted game>/files bun run tests/riivolution.smoke.ts              # Riivolution XML, mod folder export and Dolphin launcher
MKWII_GAME_DIR=<original game>/files MKWII_WLZ_FILE=<WLZ track>.szs bun run tests/wiimm.smoke.ts # WLZ open, Yaz0 save, both backup settings and edit tracking
MKWII_GAME_DIR=<extracted game>/files bun run scripts/capture-riivolution.ts          # refresh the Riivolution screenshots
MKWII_GAME_DIR=<extracted game>/files bun run scripts/capture-tools.ts                # refresh the archive, effects, parameters, sky, skeleton and Home tool screenshots
MKWII_GAME_DIR=<extracted game>/files bun run scripts/capture-models.ts               # refresh the skeleton, 3D export, all-animations, Check and new-track screenshots
MKWII_GAME_DIR=<extracted game>/files MKWII_PULSAR_DIR=<Pulsar pack folder> MKWII_LECODE_BIN=<lecode-PAL.bin> bun run scripts/capture-mod-cups.ts # cups of a Pulsar pack and an LE-CODE distribution on temporary copies: swap, new cup, apply, files checked
MKWII_GAME_DIR=<extracted game>/files bun run scripts/capture-cups.ts                 # on a temporary copy: cups (swap, replace, preview videos, apply, check, restore), the preview video editor (save and read back), the audio export menu and the track generator screenshots
```

Run screenshot scripts and tests with `bun run --preload ./scripts/readme-privacy.ts …`: before each screenshot it shortens absolute paths on the page (the game folder shows as `Mario Kart Wiiiles`) and refuses the screenshot if the user name, the home folder or a drive path is still visible.

```bash
MKWII_GAME_DIR=<extracted game>/files bun test tests/effects-params.test.ts          # effects and game data on a real track
MKWII_GAME_DIR=<extracted game>/files bun test tests/gamebin.test.ts                 # every .bin, .bcp, .bsp, .blight and .blmap of the game opens with its documented layout
```

The KCL tests check every triangle against an emulation of the game's own octree lookup. The UI tests keep their settings and files in a temporary folder.

The bundled-tool and archive support was also checked against an extracted Mario Kart Wii game, using its `files/Race/Common.szs` and `files/Race/Course` tracks. The model-parts smoke test used the included ABMatt to copy parts from another track and `Common.szs`, then saved and reopened a temporary SZS. Wiimm's included `wszst` produced WBZ, WLZ, WU8 and YBZ copies of a real track; the editor's native decoder reconstructed all four to exactly the same uncompressed U8 bytes as the original. The original game files were read only during these checks.

## Mouse and keyboard

| Input | Action |
|---|---|
| Right drag / Middle drag / Wheel | Free look (the cursor is hidden while looking: **Settings › Camera › Hide cursor while looking**, on by default) / Pan / Zoom towards the cursor |
| Wheel while holding the right button (or while flying with WASD) | Change the camera speed |
| Click the 3D view, then WASD + Q/E | Fly and move vertically without holding a mouse button (Shift = faster) |
| Alt + left drag | Orbit (for laptops) |
| Left click, Shift/Ctrl + click, drag on empty space | Select, add/toggle, box select |
| W / E / R (outside the focused 3D view) | Move / Rotate / Scale |
| G | Snap selection to the ground |
| F, Home, T | Focus selection, frame track, top view |
| A | Add a point after the selected route point / checkpoint |
| Ctrl+C / Ctrl+V | Copy / paste the selection (points, objects, areas… or a track model object); in the 2D map it pastes under the mouse |
| Q / E (2D map) | Turn the selection by 15° (Shift: 90°) |
| Ctrl+D | Duplicate the selection |
| Ctrl+X / Del | Delete the selection |
| Ctrl+A | Select all of the same kind |
| Ctrl+Z / Ctrl+Y | Undo / Redo |
| Ctrl+O / Ctrl+S / Ctrl+Shift+S / Ctrl+N | Open / Save / Save as / New track |
| Ctrl+, (or the gear button next to Help) | Settings |
| Ctrl+PageUp / Ctrl+PageDown | Previous / next track of the tracks folder |
| Right click (no drag) | Context menu |
| K / Space / , . / ← → (Cameras tab) | Add or update the intro keyframe at the playhead / play or stop the intro / previous or next keyframe / move the playhead one frame (Shift: one second) |

## Project layout

```
src/              Bun backend: native frameless window, local server (worker), Windows file dialogs
web/src/          React UI (shadcn/ui components in components/ui, app screens in app/)
web/js/formats/   Yaz0, U8 (SZS), KMP, KCL, BRRES (MDL0/TEX0/PLT0/CHR0/SRT0/PAT0/CLR0), BMG, BRFNT, BRLYT, THP, OBJ and Riivolution XML
web/js/editor/    document + history, 3D viewport, real/procedural models, editing operations, validator, track generator
scripts/          build scripts (Bun bundle + Tailwind CSS + executable)
tests/            unit tests (bun test) and smoke tests
```

The backend listens on `127.0.0.1` only, on a random port. Every API call needs a token that is generated at startup.

## Sources and references

The file formats and the game behaviour follow the public documentation of the Mario Kart Wii modding community, checked against the original game files (the round-trip and smoke tests in `tests/` use them):

- [Custom Mario Kart Wiiki (Tockdom)](https://wiki.tockdom.com/): [KMP](https://wiki.tockdom.com/wiki/KMP_(File_Format)) (every section, including CAME cameras and the area types), [KCL](https://wiki.tockdom.com/wiki/KCL_(File_Format)) and the [collision flags](https://wiki.tockdom.com/wiki/KCL_(File_Format)#Collision_Type), [U8 archives](https://wiki.tockdom.com/wiki/U8_(File_Format)), [Yaz0](https://wiki.tockdom.com/wiki/YAZ0_(File_Format)), [BRRES](https://wiki.tockdom.com/wiki/BRRES_(File_Format)) with [MDL0](https://wiki.tockdom.com/wiki/MDL0_(File_Format)), [TEX0](https://wiki.tockdom.com/wiki/TEX0_(File_Format)), [CHR0](https://wiki.tockdom.com/wiki/CHR0_(File_Format)), [SHP0](https://mkwiiki.org/wiki/SHP0), [SRT0](https://wiki.tockdom.com/wiki/SRT0_(File_Format)), [PAT0](https://wiki.tockdom.com/wiki/PAT0_(File_Format)) and [CLR0](https://wiki.tockdom.com/wiki/CLR0_(File_Format)), [BLIGHT](https://wiki.tockdom.com/wiki/BLIGHT_(File_Format)), [BMG](https://wiki.tockdom.com/wiki/BMG_(File_Format)), [BRFNT](https://wiki.tockdom.com/wiki/BRFNT_(File_Format)), [ObjFlow.bin](https://wiki.tockdom.com/wiki/ObjFlow.bin), [the list of objects](https://wiki.tockdom.com/wiki/List_of_Objects), the kart files (`bsp`, `kartDriverDispParam.bin`), [kartParam.bin](https://wiki.tockdom.com/wiki/KartParam.bin), [driverParam.bin](https://wiki.tockdom.com/wiki/DriverParam.bin), [ItemSlot.bin](https://wiki.tockdom.com/wiki/ItemSlot.bin) and the NW4R effect files ([BREFF](https://wiki.tockdom.com/wiki/BREFF_(File_Format)), [BREFT](https://wiki.tockdom.com/wiki/BREFT_(File_Format))).
- [MKWiiki](https://mkwiiki.org/) (the same wiki under its new address) for the game data files: [ObjFlow.bin](https://mkwiiki.org/wiki/ObjFlow.bin), the [GeoHitTable](https://mkwiiki.org/wiki/GeoHitTable) files, [kartParam.bin](https://mkwiiki.org/wiki/KartParam.bin), [kartCameraParam.bin](https://mkwiiki.org/wiki/KartCameraParam.bin), the `*DispParam.bin` files, the CPU files [kartAIActionParam.bin](https://mkwiiki.org/wiki/KartAIActionParam.bin) and [kartAISpdParam.bin](https://mkwiiki.org/wiki/KartAISpdParam.bin), [DriverIKParam.bin](https://mkwiiki.org/wiki/DriverIKParam.bin), [IconParam.bin](https://mkwiiki.org/wiki/IconParam.bin), [machine_para.bin](https://mkwiiki.org/wiki/Machine_para.bin), [mission_ui_single.bin](https://mkwiiki.org/wiki/Mission_ui_single.bin), [DummyDistributionMap.bin](https://mkwiiki.org/wiki/DummyDistributionMap.bin), [BCP](https://mkwiiki.org/wiki/BCP), [BSP](https://mkwiiki.org/wiki/BSP), [BLIGHT](https://mkwiiki.org/wiki/BLIGHT), [BLMAP](https://mkwiiki.org/wiki/BLMAP) and the [list of identifiers](https://mkwiiki.org/wiki/List_of_Identifiers). Where a page leaves out the order of rows (for example `kartDriverDispParam.bin`), it was checked against the original files.
- The [Mario Kart Wii decompilation](https://github.com/riidefi/mkw) for the names of vehicle parameters the wiki leaves out.
- [Wiimm's SZS Tools documentation](https://szs.wiimm.de/) for KMP/KCL details, BMG message IDs and escape codes; their source (included with the bundled tools, `src/lib-lecode.h`) for the LE-CODE binary, and the [LE-CODE distribution tutorial](https://mkwiiki.org/wiki/LE-CODE/Distribution_Tutorial) for its file names, BMG IDs and cup icons.
- The [Pulsar sources](https://github.com/MelgMKW/Pulsar) (`PulsarEngine/Config.hpp`, the Pack Creator's `IO/Builder.cs` and `Importer.cs`) for Pulsar's Config.pul, its track files, names and cup icons; checked against Insane Kart Wii (its Config.pul rebuilds byte for byte).
- GameCube/Wii graphics (TEV stages, texture formats, swap tables, alpha test, blending): [YAGCD](https://www.gc-forever.com/yagcd/), the [libogc](https://github.com/devkitPro/libogc) GX headers and the [Dolphin emulator](https://github.com/dolphin-emu/dolphin) TEV emulation.
- Command-line tools included in the Windows executable: [ABMatt](https://github.com/Robert-N7/abmatt) and [Wiimm's SZS Tools](https://szs.wiimm.de/). [RiiStudio](https://github.com/riidefi/RiiStudio) and [Blender](https://www.blender.org/) are used when installed for the formats that need them.
- Windows: Microsoft's [WebView2](https://learn.microsoft.com/microsoft-edge/webview2/) documentation (runtime, browser arguments) and the Win32 window messages (`WM_NCCALCSIZE`, `WM_NCLBUTTONDOWN`, `WM_SETICON`) and resource APIs (`UpdateResource`) from [Microsoft Learn](https://learn.microsoft.com/windows/win32/).
- Libraries: [Bun](https://bun.sh), [webview-bun](https://github.com/tr1ckydev/webview-bun), [Three.js](https://threejs.org/), [React](https://react.dev/), [shadcn/ui](https://ui.shadcn.com/) with [Radix](https://www.radix-ui.com/), [Tailwind CSS](https://tailwindcss.com/), [lucide](https://lucide.dev/), [sonner](https://sonner.emilkowal.ski/), [cmdk](https://cmdk.paco.me/) and [Puppeteer](https://pptr.dev/) for the tests.

Where the documentation was incomplete (camera speeds, the second byte of the CAME header, BRFNT glyph cells), the behaviour was measured on the original tracks and files.

## Notes and limitations

- Model editing moves and duplicates existing BRRES parts and separate connected pieces within a part. Pieces that share vertices cannot be moved independently. Direct vertex sculpting and changing material settings are not available yet. Indexed palette textures (C4/C8/C14X2) cannot be replaced with PNG through the Inspector. The track generator creates its own basic track model, sky and minimap; these can be edited or replaced afterwards. You can also keep the models of an existing SZS: missing model resources are generated automatically.
- Custom courses require a usable course model, KMP, KCL and referenced object resources. Generated models use simple colours and a basic sky; add scenery and detailed textures for a finished course. SHP0 playback on `course_model.brres` has only been checked structurally, not in Dolphin or on a Wii.
- The effect preview in the 3D view is approximate (see *Real game graphics*), and the effects editor changes emitter and particle values and textures; it does not add or remove emitters or edit their animation curves. The game parameter editor changes values only; files with a different layout (some mods add vehicles) are not offered.
- Object IDs and names come from the game's `ObjFlow.bin`. Load `Common.szs` once to get them all. The meaning of the eight object settings depends on the object; see the [Tockdom wiki](https://wiki.tockdom.com/).
- Generated cameras and area sizes follow the common community documentation (areas are 10000 units per unit of scale). The intro preview reproduces the opening cameras closely; replay cameras follow the kart in the game, so their preview is an approximation.
- Use only game files you dumped legally. This project is not affiliated with Nintendo.

## License

MKWii Advanced Editor is free software released under the [MIT License](LICENSE): anyone may use, copy, modify, share and sell it, as long as the copyright notice and the license text are kept.

The *Mario Kart Wii* interface font option uses [M PLUS 1](https://github.com/coz-m/MPLUS_FONTS) by the M+ FONTS Project, bundled under the SIL Open Font License 1.1 (`fonts/OFL.txt`); it is a free font in the style of the game's menu lettering, not the game's own font.

The built-in bzip2 decoder uses [seek-bzip](https://github.com/cscott/seek-bzip) under the MIT License (copyright C. Scott Ananian, Eli Skeggs and Kevin Kwok). MP3 export uses [lamejs](https://github.com/zhuker/lamejs) (the [@breezystack/lamejs](https://www.npmjs.com/package/@breezystack/lamejs) package), a JavaScript port of the LAME encoder, under the GNU LGPL 3.0. Tool extraction uses [fflate](https://github.com/101arrowz/fflate) under the MIT License. The WU8 object-name list follows [Wiimm's public SZS file database](https://github.com/Wiimm/wiimms-szs-tools); it contains file names only, not game assets. Bundled ABMatt and Wiimm's SZS Tools are distributed under their own GPL licenses, detailed in [vendor/NOTICE.md](vendor/NOTICE.md).

The license covers this editor's own code only. Mario Kart Wii and its files belong to Nintendo and are not included or licensed here.
