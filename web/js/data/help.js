// Every explanation shown in the editor (tooltips, inspector descriptions, help center, guided tour).

// ---- Track elements ----------------------------------------------------------------------
export const KIND_HELP = {
  STGI: {
    title: 'Track settings',
    what: 'Global settings of the track: number of laps, where the karts line up and the lens-flare colour.',
    tips: ['Most tracks use 3 laps.', 'The speed multiplier works like the 150cc / 200cc speed mods: leave it at 1.0 for normal races.'],
  },
  KTPT: {
    title: 'Start position',
    what: 'Where the race starts. With player index -1 the game places all 12 karts in a grid behind and around this point, facing its rotation.',
    tips: ['Place it a little behind the lap checkpoint (finish line).', 'Only the Y rotation matters: it is the direction the karts face.', 'Battle arenas use one start position per player (index 0-11).'],
  },
  ENPT: {
    title: 'Enemy route (CPU)',
    what: 'The path the computer-controlled players follow. Points are grouped: each group is a chain of points, and groups are linked to each other (next / previous) to form the whole lap, including branches.',
    tips: ['Place points along the racing line, a bit more frequently in curves.', 'Use several "next" groups to create a fork: CPUs will pick one of them.', 'The last group must link back to the first one to close the lap.'],
  },
  ITPT: {
    title: 'Item route',
    what: 'The path used by items that follow the track: red and blue shells and Bullet Bill. Structured exactly like the enemy route.',
    tips: ['Tools › Item routes › Copy from enemy routes creates a good starting point.', 'Keep points above the road and away from walls, or homing items will crash.'],
  },
  CKPT: {
    title: 'Checkpoint',
    what: 'A line from a LEFT point to a RIGHT point that the karts cross. The game uses checkpoints to know each player\'s position, count laps and decide where to respawn after a fall.',
    tips: [
      'Left and right are seen while driving forward: the arrow in the 3D view shows the driving direction.',
      'Exactly one checkpoint must be the lap checkpoint (type 0): it is the finish line.',
      'Key checkpoints (1, 2, 3, …) must be crossed in order for a lap to count: they stop shortcuts.',
      'The space between two consecutive checkpoints must not be twisted, and checkpoints should cover the whole drivable width.',
      'Each checkpoint chooses the respawn point used when a player falls after crossing it.',
    ],
  },
  GOBJ: {
    title: 'Object',
    what: 'Anything placed on the track by the game: item boxes, enemies (Goombas, Chain Chomps…), decorations, sounds, effects, moving vehicles…',
    tips: ['The eight settings change the behaviour and their meaning depends on the object (speed, range, timers…).', 'Objects that move (cars, boats, Goombas) follow a route: create one in Routes and select it here.', 'Untick "3-4 players" for heavy decoration to reduce lag in split screen.'],
  },
  POTI: {
    title: 'Route',
    what: 'A generic path made of points. Used by moving objects, cameras and some areas.',
    tips: ['Smooth curves interpolates between points; otherwise objects move in straight lines.', 'Back and forth makes objects go to the end and return; cyclic loops to the first point.'],
  },
  AREA: {
    title: 'Area',
    what: 'An invisible box or cylinder that triggers something when a kart is inside: replay cameras, fog or bloom changes, water/road currents, object groups, minimap changes…',
    tips: ['Size: a scale of 1.0 is 10000 units. The area starts at its position and goes up.', 'When areas overlap, the one with the higher priority wins.', 'The meaning of Setting 1 and 2 depends on the area type.'],
  },
  CAME: {
    title: 'Camera',
    what: 'Cameras of the intro fly-over, of the replay and of the goal. Opening cameras are chained with "Next camera".',
    tips: ['Zoom is the field of view in degrees (smaller = more zoomed in).', 'Look-at start/end are the points the camera looks at at the beginning and at the end of its time.', 'Duration is in frames (60 frames = 1 second).', 'The Cameras tab edits the intro as keyframes on a timeline under the 3D view: frame the view and press K.'],
  },
  JGPT: {
    title: 'Respawn point',
    what: 'Where Lakitu puts a player back after falling off the track. Checkpoints decide which respawn is used.',
    tips: ['Place respawns on the road, facing the driving direction.', 'Tools › Respawns can create them from the checkpoints automatically.'],
  },
  CNPT: {
    title: 'Cannon destination',
    what: 'Where a cannon shoots the player. The cannon itself is a collision of type "Cannon Activator"; its variant selects which destination (ID) is used.',
    tips: ['ID 0 is used by Cannon Activator variant 0, ID 1 by variant 1, and so on.'],
  },
  MSPT: {
    title: 'Battle end position',
    what: 'Positions of the players shown at the end of a battle.',
    tips: ['Only needed in battle arenas.'],
  },
  GROUP: {
    title: 'Group',
    what: 'A chain of route points or checkpoints. "Next" and "previous" groups tell the game how chains connect into a full lap.',
    tips: ['A simple lap: one group whose next and previous are itself (group 0).', 'A fork: one group with two "next" groups; they both lead to the group where the paths join again.'],
  },
  ROUTE: {
    title: 'Route',
    what: 'A path used by moving objects, cameras and areas.',
    tips: ['Add points with the button below, then move them in the 3D view.'],
  },
};

// KMP AREA type IDs: https://www.mkwiiki.org/wiki/AREA_type
// Keep this list aligned with AREA_TYPES in defs.js.
export const AREA_TYPE_HELP = [
  {
    what: 'Activates its linked replay camera when a player enters the area.',
    use: 'Choose the camera shown near the finish line or while waiting online.',
    settings: 'Camera selects the CAME entry; Priority resolves overlapping camera areas.',
  },
  {
    what: 'Changes local environmental particles: suppresses fire and snow effects and uses leaf effects instead.',
    use: 'Create a region with different leaf or ambient particle effects.',
    settings: 'Setting 1 = 1 uses the upward leaf effect variant.',
  },
  {
    what: 'Applies a fog preset from posteffect.bfg while the player is inside, then restores the default fog on exit.',
    use: 'Give a tunnel, cave or other section its own fog and screen colour.',
    settings: 'Setting 1 selects the BFG entry.',
  },
  {
    what: 'Activates movement for terrain marked as moving road in the collision file.',
    use: 'Create a conveyor belt, moving road or water current.',
    settings: 'Route and Settings 1–2 control the movement for supported variants; the KCL surface must be set up too.',
  },
  {
    what: 'Redirects CPUs entering this area when the course uses a Force Recalculation collision.',
    use: 'Help CPUs recover their route after a jump, shortcut or unusual section.',
    settings: 'Position, Rotation and Enemy point matter; the matching KCL collision is also required.',
  },
  {
    what: 'Changes minimap settings such as visibility and culling, and can crop the displayed map.',
    use: 'Control minimap visibility or clipping in a special battle, mission or tournament course.',
  },
  {
    what: 'Switches to another posteffect.bblm file while inside the area.',
    use: 'Give one section different glow or brightness.',
    settings: 'Setting 1 selects the BBLM preset; Setting 2 controls the transition time in frames.',
  },
  {
    what: 'Allows flying Boos (b_teresa) to appear within this region.',
    use: 'Mark the part of a course where Boo effects should be visible.',
  },
  {
    what: 'Defines a group of course objects that can be unloaded by an Object Unload area.',
    use: 'Group objects so another area can unload them.',
    settings: 'Setting 1 is the group ID (0–15); pair it with an Object Unload area using the same ID.',
  },
  {
    what: 'Unloads objects belonging to matching Object Group areas while the player is inside.',
    use: 'Change which objects are loaded in a section of the course.',
    settings: 'Setting 1 must match the group ID of the Object Group area.',
  },
  {
    what: 'Acts as a fall boundary without adding fall collision to the KCL.',
    use: 'Mark an out-of-bounds region in a tournament or other special course.',
  },
];

// Per-field explanations shown under each inspector field.
export const FIELD_HELP = {
  common: {
    pos: 'Position in the world (X = east/west, Y = height, Z = north/south). Drag the X/Y/Z labels to change it, or use the arrows in the 3D view.',
    rot: 'Rotation in degrees around X, Y and Z. For most things only Y (the facing direction) matters.',
    scale: 'Size multiplier on each axis (1 = normal size).',
  },
  KTPT: {
    playerIndex: '-1 = everyone starts from here in a grid (races). 0-11 = only that player (battles).',
  },
  ENPT: {
    width: 'How far the CPU may move away from the line between points. Bigger = CPUs use more of the road.',
    setting1: 'Special CPU behaviour at this point (for example using a mushroom on a shortcut). 0 = none. Leave 0 if unsure.',
    setting2: 'Drift / wheelie behaviour of CPUs at this point. 0 = automatic.',
    setting3: 'Rarely used. Leave 0.',
  },
  ITPT: {
    width: 'How wide the path of homing items can be around this point.',
    setting1: 'Bullet Bill behaviour at this point (for example lower its speed or let it fly over gaps). 0 = normal.',
    setting2: 'Extra flags for items at this point (for example force shells to stay on the route). 0 = normal.',
  },
  CKPT: {
    left: 'Left end of the checkpoint line (X, Z), as seen while driving forward.',
    right: 'Right end of the checkpoint line (X, Z), as seen while driving forward.',
    type: 'Normal, lap checkpoint (finish line, exactly one per track) or key checkpoint (crossed in order to validate a lap).',
    respawn: 'Respawn point used when a player falls after crossing this checkpoint.',
  },
  GOBJ: {
    objectId: 'Which game object this is. Pick from the list (load Common.szs once to get every name).',
    route: 'Route followed by moving objects (cars, boats, flying things). None for static objects.',
    settings: 'Eight values whose meaning depends on the object. Known values and limits appear under each field; other fields show only the KMP storage limit. Import JSON documentation to add or revise the guidance.',
    presence: 'In which modes the object exists. Removing heavy objects from 3-4 player mode avoids slowdowns in split screen.',
  },
  POTI: {
    setting1: 'Speed of objects moving along the route when they reach this point (object-specific).',
    setting2: 'Extra value for objects or cameras at this point (object-specific). Usually 0.',
  },
  AREA: {
    shape: 'Box or cylinder.',
    type: 'What the area does when a kart is inside it.',
    camera: 'Replay camera used inside this area (camera areas only).',
    priority: 'When areas overlap, the area with the higher priority is used.',
    setting1: 'Depends on the type: effect index, fog (BFG) entry, current speed, object group…',
    setting2: 'Depends on the type. Usually 0.',
    route: 'Route used by "Pull" (current) areas to know the direction of the flow.',
    enemyPoint: 'Enemy point used by "Enemy route recalculation" areas. 255 = none.',
    scale: 'Size: 1.0 = 10000 units wide and tall.',
  },
  CAME: {
    type: 'Kind of camera: opening shots, replay cameras, goal camera…',
    next: 'Camera shown after this one (for chained opening shots). None = last one.',
    route: 'Route followed by the camera while it is active (path cameras).',
    viewStart: 'Point the camera looks at when it starts.',
    viewEnd: 'Point the camera looks at when it ends.',
    zoomStart: 'Field of view in degrees at the start (smaller = more zoomed in).',
    zoomEnd: 'Field of view in degrees at the end.',
    time: 'How long the camera is used, in frames (60 = 1 second).',
    shake: 'Camera shake strength. 0 = none.',
    pointSpeed: 'Speed along the route (1/100 unit per frame), used when the route points have no speed of their own (Setting 1 of each point).',
    zoomSpeed: 'How fast the zoom goes from start to end: 1/100 degree per frame (100 = 1 degree per frame).',
    viewSpeed: 'How fast the look-at point goes from start to end: 1/100 unit per frame (6000 = 60 units per frame).',
    start: 'Marks the first camera of the opening sequence.',
    movie: 'Used by the game\'s demo movies. Usually 0.',
  },
  JGPT: {
    id: 'Identifier, normally equal to the index in the list (Tools › Respawns › Renumber IDs).',
    range: 'Advanced: -1 = default behaviour.',
  },
  CNPT: {
    id: 'Cannon number: Cannon Activator collision with variant N sends players to the destination with ID N.',
    effect: 'Flight style of the cannon shot.',
  },
  MSPT: { id: 'Identifier, normally equal to the index.', unknown: 'Unused. Leave 0.' },
  STGI: {
    laps: 'Number of laps of a race (1-9).',
    pole: 'Side of the grid where the player in first position starts.',
    distance: 'Normal grid or karts closer together (for narrow starts).',
    flareFlash: 'Whether the lens flare flashes when looking at the sun.',
    flareColor: 'Colour and opacity of the lens flare.',
    speedMod: 'Multiplies the speed of every kart on this track. 1.0 = normal.',
  },
  GROUP: {
    prev: 'Groups that come before this one. The game uses them when a player drives backwards.',
    next: 'Groups that come after this one. Several groups = a fork.',
    setting1: 'Extra group value. Usually 0.',
    setting2: 'Extra group value. Usually 0.',
  },
};

export function fieldHelp(kind, key) {
  return FIELD_HELP[kind]?.[key] ?? FIELD_HELP.common[key] ?? '';
}

// ---- Collision types ----------------------------------------------------------------------
export const KCL_HELP = {
  0x00: 'Normal road with full speed.',
  0x01: 'Road where karts slide a little (ice, wet floor).',
  0x02: 'Slows karts slightly (light grass, dirt).',
  0x03: 'Slows karts noticeably (grass, sand).',
  0x04: 'Slows karts a lot (deep snow, water edge).',
  0x05: 'Very slippery road (ice).',
  0x06: 'Boost panel: gives a speed boost when driven over.',
  0x07: 'Boost ramp: boosts and launches the kart, allowing tricks.',
  0x08: 'Jump pad that launches karts high (like the springs in some tracks).',
  0x09: 'Surface that only items can drive on.',
  0x0A: 'Kart sinks and respawns (quicksand, lava) — counts as falling.',
  0x0B: 'Moving water that pushes karts.',
  0x0C: 'Solid wall.',
  0x0D: 'Invisible wall (blocks karts but is not drawn).',
  0x0E: 'Wall that only stops items.',
  0x0F: 'Another wall type (different sound/effect).',
  0x10: 'Falling here sends the player back to the respawn point.',
  0x11: 'Shoots the player out of a cannon. The variant chooses the destination ID.',
  0x12: 'Forces CPUs to recalculate their route.',
  0x13: 'Half-pipe ramp (sends karts up for tricks, like Rainbow Road).',
  0x14: 'Wall that blocks players but not items.',
  0x15: 'Road that moves karts (conveyor belts).',
  0x16: 'Road that sticks karts to it (gravity / loops).',
  0x17: 'Second road type (different sounds/effects).',
  0x18: 'Plays sounds when a kart passes (variant = sound).',
  0x19: 'Wall that only slightly bumps karts.',
  0x1A: 'Starts an effect when touched (variant = effect).',
  0x1B: 'Changes the state of items that touch it.',
  0x1C: 'Invisible wall used at the edge of half-pipes.',
  0x1D: 'Rotating road (moving platforms).',
  0x1E: 'Special wall (various effects).',
  0x1F: 'Another invisible wall type.',
};

export const KCL_FIELD_HELP = {
  variant: 'Variant (0-7) of the surface: changes the sound, the particle effects and, for some types, the behaviour (e.g. which cannon).',
  shadow: 'Lighting index (0-7) from the track\'s light settings: makes karts darker or brighter on this surface.',
  brush: 'Single triangle paints one triangle; Round brush paints everything near the cursor; Fill connected paints all connected triangles of the same type; Fill flat area paints connected triangles that face the same way.',
};

// ---- Toolbar & settings --------------------------------------------------------------------
export const TOOL_HELP = {
  undo: ['Undo', 'Undo the last change.', 'Ctrl+Z'],
  redo: ['Redo', 'Redo the change you just undid.', 'Ctrl+Y'],
  translate: ['Move', 'Drag the coloured arrows on the selection to move it. Drag the squares to move on a plane.', 'W'],
  rotate: ['Rotate', 'Drag the coloured rings to rotate the selection.', 'E'],
  scale: ['Scale', 'Drag the handles to resize objects and areas, or to widen checkpoints.', 'R'],
  snap: ['Grid snap', 'Moves in fixed steps (e.g. every 100 units) so things line up exactly.'],
  rsnap: ['Rotation snap', 'Rotates in fixed steps (e.g. every 15°).'],
  ground: ['Stick to ground', 'While moving, keep things on the collision surface under them.'],
  add: ['Add', 'Place a new element: pick what to add, then click in the 3D view.'],
  paint: ['Paint collision', 'Change the collision type of the track surface (road, off-road, boost…).'],
  display: ['What to show', 'Model: the real track model. Collision: the surfaces as the game feels them, coloured by type. Both: the model with the collision on top (chosen by itself in the Collision tab).'],
  anim: ['Animations', 'Play the game\'s animations: moving objects, waving flags, flowing water, spinning item boxes.'],
  top: ['Top view', 'Look at the track from above.', 'T'],
  frame: ['Frame track', 'Zoom out to see the whole track.', 'Home'],
  save: ['Save', 'Save the track. When backups are enabled, the first save keeps a .bak copy of the original.', 'Ctrl+S'],
  help: ['Help', 'Guide, explanations of every element and all keyboard shortcuts.', 'F1'],
};

export const SETTINGS_HELP = {
  keepBackups: { label: 'Keep .bak backups', help: 'On by default. The first save of an existing track, game text archive, audio file, model archive or Riivolution XML keeps its original as a .bak file. Turning this off leaves any existing .bak files in place.' },
  modelMode: { label: '3D models', help: 'Real: the game\'s own models and textures (from the track and Common.szs). Simple: lightweight look-alike models. Markers: plain shapes, fastest on slow computers.' },
  displayMode: { label: 'Show', help: 'Model, Collision or both. The Collision tab switches to Both while it is open (and back to Model when it is left); a track without a model shows its collision.' },
  hideGrid: { label: 'Hide grid', help: 'Hides the reference grid drawn at height 0 under the track. It is never part of the track and is not shown in the game.' },
  animations: { label: 'Play animations', help: 'Water, flags, enemies and item boxes move like in the game. Turn off to save battery or to keep the view still.' },
  showLabels: { label: 'Name labels', help: 'Shows the name above objects that have no recognisable model.' },
  showEffects: { label: "Show effects", help: "Plays the particle effects (smoke, sparks, fireworks…) of the objects of the track in the 3D view, from its effect files. It is an approximate preview: the game also moves particles with curves and events that the editor does not simulate." },
  selectionBox: { label: 'Selection box', help: 'Draws a yellow box around the selected objects and model parts. Off by default: the selection is still highlighted and shows the move arrows.' },
  showAreaVolumes: { label: 'Show area volumes', help: 'Draws transparent AREA boxes and their outlines in the 3D view. Turn off to hide unselected area volumes and reduce clutter; a selected area stays visible for editing.' },
  areaOutlinesThroughWalls: { label: 'Area outlines through walls', help: 'Draws faint AREA perimeters even behind buildings and terrain. Off by default: only perimeter segments directly visible to the camera are drawn.' },
  offerCopyUpdates: { label: 'Offer to update other copies', help: 'When saving in Characters and models, look for the other copies of the model the game keeps (the same character with other vehicles and in split screen, the split-screen version of a track, other tracks) and offer to update them too. Turn off to change each archive on its own, for example a different look for every vehicle.' },
  confirmModelDrop: { label: 'Ask before importing dropped 3D models', help: 'Shows a confirmation when 3D models (OBJ, FBX, glTF, GLB, DAE, STL, PLY) are dropped on the window before adding them to the track model.' },
  showDescriptions: { label: 'Field explanations', help: 'Shows a short explanation under every field of the inspector. Turn off once you know the editor well.' },
  iconSize: { label: 'Marker size', help: 'Size of route points, checkpoint posts and helper models, in world units. Increase it for big tracks.' },
  uiFont: { label: 'Interface font', help: 'Default uses the system font. Mario Kart Wii uses M PLUS 1, a free font included with the editor that looks like the lettering of the game menus. No game files are needed.' },
  quality: { label: 'Render quality', help: 'High uses full resolution and anti-aliasing. Low renders fewer pixels: smoother on weak graphics cards.' },
  flySpeed: { label: 'Camera movement speed', help: 'How fast W A S D and Q E move through the 3D view. Turn the mouse wheel while holding the right button (or while flying with W A S D) to change it. Shift still makes movement faster.' },
  lookSensitivity: { label: 'Mouse look sensitivity', help: 'How quickly the camera turns while dragging with the right mouse button.' },
  hideCursorWhileLooking: { label: 'Hide cursor while looking', help: 'Hide the pointer while holding the right mouse button to move the 3D camera. On by default.' },
  textureBrushSize: { label: 'Default texture brush size', help: 'Brush size in texture pixels when you open the texture editor. You can still change it while painting.' },
  modelEditing: { label: 'Edit track models', help: 'Allow selecting and moving parts of the visual track model directly in the 3D view.' },
  dragToMove: { label: 'Drag to move', help: 'In Move mode, hold the left button on an object, a point or a track model part and drag it: it follows the pointer at its height, and elements standing on the ground keep following the ground. Off by default; the arrows still work. Hold Shift or Ctrl to draw a selection box instead.' },
  hideMoveArrows: { label: 'Hide the Move arrows', help: 'Hide the coloured arrows in Move mode and move by dragging. Turning it on also turns on Drag to move, which it needs; turning Drag to move off shows the arrows again. Rotate and Scale keep their handles. Off by default.' },
  smartAlignment: { label: 'Align while moving', help: 'When dragging objects or track model parts, gently snap them to nearby parts and to the terrain when close. Off by default. The toolbar grid and ground snap still work independently.' },
  checkpointWidth: { label: 'New checkpoint width', help: 'Width of new checkpoints when the road width cannot be measured.' },
  autoCheckpointWidth: { label: 'Fit checkpoints to the road', help: 'When placing a checkpoint, measure the road on the collision and make the checkpoint as wide as the road.' },
  pathWidth: { label: 'New route point width', help: 'Width given to new enemy and item route points.' },
};

// ---- Guided tour ---------------------------------------------------------------------------
export const TOUR = [
  { el: '#menubar', title: 'Menus', text: 'File opens tracks (.szs, .wlz, .wbz, .wu8, .kmp, .kcl) and saves them as .szs, .kmp or .kcl and imports/exports models. Edit, View, Add and Tools contain every command; each one shows its keyboard shortcut.' },
  { el: '.tb-group[data-group=transform]', title: 'Transform tools', text: 'Choose how the gizmo works on the selection: Move (W), Rotate (E) or Scale (R). Snap makes steps exact; Stick to ground keeps things on the road.' },
  { el: '.tb-group[data-group=create]', title: 'Create', text: 'Add places new elements: choose one, then click in the 3D view. Paint changes the collision type of the road.' },
  { el: '.tb-group[data-group=view]', title: 'View', text: 'Switch between the real track model and the collision, play the in-game animations, look from above or frame the whole track.' },
  { el: '#left .tabs', title: 'Side panels', text: 'Track lists every element, including objects. Use + beside Objects to open the catalogue. Collision explains and paints surfaces; Check finds problems that would crash the game.' },
  { el: '#viewport', title: '3D view', text: 'Right-drag to orbit, middle-drag to pan, wheel to zoom. Hold the right button and use W A S D to fly. Click to select, drag on empty space to box-select.' },
  { el: '#right', title: 'Inspector', text: 'Shows every setting of the selected element with an explanation. Drag the X / Y / Z labels to change numbers quickly.' },
  { el: '#statusbar', title: 'Status bar', text: 'Shows what is selected, hints about the current tool and the coordinates and surface type under the mouse.' },
];
