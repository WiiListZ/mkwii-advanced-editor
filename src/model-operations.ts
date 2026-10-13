// BRRES geometry operations through ABMatt, invoked as a separate program.
// The Windows build includes its CLI distribution under the upstream GPL license.
import { copyFile, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, resolve, sep } from "node:path";
import { Euler, Matrix4, Quaternion, Vector3 } from "three";
import { attachCHR0, type ImportedAnimation } from "./chr0-import.ts";
import { attachMaterialAnimations, type MaterialAnimation } from "./material-animations.ts";
import { mergeWeightedModel } from "./weighted-model.ts";
import type { ImportedShape, ShapeController } from "./weighted-model.ts";
import { attachSHP0 } from "./shp0-import.ts";
// @ts-ignore Shared JavaScript BRRES reader.
import { parseBRRES, polygonPieces } from "../web/js/formats/brres.js";

const abmattPath = () => {
  const candidates = [process.env.MKWII_ABMATT, join(homedir(), "Documents", "abmatt", "bin", "abmatt.exe"), Bun.which("abmatt")].filter(Boolean) as string[];
  return candidates.find(existsSync) || null;
};

const MODEL_EXTENSIONS = new Set([".obj", ".fbx", ".gltf", ".glb", ".dae", ".stl", ".ply", ".blend"]);

async function blenderPath() {
  const candidates = [process.env.MKWII_BLENDER, Bun.which("blender")].filter(Boolean) as string[];
  if (process.platform === "win32") {
    for (const root of [process.env.ProgramW6432, process.env.ProgramFiles, process.env["ProgramFiles(x86)"]].filter(Boolean) as string[]) {
      const folder = join(root, "Blender Foundation");
      const versions = await readdir(folder).catch(() => []);
      versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
      for (const version of versions) candidates.push(join(folder, version, "blender.exe"));
    }
  }
  return candidates.find(existsSync) || null;
}

const BLENDER_IMPORT_SCRIPT = `import bpy, json, math, os, sys, traceback
from mathutils import Matrix, Vector
args = sys.argv[sys.argv.index('--') + 1:]
source, target, placement, unique_prefix = args[:4]
choice = args[4] if len(args) > 4 else ''
# '*' converts every animation of the armature: the default one as usual, the others as extra CHR0s.
import_all = choice == '*'
if import_all:
    choice = ''
extension = os.path.splitext(source)[1].lower()
TRANSFORM_PATHS = ('location', 'rotation_euler', 'rotation_quaternion', 'scale')

# Blender 4.4+ "slotted" actions: one action (one glTF animation) holds a slot per object,
# so the curves and the assignment must use the object's own slot.
def slot_for(obj, action, hint=None):
    slots = getattr(action, 'slots', None)
    if not slots:
        return None
    if hint is not None:
        return hint
    ad = obj.animation_data
    if ad is not None and ad.action == action and getattr(ad, 'action_slot', None) is not None:
        return ad.action_slot
    for slot in slots:
        try:
            if obj in slot.users():
                return slot
        except Exception:
            pass
    for slot in slots:
        if getattr(slot, 'identifier', '') == 'OB' + obj.name:
            return slot
    return slots[0] if len(slots) == 1 else None

def action_fcurves(action, obj=None, slot=None):
    layers = getattr(action, 'layers', None)
    if layers is not None and len(layers):
        slot = slot_for(obj, action, slot) if obj is not None else slot
        curves = []
        for layer in layers:
            for strip in layer.strips:
                try:
                    bag = strip.channelbag(slot) if slot is not None else None
                except Exception:
                    bag = None
                if bag is not None:
                    curves += list(bag.fcurves)
        return curves
    try:
        return list(action.fcurves)
    except Exception:
        return []

def assign(obj, action, slot):
    ad = obj.animation_data or obj.animation_data_create()
    ad.action = action
    if action is not None and slot is not None and hasattr(ad, 'action_slot'):
        try:
            ad.action_slot = slot
        except Exception:
            pass

def useful(obj, action, slot=None):
    curves = action_fcurves(action, obj, slot)
    if getattr(obj, 'type', None) == 'ARMATURE':
        return any(c.data_path.startswith('pose.bones[') for c in curves)
    if getattr(obj, 'type', None) == 'MESH':
        return any(c.data_path.split('.')[0] in TRANSFORM_PATHS for c in curves)
    if hasattr(obj, 'key_blocks'):
        return any(c.data_path.startswith('key_blocks[') and c.data_path.endswith('.value') for c in curves)
    if hasattr(obj, 'nodes') or hasattr(obj, 'diffuse_color'):
        return any('default_value' in c.data_path or 'diffuse_color' in c.data_path for c in curves)
    return False

# glTF animation names per node, read from the file itself: Blender names the imported
# actions per object, so the shared animation name ("Walk") would otherwise be lost.
def gltf_animations():
    try:
        with open(source, 'rb') as handle:
            data = handle.read()
        if data[:4] == b'glTF':
            import struct
            length = struct.unpack_from('<I', data, 12)[0]
            doc = json.loads(data[20:20 + length].decode('utf-8'))
        else:
            doc = json.loads(data.decode('utf-8'))
        nodes = doc.get('nodes', [])
        name = lambda i: nodes[i].get('name', 'node_%d' % i)
        parent = {}
        for i, node in enumerate(nodes):
            for child in node.get('children', []):
                parent[child] = i
        # Joints belong to their armature: Blender names it after the node above the skeleton root.
        owner = {}
        for skin in doc.get('skins', []):
            joints = skin.get('joints', [])
            if not joints:
                continue
            root = skin.get('skeleton')
            if root is None:
                root = next((j for j in joints if parent.get(j) not in joints), joints[0])
            armature = name(parent[root]) if root in parent and parent[root] not in joints else name(root)
            for j in joints:
                owner[j] = armature
        out = []
        for i, anim in enumerate(doc.get('animations', [])):
            targets = set()
            for channel in anim.get('channels', []):
                node = channel.get('target', {}).get('node')
                if node is not None and node < len(nodes):
                    targets.add(owner.get(node, name(node)))
            out.append((anim.get('name') or 'Animation_%d' % i, targets))
        return out
    except Exception:
        return []
GLTF_ANIMATIONS = gltf_animations() if extension in ('.gltf', '.glb') else []

def gltf_names_for(obj):
    return [name for name, targets in GLTF_ANIMATIONS if obj.name in targets]

# Animations an object can play, as (name, action): glTF keeps one NLA track per animation,
# FBX names its takes "Object|Take"; anything else uses the action name.
def animations_of(obj):
    out, seen = [], set()
    ad = obj.animation_data
    if ad:
        tracks = [(track.name, strip.action, getattr(strip, 'action_slot', None)) for track in ad.nla_tracks for strip in track.strips[:1] if strip.action]
        names = {name for name, _, _ in tracks}
        gltf_names = gltf_names_for(obj)
        # Track names are the glTF animation names in Blender 4.4+; older versions name them per object.
        if gltf_names and len(gltf_names) == len(tracks) and not names <= set(gltf_names):
            tracks = [(gltf_names[i], action, slot) for i, (_, action, slot) in enumerate(tracks)]
        for name, action, slot in tracks:
            if name not in seen:
                seen.add(name)
                out.append((name, action, slot))
        if ad.action:
            name = ad.action.name.split('|')[-1]
            if name not in seen:
                seen.add(name)
                out.append((name, ad.action, getattr(ad, 'action_slot', None)))
    for action in bpy.data.actions:
        name = action.name.split('|')[-1]
        if '|' in action.name and action.name.split('|')[0] == obj.name and name not in seen:
            seen.add(name)
            out.append((name, action, None))
    return [(name, action, slot_for(obj, action, slot)) for name, action, slot in out if useful(obj, action, slot)]

def frames_of(action):
    start, end = action.frame_range
    return start, end

try:
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    if extension == '.fbx':
        bpy.ops.import_scene.fbx(filepath=source)
    elif extension in ('.gltf', '.glb'):
        bpy.ops.import_scene.gltf(filepath=source)
    elif extension == '.dae':
        bpy.ops.wm.collada_import(filepath=source)
    elif extension == '.blend':
        bpy.ops.wm.open_mainfile(filepath=source)
    elif extension == '.stl':
        (bpy.ops.wm.stl_import if hasattr(bpy.ops.wm, 'stl_import') else bpy.ops.import_mesh.stl)(filepath=source)
    elif extension == '.ply':
        (bpy.ops.wm.ply_import if hasattr(bpy.ops.wm, 'ply_import') else bpy.ops.import_mesh.ply)(filepath=source)
    elif extension == '.obj':
        (bpy.ops.wm.obj_import if hasattr(bpy.ops.wm, 'obj_import') else bpy.ops.import_scene.obj)(filepath=source)
    else:
        raise ValueError('Unsupported model format: ' + extension)
    fps = bpy.context.scene.render.fps / bpy.context.scene.render.fps_base

    if unique_prefix == '__LIST__':
        # List mode: write the animations of the file and stop.
        groups = {}
        for obj in bpy.context.scene.objects:
            for name, action, slot in animations_of(obj):
                start, end = frames_of(action)
                g = groups.setdefault(name, {'name': name, 'frames': 0, 'objects': 0})
                g['frames'] = max(g['frames'], max(1, round((end - start) * 60 / fps)))
                g['objects'] += 1
        for material in bpy.data.materials:
            for host in (material, material.node_tree if material.use_nodes else None):
                if host is None:
                    continue
                for name, action, slot in animations_of(host):
                    start, end = frames_of(action)
                    g = groups.setdefault(name, {'name': name, 'frames': 0, 'objects': 0})
                    g['frames'] = max(g['frames'], max(1, round((end - start) * 60 / fps)))
                    g['objects'] += 1
        for obj in bpy.context.scene.objects:
            keys = obj.data.shape_keys if obj.type == 'MESH' else None
            if keys:
                for name, action, slot in animations_of(keys):
                    start, end = frames_of(action)
                    g = groups.setdefault(name, {'name': name, 'frames': 0, 'objects': 0})
                    g['frames'] = max(g['frames'], max(1, round((end - start) * 60 / fps)))
                    g['objects'] += 1
        with open(target, 'w', encoding='utf-8') as handle:
            json.dump(sorted(groups.values(), key=lambda g: g['name'].lower()), handle)
        sys.exit(0)

    if not any(obj.type == 'MESH' for obj in bpy.context.scene.objects):
        raise ValueError('The model contains no mesh geometry')

    # Every animation of each armature, listed before one of them is chosen below.
    rig_options = {obj.as_pointer(): animations_of(obj) for obj in bpy.context.scene.objects if obj.type == 'ARMATURE'} if import_all else {}

    # Pick the animation: '' keeps each object's active one, '-' omits motion tracks,
    # any other value plays that animation on every object that has it.
    for obj in bpy.context.scene.objects:
        ad = obj.animation_data
        if not ad:
            continue
        for track in ad.nla_tracks:
            track.mute = True
        options = animations_of(obj)
        if choice == '-':
            assign(obj, None, None)
        elif choice:
            found = [(action, slot) for name, action, slot in options if name == choice]
            assign(obj, *(found[0] if found else (None, None)))
        elif ad.action is None or not useful(obj, ad.action):
            assign(obj, *(options[0][1:] if options else (None, None)))
        else:
            assign(obj, ad.action, slot_for(obj, ad.action))

    # Blender material actions may animate a Mapping node's UV transform or a material colour.
    for material in bpy.data.materials:
        for host in (material, material.node_tree if material.use_nodes else None):
            if host is None or host.animation_data is None:
                continue
            ad = host.animation_data
            for track in ad.nla_tracks:
                track.mute = True
            options = animations_of(host)
            if choice == '-':
                assign(host, None, None)
            elif choice:
                found = [(action, slot) for name, action, slot in options if name == choice]
                assign(host, *(found[0] if found else (None, None)))
            elif ad.action is None or not useful(host, ad.action):
                assign(host, *(options[0][1:] if options else (None, None)))
            else:
                assign(host, ad.action, slot_for(host, ad.action))

    shape_hosts = []
    for obj in bpy.context.scene.objects:
        keys = obj.data.shape_keys if obj.type == 'MESH' else None
        if keys is None or keys.animation_data is None:
            continue
        ad = keys.animation_data
        for track in ad.nla_tracks:
            track.mute = True
        options = animations_of(keys)
        if choice == '-':
            assign(keys, None, None)
        elif choice:
            found = [(action, slot) for name, action, slot in options if name == choice]
            assign(keys, *(found[0] if found else (None, None)))
        elif ad.action is None or not useful(keys, ad.action):
            assign(keys, *(options[0][1:] if options else (None, None)))
        else:
            assign(keys, ad.action, slot_for(keys, ad.action))
        if keys.animation_data.action and useful(keys, keys.animation_data.action):
            shape_hosts.append((obj, keys, keys.animation_data.action))

    material_actions = [host.animation_data.action for material in bpy.data.materials
        for host in (material, material.node_tree if material.use_nodes else None)
        if host is not None and host.animation_data and host.animation_data.action and useful(host, host.animation_data.action)]
    object_actions = [obj.animation_data.action for obj in bpy.context.scene.objects
        if obj.animation_data and obj.animation_data.action and useful(obj, obj.animation_data.action)]
    if material_actions:
        all_actions = object_actions + material_actions
        sample_start = min(action.frame_range[0] for action in all_actions)
        sample_end = max(action.frame_range[1] for action in all_actions)
        sample_duration = max(1, round((sample_end - sample_start) * 60 / fps))
        # BRRES animations store their frame count as u16.
        if sample_duration > 65534:
            raise ValueError('Material animation is longer than 65,534 frames (about 18 minutes at 60 fps), the most a BRRES animation can store')
        animated_materials = [material for material in bpy.data.materials
            if any(host is not None and host.animation_data and host.animation_data.action
                for host in (material, material.node_tree if material.use_nodes else None))]
        samples = {material.name: {'name': material.name, 'uv': [], 'color': []} for material in animated_materials}
        for frame in range(sample_duration + 1):
            source_frame = sample_start + frame * fps / 60
            bpy.context.scene.frame_set(math.floor(source_frame), subframe=source_frame % 1)
            for material in animated_materials:
                nodes = material.node_tree.nodes if material.use_nodes else []
                mapping = next((node for node in nodes if node.type == 'MAPPING'), None)
                bsdf = next((node for node in nodes if node.type == 'BSDF_PRINCIPLED'), None)
                if mapping:
                    scale = mapping.inputs['Scale'].default_value
                    location = mapping.inputs['Location'].default_value
                    rotation = mapping.inputs['Rotation'].default_value
                    samples[material.name]['uv'].append({'scaleX': float(scale[0]), 'scaleY': float(scale[1]),
                        'rotation': math.degrees(float(rotation[2])), 'transX': float(location[0]), 'transY': float(location[1])})
                if bsdf:
                    samples[material.name]['color'].append([float(v) for v in bsdf.inputs['Base Color'].default_value])
                else:
                    samples[material.name]['color'].append([float(v) for v in material.diffuse_color])
        material_name = choice if choice and choice != '-' else material_actions[0].name.split('|')[-1]
        with open(target + '.material.json', 'w', encoding='utf-8') as handle:
            json.dump({'name': material_name, 'frames': sample_duration, 'materials': list(samples.values())}, handle)

    for index, obj in enumerate([item for item in bpy.context.scene.objects if item.type in ('ARMATURE', 'MESH')]):
        obj.name = unique_prefix + ('_Rig' if obj.type == 'ARMATURE' else '_Mesh') + str(index)
        if obj.type == 'MESH':
            obj.data.name = unique_prefix + '_Geom' + str(index)
    # OBJ's exporter only reads simple base-color texture links. Flatten imported
    # glTF/FBX material graphs to that form and write packed images beside the OBJ.
    for index, material in enumerate(bpy.data.materials):
        if not material.use_nodes:
            continue
        nodes = material.node_tree.nodes
        bsdf = next((node for node in nodes if node.type == 'BSDF_PRINCIPLED'), None)
        visited = set()
        def linked_image(socket):
            for link in socket.links:
                node = link.from_node
                if node in visited:
                    continue
                visited.add(node)
                if node.type == 'TEX_IMAGE' and node.image:
                    return node.image
                for node_input in node.inputs:
                    found = linked_image(node_input)
                    if found:
                        return found
            return None
        image = linked_image(bsdf.inputs['Base Color']) if bsdf else None
        if not image:
            continue
        image_path = os.path.join(os.path.dirname(target), 'texture_%d.png' % index)
        image.save_render(image_path, scene=bpy.context.scene)
        image = bpy.data.images.load(image_path, check_existing=False)
        nodes.clear()
        output = nodes.new('ShaderNodeOutputMaterial')
        simple = nodes.new('ShaderNodeBsdfPrincipled')
        texture = nodes.new('ShaderNodeTexImage')
        texture.image = image
        material.node_tree.links.new(texture.outputs['Color'], simple.inputs['Base Color'])
        material.node_tree.links.new(simple.outputs['BSDF'], output.inputs['Surface'])

    def animated(obj):
        ad = obj.animation_data
        return bool(ad and ad.action and useful(obj, ad.action, getattr(ad, 'action_slot', None)))
    rigs = [obj for obj in bpy.context.scene.objects if obj.type == 'ARMATURE' and animated(obj)]
    def bound_to(mesh, rig_list):
        return any(mod.type == 'ARMATURE' and mod.object in rig_list for mod in mesh.modifiers)
    moving_meshes = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH' and animated(obj) and not bound_to(obj, rigs)]
    if len(rigs) + len(moving_meshes) > 100:
        raise ValueError('Animation has too many animated rigs or objects')
    # Bone names must be unique across rigs: they become MDL0 bones and CHR0 nodes.
    if len(rigs) > 1:
        # Each rig first gets its own copy of a shared (slotted) action, then its bones are renamed:
        # a bone rename rewrites every curve of the action it finds, whatever the slot.
        for rig in rigs:
            ad = rig.animation_data
            shared, slot = ad.action, getattr(ad, 'action_slot', None)
            copy = shared.copy()
            ad.action = copy
            if slot is not None and getattr(copy, 'slots', None):
                match = next((x for x in copy.slots if x.identifier == slot.identifier), None)
                if match is not None:
                    ad.action_slot = match
        for i, rig in enumerate(rigs):
            users = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH' and bound_to(obj, [rig])]
            for bone in list(rig.data.bones):
                old = bone.name
                bone.name = 'R%d_%s' % (i, old)
                for mesh in users:
                    group = mesh.vertex_groups.get(old)
                    if group is not None and mesh.vertex_groups.get(bone.name) is None:
                        group.name = bone.name

    actions = [obj.animation_data.action for obj in rigs + moving_meshes] + material_actions
    if rigs or moving_meshes:
        start = min(action.frame_range[0] for action in actions)
        end = max(action.frame_range[1] for action in actions)
        duration = max(1, round((end - start) * 60 / fps))
        # BRRES animations store their frame count as u16.
        if duration > 65534:
            raise ValueError('Animation is longer than 65,534 frames (about 18 minutes at 60 fps), the most a BRRES animation can store')
        # Objects that move without bones get a generated bone each (CHR0 animates bones only).
        if moving_meshes:
            bpy.context.scene.frame_set(math.floor(start), subframe=start % 1)
            initial = {obj.name: obj.matrix_world.copy() for obj in moving_meshes}
            armature = bpy.data.armatures.new('ImportedMotion')
            motion = bpy.data.objects.new('ImportedMotion', armature)
            motion.name = unique_prefix + '_RigMotion'
            bpy.context.scene.collection.objects.link(motion)
            bpy.ops.object.select_all(action='DESELECT')
            motion.select_set(True)
            bpy.context.view_layer.objects.active = motion
            bpy.ops.object.mode_set(mode='EDIT')
            bone_names = {}
            for index, obj in enumerate(moving_meshes):
                bone = armature.edit_bones.new('ObjectMotion_%d' % index)
                bone.head = (0, 0, 0)
                bone.tail = (0, 0, 1)
                bone_names[obj.name] = bone.name
            bpy.ops.object.mode_set(mode='OBJECT')
            for obj in moving_meshes:
                group = obj.vertex_groups.new(name=bone_names[obj.name])
                group.add(list(range(len(obj.data.vertices))), 1.0, 'REPLACE')
                modifier = obj.modifiers.new('ImportedMotion', 'ARMATURE')
                modifier.object = motion
                motion.pose.bones[bone_names[obj.name]].rotation_mode = 'QUATERNION'
            for frame in range(duration + 1):
                source_frame = start + frame * fps / 60
                bpy.context.scene.frame_set(math.floor(source_frame), subframe=source_frame % 1)
                for obj in moving_meshes:
                    bone = motion.pose.bones[bone_names[obj.name]]
                    rest = bone.bone.matrix_local
                    delta = obj.matrix_world @ initial[obj.name].inverted()
                    matrix = rest.inverted() @ delta @ rest
                    location, rotation, scale = matrix.decompose()
                    bone.location = location
                    bone.rotation_quaternion = rotation
                    bone.scale = scale
                    bone.keyframe_insert(data_path='location', frame=frame + 1)
                    bone.keyframe_insert(data_path='rotation_quaternion', frame=frame + 1)
                    bone.keyframe_insert(data_path='scale', frame=frame + 1)
            for obj in moving_meshes:
                obj.animation_data_clear()
                obj.matrix_world = initial[obj.name]
            # The generated rig is keyed at 60 fps from frame 1.
            rigs.append(motion)
        else:
            motion = None
        if sum(len(rig.pose.bones) for rig in rigs) > 250:
            raise ValueError('Animation has too many bones')
        meshes = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
        bound = [obj for obj in meshes if bound_to(obj, rigs)]
        if not bound:
            raise ValueError('The animated armature has no bound mesh')
        samples = {}
        for rig in rigs:
            for bone in rig.pose.bones:
                samples[bone.name] = []
        for frame in range(duration + 1):
            source_frame = start + frame * fps / 60
            bpy.context.scene.frame_set(math.floor(source_frame), subframe=source_frame % 1)
            for rig in rigs:
                if rig is motion:
                    continue
                for bone in rig.pose.bones:
                    matrix = bone.matrix_basis.copy()
                    samples[bone.name].append([float(matrix[row][col]) for col in range(4) for row in range(4)])
        if motion is not None:
            for frame in range(duration + 1):
                bpy.context.scene.frame_set(frame + 1)
                for bone in motion.pose.bones:
                    matrix = bone.matrix_basis.copy()
                    samples[bone.name].append([float(matrix[row][col]) for col in range(4) for row in range(4)])
        # The other animations of a single armature, sampled the same way. Several rigs rename their
        # bones in the chosen action only, and generated object rigs have no other actions.
        if import_all and motion is None and len(rigs) == 1:
            rig = rigs[0]
            ad = rig.animation_data
            main_action, main_slot = ad.action, getattr(ad, 'action_slot', None)
            def rest_pose():
                for bone in rig.pose.bones:
                    bone.location = (0, 0, 0)
                    bone.rotation_quaternion = (1, 0, 0, 0)
                    bone.rotation_euler = (0, 0, 0)
                    bone.scale = (1, 1, 1)
            extra = []
            for extra_name, action, slot in rig_options.get(rig.as_pointer(), []):
                if action == main_action:
                    continue
                extra_start, extra_end = action.frame_range
                extra_duration = max(1, round((extra_end - extra_start) * 60 / fps))
                if extra_duration > 65534:
                    raise ValueError('Animation %s is longer than 65,534 frames (about 18 minutes at 60 fps), the most a BRRES animation can store' % extra_name)
                assign(rig, action, slot)
                rest_pose()
                extra_samples = {bone.name: [] for bone in rig.pose.bones}
                for frame in range(extra_duration + 1):
                    source_frame = extra_start + frame * fps / 60
                    bpy.context.scene.frame_set(math.floor(source_frame), subframe=source_frame % 1)
                    for bone in rig.pose.bones:
                        matrix = bone.matrix_basis.copy()
                        extra_samples[bone.name].append([float(matrix[row][col]) for col in range(4) for row in range(4)])
                extra.append({'name': extra_name, 'frames': extra_duration, 'fps': fps, 'bones': {bone_name: {'frames': frames} for bone_name, frames in extra_samples.items()}})
            assign(rig, main_action, main_slot)
            rest_pose()
            with open(target + '.anims.json', 'w', encoding='utf-8') as handle:
                json.dump(extra, handle)
        bpy.context.scene.frame_set(math.floor(start), subframe=start % 1)
        if motion is not None:
            bpy.context.scene.frame_set(1)
        name = choice if choice and choice != '-' else (actions[0].name.split('|')[-1] if actions else os.path.splitext(os.path.basename(source))[0])
        metadata = {'name': name, 'frames': duration, 'fps': fps, 'bones': {bone_name: {'frames': frames} for bone_name, frames in samples.items()}}
        with open(target + '.anim.json', 'w', encoding='utf-8') as handle:
            json.dump(metadata, handle)
        points = [obj.matrix_world @ vertex.co for obj in bound for vertex in obj.data.vertices]
        lower = Vector(tuple(min(point[i] for point in points) for i in range(3)))
        upper = Vector(tuple(max(point[i] for point in points) for i in range(3)))
        middle = (lower + upper) * 0.5
        longest = max(upper[i] - lower[i] for i in range(3))
        factor = 500 / longest if 0 < longest < 100 else 1
        game_target = json.loads(placement)
        blender_target = Vector((game_target[0], -game_target[2], game_target[1]))
        transform = Matrix.Translation(blender_target - middle * factor) @ Matrix.Scale(factor, 4)
        # A standalone BRRES keeps the model where it was (a character stays on its origin);
        # only models placed on a track are centred on the chosen point.
        if unique_prefix == 'Converted':
            transform = Matrix.Scale(factor, 4)
        for obj in bpy.context.scene.objects:
            if obj.parent is None:
                obj.matrix_world = transform @ obj.matrix_world
        bpy.context.view_layer.update()
        bpy.ops.object.select_all(action='DESELECT')
        for rig in rigs:
            rig.select_set(True)
        for obj in meshes:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = rigs[0]
        bpy.ops.wm.collada_export(filepath=target + '.dae', selected=True, include_animations=False, apply_modifiers=False, triangulate=True)
    if shape_hosts:
        shape_actions = [action for _, _, action in shape_hosts]
        shape_start = min(action.frame_range[0] for action in shape_actions)
        shape_end = max(action.frame_range[1] for action in shape_actions)
        shape_duration = max(1, round((shape_end - shape_start) * 60 / fps))
        # BRRES animations store their frame count as u16.
        if shape_duration > 65534:
            raise ValueError('Shape animation is longer than 65,534 frames (about 18 minutes at 60 fps), the most a BRRES animation can store')
        if not (rigs or moving_meshes):
            meshes = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
            points = [obj.matrix_world @ vertex.co for obj in meshes for vertex in obj.data.vertices]
            lower = Vector(tuple(min(point[i] for point in points) for i in range(3)))
            upper = Vector(tuple(max(point[i] for point in points) for i in range(3)))
            middle = (lower + upper) * 0.5
            longest = max(upper[i] - lower[i] for i in range(3))
            factor = 500 / longest if 0 < longest < 100 else 1
            game_target = json.loads(placement)
            blender_target = Vector((game_target[0], -game_target[2], game_target[1]))
            transform = Matrix.Translation(blender_target - middle * factor) @ Matrix.Scale(factor, 4)
            if unique_prefix == 'Converted':
                transform = Matrix.Scale(factor, 4)
            for obj in bpy.context.scene.objects:
                if obj.parent is None:
                    obj.matrix_world = transform @ obj.matrix_world
            bpy.context.view_layer.update()
        def game_point(point):
            return [float(point.x), float(point.z), float(-point.y)]
        shapes = []
        for obj, keys, action in shape_hosts:
            if len(keys.key_blocks) < 2:
                continue
            basis = keys.key_blocks[0]
            targets = [key for key in keys.key_blocks[1:] if any(
                (key.data[i].co - basis.data[i].co).length > 0.00001 for i in range(len(basis.data)))]
            if not targets:
                continue
            entry = {'mesh': obj.data.name, 'base': [game_point(obj.matrix_world @ item.co) for item in basis.data], 'targets': []}
            for key in targets:
                values = []
                for frame in range(shape_duration + 1):
                    source_frame = shape_start + frame * fps / 60
                    bpy.context.scene.frame_set(math.floor(source_frame), subframe=source_frame % 1)
                    values.append(float(key.value))
                if max(values) - min(values) < 0.00001:
                    continue
                entry['targets'].append({'name': key.name, 'positions': [game_point(obj.matrix_world @ item.co) for item in key.data], 'values': values})
            if entry['targets']:
                shapes.append(entry)
            assign(keys, None, None)
            for key in keys.key_blocks[1:]:
                key.value = 0.0
        if shapes:
            shape_name = choice if choice and choice != '-' else shape_actions[0].name.split('|')[-1]
            with open(target + '.shape.json', 'w', encoding='utf-8') as handle:
                json.dump({'name': shape_name, 'frames': shape_duration, 'shapes': shapes}, handle)
            bpy.ops.object.select_all(action='DESELECT')
            for obj in bpy.context.scene.objects:
                if obj.type in ('ARMATURE', 'MESH'):
                    obj.select_set(True)
                    bpy.context.view_layer.objects.active = obj
            bpy.ops.wm.collada_export(filepath=target + '.dae', selected=True, include_animations=False, apply_modifiers=False, triangulate=True)
    if hasattr(bpy.ops.wm, 'obj_export'):
        bpy.ops.wm.obj_export(filepath=target, export_materials=True, export_normals=False, export_triangulated_mesh=True, path_mode='COPY', forward_axis='NEGATIVE_Z', up_axis='Y')
    else:
        bpy.ops.export_scene.obj(filepath=target, use_materials=True, use_normals=False, use_triangles=True, path_mode='COPY', axis_forward='-Z', axis_up='Y')
    if unique_prefix == 'Converted' and not os.path.exists(target + '.dae'):
        bpy.ops.object.select_all(action='DESELECT')
        rigged = [obj for obj in bpy.context.scene.objects if obj.type in ('ARMATURE', 'MESH')]
        for obj in rigged:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = next((obj for obj in rigged if obj.type == 'ARMATURE'), rigged[0])
        bpy.ops.wm.collada_export(filepath=target + '.dae', selected=True, include_animations=False, apply_modifiers=False, triangulate=True)
except SystemExit:
    raise
except Exception:
    traceback.print_exc()
    sys.exit(1)
`;

// Animations a model file contains (glTF animations, FBX takes, Blender actions), for the import dialog.
export async function listModelAnimations(modelPath: string): Promise<{ name: string; frames: number; objects: number }[]> {
  const extension = extname(modelPath).toLowerCase();
  if (![".fbx", ".gltf", ".glb", ".dae", ".blend"].includes(extension)) return [];
  const blender = await blenderPath();
  if (!blender) return [];
  const dir = await mkdtemp(join(tmpdir(), "mkwii-model-anims-"));
  try {
    const script = join(dir, "convert.py"), out = join(dir, "animations.json");
    await writeFile(script, BLENDER_IMPORT_SCRIPT);
    const child = Bun.spawn([blender, "--background", "--factory-startup", "--python", script, "--", resolve(modelPath), out, "[0,0,0]", "__LIST__"], {
      cwd: dir, stdout: "pipe", stderr: "pipe", windowsHide: true,
    });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (code !== 0 || !existsSync(out)) throw new Error(`Blender could not read the model: ${(stdout + "\n" + stderr).trim().slice(-600)}`);
    return JSON.parse(await readFile(out, "utf8"));
  } finally {
    const base = resolve(tmpdir()) + sep;
    if (!resolve(dir).startsWith(base)) throw new Error("Unsafe temporary directory cleanup path");
    await rm(dir, { recursive: true, force: true });
  }
}

// animation: "" = the file's default animation, "-" = import without animation, otherwise the animation to use.
export async function import3DModel(data: Uint8Array, modelPath: string, target: number[], animation = "") {
  const extension = extname(modelPath).toLowerCase();
  if (!MODEL_EXTENSIONS.has(extension)) throw new Error(`Unsupported model format: ${extension || "(none)"}`);
  if (extension === ".obj") return importOBJModel(data, modelPath, target);
  if (target.length !== 3 || !target.every(Number.isFinite)) throw new Error("Invalid model position");
  if (!abmattPath()) throw new Error("ABMatt is unavailable. Check the included tools or set MKWII_ABMATT.");
  const blender = await blenderPath();
  if (!blender) throw new Error("Blender is required to import BLEND, FBX, glTF, GLB, DAE, STL and PLY models. Install Blender or set MKWII_BLENDER.");
  const current = parseBRRES(data), currentModel = current.models.find((m: any) => m.name === "course") || current.models[0];
  let number = 1;
  while (currentModel?.objects.some((o: any) => o.name.startsWith(`Imported_${number}_`)) || currentModel?.bones.some((b: any) => b.name.startsWith(`Imported_${number}_`))) number++;
  const uniquePrefix = `Imported_${number}`;
  const dir = await mkdtemp(join(tmpdir(), "mkwii-model-import-"));
  try {
    const obj = join(dir, `${basename(modelPath, extension).replace(/[^a-zA-Z0-9_-]/g, "_") || "imported"}.obj`);
    const script = join(dir, "convert.py");
    await writeFile(script, BLENDER_IMPORT_SCRIPT);
    const child = Bun.spawn([blender, "--background", "--factory-startup", "--python", script, "--", resolve(modelPath), obj, JSON.stringify(target), uniquePrefix, animation], {
      cwd: dir, stdout: "pipe", stderr: "pipe", windowsHide: true,
    });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (code !== 0 || !existsSync(obj)) throw new Error(`Blender could not convert the model: ${(stdout + "\n" + stderr).trim().slice(-800)}`);
    const hasBones = existsSync(obj + ".anim.json"), hasShapes = existsSync(obj + ".shape.json");
    let result = hasBones || hasShapes ? await importAnimatedModel(data, obj, target, dir) : await importOBJModel(data, obj, target);
    if (existsSync(obj + ".material.json")) {
      const materialAnimation = JSON.parse(await readFile(obj + ".material.json", "utf8")) as MaterialAnimation;
      result = await attachMaterialAnimations(result, materialAnimation, dir);
    }
    return result;
  } finally {
    const base = resolve(tmpdir()) + sep;
    if (!resolve(dir).startsWith(base)) throw new Error("Unsafe temporary directory cleanup path");
    await rm(dir, { recursive: true, force: true });
  }
}

// Converts a source model into a standalone BRRES; no existing game resource is patched.
export async function convert3DToBRRES(modelPath: string, animation = "") {
  const extension = extname(modelPath).toLowerCase();
  if (!MODEL_EXTENSIONS.has(extension) || !existsSync(modelPath)) throw new Error("Choose an existing supported 3D model file");
  const exe = abmattPath();
  if (!exe) throw new Error("ABMatt is unavailable. Check the included tools or set MKWII_ABMATT.");
  const dir = await mkdtemp(join(tmpdir(), "mkwii-brres-convert-"));
  try {
    let geometry = "";
    let skeletal: ImportedAnimation | null = null;
    const blender = await blenderPath();
    if (!blender) throw new Error("Blender is required to convert a standalone BRRES");
    const script = join(dir, "convert.py"), obj = join(dir, "converted.obj");
    await writeFile(script, BLENDER_IMPORT_SCRIPT);
    const child = Bun.spawn([blender, "--background", "--factory-startup", "--python", script, "--", resolve(modelPath), obj, "[0,0,0]", "Converted", animation], {
      cwd: dir, stdout: "pipe", stderr: "pipe", windowsHide: true,
    });
    const [blenderCode, blenderOut, blenderErr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (blenderCode || !existsSync(obj)) throw new Error(`Blender could not convert the model: ${(blenderOut + "\n" + blenderErr).trim().slice(-800)}`);
    if (existsSync(obj + ".shape.json")) throw new Error("Standalone BRRES conversion does not yet support shape-key animation");
    skeletal = existsSync(obj + ".anim.json") ? JSON.parse(await readFile(obj + ".anim.json", "utf8")) as ImportedAnimation : null;
    geometry = obj + ".dae";
    if (!existsSync(geometry)) throw new Error("Blender did not export the model as DAE");
    const output = join(dir, "converted.brres"), commandFile = join(dir, "convert-commands.txt");
    await writeFile(commandFile, `convert ${basename(geometry)} to converted.brres\n`);
    const process = Bun.spawn([exe, "-f", "convert-commands.txt", "-o"], { cwd: dir, stdout: "pipe", stderr: "pipe", windowsHide: true });
    const [code, out, err] = await Promise.all([process.exited, new Response(process.stdout).text(), new Response(process.stderr).text()]);
    if (code || !existsSync(output)) throw new Error(`ABMatt could not create the BRRES: ${(out + "\n" + err).trim().slice(-800)}`);
    let result = new Uint8Array(await readFile(output));
    const parsed = parseBRRES(result), model = parsed.models[0];
    if (!model?.objects.length) throw new Error("The converted BRRES has no model geometry");
    if (skeletal) {
      // With animation "*", Blender also writes every other animation of the armature.
      const extra = existsSync(obj + ".anims.json") ? JSON.parse(await readFile(obj + ".anims.json", "utf8")) as ImportedAnimation[] : [];
      const toModel = (source: ImportedAnimation): ImportedAnimation => {
        const bones: ImportedAnimation["bones"] = {};
        for (const [sourceName, boneData] of Object.entries(source.bones)) {
          const normalized = sourceName.replace(/\.(\d+)/g, "_$1");
          const candidates = model.bones.filter((bone: any) => bone.name === normalized || bone.name.endsWith("_" + normalized));
          if (candidates.length !== 1) throw new Error(`Converted bone ${sourceName} cannot be matched in the BRRES`);
          const bone = candidates[0];
          const rest = new Matrix4().compose(
            new Vector3(...bone.trans),
            new Quaternion().setFromEuler(new Euler(...bone.rot.map((value: number) => value * Math.PI / 180), "ZYX")),
            new Vector3(...bone.scale),
          );
          bones[bone.name] = { frames: boneData.frames.map((elements) => {
            if (elements.length !== 16 || !elements.every(Number.isFinite)) throw new Error(`Invalid animation matrix for ${sourceName}`);
            const position = new Vector3(), rotation = new Quaternion(), scale = new Vector3();
            rest.clone().multiply(new Matrix4().fromArray(elements)).decompose(position, rotation, scale);
            const angles = new Euler().setFromQuaternion(rotation, "ZYX");
            return [scale.x, scale.y, scale.z, angles.x * 180 / Math.PI, angles.y * 180 / Math.PI, angles.z * 180 / Math.PI, position.x, position.y, position.z];
          }) };
        }
        return { name: source.name, frames: source.frames, bones };
      };
      result = await attachCHR0(result, [skeletal, ...extra].map(toModel), dir);
      if (parseBRRES(result).chr.size !== 1 + extra.length) throw new Error("The converted BRRES lost a bone animation");
    }
    return result;
  } finally {
    if (!resolve(dir).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unsafe temporary conversion directory");
    await rm(dir, { recursive: true, force: true });
  }
}

async function importAnimatedModel(data: Uint8Array, objPath: string, target: number[], dir: string) {
  const exe = abmattPath()!;
  const before = parseBRRES(data), model = before.models.find((m: any) => m.name === "course") || before.models[0];
  if (!model) throw new Error("The track has no model to patch");
  const dae = objPath + ".dae";
  if (!existsSync(dae)) throw new Error("Blender did not export the animated armature");
  const hasBones = existsSync(objPath + ".anim.json"), hasShapes = existsSync(objPath + ".shape.json");
  const animation = hasBones ? JSON.parse(await readFile(objPath + ".anim.json", "utf8")) as ImportedAnimation : null;
  const shapeAnimation = hasShapes ? JSON.parse(await readFile(objPath + ".shape.json", "utf8")) as ImportedShape : undefined;
  const standaloneName = "weighted-standalone.brres";
  await writeFile(join(dir, "weighted-commands.txt"), `convert ${basename(dae)} to ${standaloneName}\n`);
  const process = Bun.spawn([exe, "-f", "weighted-commands.txt", "-o"], { cwd: dir, stdout: "pipe", stderr: "pipe", windowsHide: true });
  const [code, out, err] = await Promise.all([process.exited, new Response(process.stdout).text(), new Response(process.stderr).text()]);
  if (code || !existsSync(join(dir, standaloneName))) throw new Error(`ABMatt could not convert the rigged model: ${(out + "\n" + err).trim().slice(-800)}`);
  const shapeControllers: ShapeController[] = [];
  const patched = await mergeWeightedModel(data, new Uint8Array(await readFile(join(dir, standaloneName))), dir, shapeAnimation, shapeControllers);
  const after = parseBRRES(patched), next = after.models.find((m: any) => m.name === model.name);
  if (!next || next.objects.length <= model.objects.length) throw new Error(`Weighted merge did not add the animated mesh (${model.objects.length} → ${next?.objects.length})`);
  for (const old of model.objects) {
    const updated = next.objects.find((o: any) => o.name === old.name);
    if (!updated || updated.triangles !== old.triangles) throw new Error(`ABMatt changed existing model object ${old.name}`);
  }
  for (const [name, original] of before.textures) {
    const updated = after.textures.get(name);
    if (!updated || updated.format !== original.format) throw new Error(`ABMatt changed existing texture ${name}`);
  }
  let animated = patched;
  if (animation) {
  const sampled: ImportedAnimation = { name: animation.name, frames: animation.frames, bones: {} };
  for (const [sourceName, boneData] of Object.entries(animation.bones)) {
    const normalized = sourceName.replace(/\.(\d+)/g, "_$1");
    const matches = next.bones.slice(model.bones.length).filter((b: any) => b.name === normalized || b.name.endsWith("_" + normalized));
    if (matches.length !== 1) throw new Error(`Cannot match imported bone ${sourceName}; model bones: ${next.bones.slice(model.bones.length).map((b: any) => b.name).join(", ")}`);
    const bone = matches[0];
    const rest = new Matrix4().compose(
      new Vector3(...bone.trans),
      new Quaternion().setFromEuler(new Euler(...bone.rot.map((v: number) => v * Math.PI / 180), "ZYX")),
      new Vector3(...bone.scale),
    );
    sampled.bones[bone.name] = { frames: boneData.frames.map((elements) => {
      if (elements.length !== 16 || !elements.every(Number.isFinite)) throw new Error(`Invalid animation matrix for ${sourceName}`);
      const position = new Vector3(), rotation = new Quaternion(), scale = new Vector3();
      rest.clone().multiply(new Matrix4().fromArray(elements)).decompose(position, rotation, scale);
      const angles = new Euler().setFromQuaternion(rotation, "ZYX");
      return [scale.x, scale.y, scale.z, angles.x * 180 / Math.PI, angles.y * 180 / Math.PI, angles.z * 180 / Math.PI, position.x, position.y, position.z];
    }) };
  }
  animated = await attachCHR0(patched, sampled, dir);
  }
  return shapeAnimation ? attachSHP0(animated, shapeAnimation, shapeControllers, dir) : animated;
}

const center = (piece: any) => piece.min.map((v: number, i: number) => (v + piece.max[i]) / 2);

// The object the editor shows as selected: its exact triangles when given (they stay the same even
// after moving it next to another object), otherwise the piece nearest to `sourceCenter`.
function selectPiece(part: any, sourceCenter: number[], triangles?: number[] | null) {
  if (triangles?.length) {
    if (!triangles.every((t) => Number.isInteger(t) && t >= 0 && t < part.triangles)) throw new Error("Invalid model object selection");
    return { triangles: [...new Set(triangles)].sort((a, b) => a - b) };
  }
  return polygonPieces(part).pieces.reduce((best: any, p: any) => distance2(center(p), sourceCenter) < distance2(center(best), sourceCenter) ? p : best);
}

// "0-12,40-41,55" <-> [0..12, 40, 41, 55]
export function parseTriangleRanges(text: string | null) {
  if (!text) return null;
  const out: number[] = [];
  for (const part of text.split(",")) {
    const [a, b] = part.split("-").map(Number);
    if (!Number.isInteger(a) || (b !== undefined && !Number.isInteger(b)) || (b ?? a) < a || (b ?? a) - a > 200000) throw new Error("Invalid triangle list");
    for (let t = a; t <= (b ?? a); t++) out.push(t);
  }
  return out;
}
const distance2 = (a: number[], b: number[]) => a.reduce((sum, v, i) => sum + (v - b[i]) ** 2, 0);
const xyzKey = (a: number[]) => a.map((v) => Math.round(v * 100)).join(",");
const triKey = (points: number[][]) => points.map(xyzKey).sort().join("|");
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function duplicateInDae(xml: string, name: string, part: any, selected: any, delta: number[]) {
  const geo = new RegExp(`<geometry\\b[^>]*name="${escapeRe(name)}"[\\s\\S]*?<\\/geometry>`);
  const found = xml.match(geo);
  if (!found) throw new Error(`ABMatt did not export polygon ${name}`);
  let body = found[0];
  const posId = `${name}-POSITION`;
  const sourceRe = new RegExp(`<source id="${escapeRe(posId)}">[\\s\\S]*?<\\/source>`);
  const sourceMatch = body.match(sourceRe);
  if (!sourceMatch) throw new Error("DAE position source missing");
  const floatRe = new RegExp(`(<float_array id="${escapeRe(posId)}-array" count=")(\\d+)(">)([\\s\\S]*?)(<\\/float_array>)`);
  const floats = sourceMatch[0].match(floatRe);
  if (!floats) throw new Error("DAE position array missing");
  const coords = floats[4].trim().split(/\s+/).map(Number);
  if (coords.length !== Number(floats[2]) || coords.length % 3) throw new Error("Invalid DAE positions");
  const trisRe = /<triangles\b[^>]*count="\d+"[^>]*>[\s\S]*?<\/triangles>/;
  const trisMatch = body.match(trisRe);
  if (!trisMatch) throw new Error("DAE triangle list missing");
  let tris = trisMatch[0];
  const inputs = [...tris.matchAll(/<input\b[^>]*semantic="([^"]+)"[^>]*offset="(\d+)"[^>]*\/>/g)];
  const vertex = inputs.find((m) => m[1] === "VERTEX");
  if (!vertex) throw new Error("DAE vertex indices missing");
  const stride = Math.max(...inputs.map((m) => Number(m[2]))) + 1, vertexOffset = Number(vertex[2]);
  const pMatch = tris.match(/(<p>)([\s\S]*?)(<\/p>)/);
  if (!pMatch) throw new Error("DAE polygon index list missing");
  const indices = pMatch[2].trim().split(/\s+/).map(Number);
  if (indices.length % (stride * 3)) throw new Error("Invalid DAE polygon indices");
  const wanted = new Map<string, number>();
  for (const t of selected.triangles) {
    const points = Array.from({ length: 3 }, (_, k) => Array.from(part.positions.slice(t * 9 + k * 3, t * 9 + k * 3 + 3)) as number[]);
    const key = triKey(points); wanted.set(key, (wanted.get(key) || 0) + 1);
  }
  const chosen: number[][] = [];
  for (let t = 0; t < indices.length / (stride * 3); t++) {
    const tuple = indices.slice(t * stride * 3, (t + 1) * stride * 3);
    const points = Array.from({ length: 3 }, (_, k) => {
      const i = tuple[k * stride + vertexOffset] * 3;
      return coords.slice(i, i + 3);
    });
    const key = triKey(points), remaining = wanted.get(key) || 0;
    if (remaining) { wanted.set(key, remaining - 1); chosen.push(tuple); }
  }
  if (chosen.length !== selected.triangles.length) throw new Error(`Could not match all selected triangles (${chosen.length}/${selected.triangles.length})`);
  const newIndices = new Map<number, number>(), appended: number[] = [];
  const copies = chosen.flatMap((tuple) => {
    const copy = tuple.slice();
    for (let k = 0; k < 3; k++) {
      const offset = k * stride + vertexOffset, old = copy[offset];
      if (!newIndices.has(old)) {
        const next = (coords.length + appended.length) / 3;
        newIndices.set(old, next);
        for (let c = 0; c < 3; c++) appended.push(coords[old * 3 + c] + delta[c]);
      }
      copy[offset] = newIndices.get(old)!;
    }
    return copy;
  });
  let source = sourceMatch[0].replace(floatRe, (_m, a, _count, b, values, end) => `${a}${coords.length + appended.length}${b}${values.trim()} ${appended.join(" ")}${end}`);
  source = source.replace(/(<accessor\b[^>]*count=")(\d+)(")/, (_m, a, old, b) => `${a}${Number(old) + newIndices.size}${b}`);
  body = body.replace(sourceMatch[0], source);
  tris = tris.replace(/(<triangles\b[^>]*count=")(\d+)(")/, (_m, a, old, b) => `${a}${Number(old) + chosen.length}${b}`);
  tris = tris.replace(pMatch[0], `${pMatch[1]}${pMatch[2].trim()} ${copies.join(" ")}${pMatch[3]}`);
  body = body.replace(trisMatch[0], tris);
  return xml.replace(found[0], body);
}

export function deleteFromDae(xml: string, name: string, part: any, selected: any) {
  const geo = new RegExp(`<geometry\\b[^>]*name="${escapeRe(name)}"[\\s\\S]*?<\\/geometry>`);
  const found = xml.match(geo);
  if (!found) throw new Error(`ABMatt did not export polygon ${name}`);
  const body = found[0];
  const posId = `${name}-POSITION`;
  const floats = body.match(new RegExp(`<float_array id="${escapeRe(posId)}-array"[^>]*>([\\s\\S]*?)<\\/float_array>`));
  const trisMatch = body.match(/<triangles\b[^>]*count="\d+"[^>]*>[\s\S]*?<\/triangles>/);
  if (!floats || !trisMatch) throw new Error("DAE polygon data missing");
  const coords = floats[1].trim().split(/\s+/).map(Number), tris = trisMatch[0];
  const inputs = [...tris.matchAll(/<input\b[^>]*semantic="([^"]+)"[^>]*offset="(\d+)"[^>]*\/>/g)];
  const vertex = inputs.find((m) => m[1] === "VERTEX"), pMatch = tris.match(/(<p>)([\s\S]*?)(<\/p>)/);
  if (!vertex || !pMatch) throw new Error("DAE triangle indices missing");
  const stride = Math.max(...inputs.map((m) => Number(m[2]))) + 1, vertexOffset = Number(vertex[2]);
  const indices = pMatch[2].trim().split(/\s+/).map(Number);
  const wanted = new Map<string, number>();
  for (const t of selected.triangles) {
    const points = Array.from({ length: 3 }, (_, k) => Array.from(part.positions.slice(t * 9 + k * 3, t * 9 + k * 3 + 3)) as number[]);
    const key = triKey(points); wanted.set(key, (wanted.get(key) || 0) + 1);
  }
  const keep: number[] = [];
  let removed = 0;
  for (let t = 0; t < indices.length / (stride * 3); t++) {
    const tuple = indices.slice(t * stride * 3, (t + 1) * stride * 3);
    const points = Array.from({ length: 3 }, (_, k) => coords.slice(tuple[k * stride + vertexOffset] * 3, tuple[k * stride + vertexOffset] * 3 + 3));
    const key = triKey(points), remaining = wanted.get(key) || 0;
    if (remaining) { wanted.set(key, remaining - 1); removed++; }
    else keep.push(...tuple);
  }
  if (removed !== selected.triangles.length) throw new Error(`Could not match all selected triangles (${removed}/${selected.triangles.length})`);
  if (!keep.length) throw new Error("This model polygon has only one object; ABMatt cannot remove its final faces");
  const changed = tris.replace(/(<triangles\b[^>]*count=")\d+(")/, (_match, start, end) => `${start}${keep.length / (stride * 3)}${end}`)
    .replace(pMatch[0], `${pMatch[1]}${keep.join(" ")}${pMatch[3]}`);
  return xml.replace(found[0], body.replace(trisMatch[0], changed));
}

// Bind-pose world positions of a parsed MDL0 polygon (single-bound vertices are stored in bone space),
// matching the coordinates ABMatt writes into its Collada export.
export function worldPositions(model: any, part: any) {
  const out = new Float32Array(part.positions.length);
  for (let i = 0; i < part.positions.length / 3; i++) {
    const x = part.positions[i * 3], y = part.positions[i * 3 + 1], z = part.positions[i * 3 + 2];
    const rigid = model.boneMatrix?.get(part.mtx?.[i]);
    const w = rigid !== undefined && part.mtx[i] >= 0 ? model.bones[rigid]?.world : null;
    if (w) {
      out[i * 3] = w[0] * x + w[1] * y + w[2] * z + w[3];
      out[i * 3 + 1] = w[4] * x + w[5] * y + w[6] * z + w[7];
      out[i * 3 + 2] = w[8] * x + w[9] * y + w[10] * z + w[11];
    } else out.set([x, y, z], i * 3);
  }
  return out;
}

const attrRe = (name: string) => new RegExp(`(["#>\\s\\\\/])${escapeRe(name)}(?=[-"<\\s.])`, "g");

// Turns ABMatt's Collada export of one polygon from another BRRES into a standalone static mesh
// that can be patched into a course model: the polygon, its materials and its textures get the
// new names, joints are dropped (the export holds bind-pose world positions), only the chosen
// triangles are kept and the positions are moved by `delta`.
export function foreignPartDae(xml: string, materials: Record<string, any>, opts: {
  polygon: string; name: string; materialNames: Record<string, string>; textureNames: Record<string, string>;
  wanted?: Map<string, number> | null; delta: number[];
}) {
  const geometry = xml.match(new RegExp(`<geometry\\b[^>]*name="${escapeRe(opts.polygon)}"[\\s\\S]*?<\\/geometry>`))?.[0];
  if (!geometry) throw new Error(`ABMatt did not export polygon ${opts.polygon}`);
  const posId = `${opts.polygon}-POSITION`;
  const floatRe = new RegExp(`(<float_array id="${escapeRe(posId)}-array" count=")(\\d+)(">)([\\s\\S]*?)(<\\/float_array>)`);
  const floats = geometry.match(floatRe);
  if (!floats) throw new Error("DAE position array missing");
  const coords = floats[4].trim().split(/\s+/).map(Number);
  if (coords.length !== Number(floats[2]) || coords.length % 3 || !coords.every(Number.isFinite)) throw new Error("Invalid DAE positions");
  let body = geometry.replace(floatRe, (_m, a, count, b, _values, end) =>
    `${a}${count}${b}${coords.map((v, i) => +(v + opts.delta[i % 3]).toFixed(6)).join(" ")}${end}`);
  const wanted = opts.wanted ? new Map(opts.wanted) : null;
  let kept = 0;
  body = body.replace(/<triangles\b[^>]*>[\s\S]*?<\/triangles>/g, (tris) => {
    const inputs = [...tris.matchAll(/<input\b[^>]*semantic="([^"]+)"[^>]*offset="(\d+)"[^>]*\/>/g)];
    const vertex = inputs.find((m) => m[1] === "VERTEX"), p = tris.match(/(<p>)([\s\S]*?)(<\/p>)/);
    if (!vertex || !p) throw new Error("DAE triangle indices missing");
    const stride = Math.max(...inputs.map((m) => Number(m[2]))) + 1, vertexOffset = Number(vertex[2]);
    const indices = p[2].trim().split(/\s+/).map(Number), keep: number[] = [];
    for (let t = 0; t < indices.length / (stride * 3); t++) {
      const tuple = indices.slice(t * stride * 3, (t + 1) * stride * 3);
      if (wanted) {
        const key = triKey(Array.from({ length: 3 }, (_, k) => coords.slice(tuple[k * stride + vertexOffset] * 3, tuple[k * stride + vertexOffset] * 3 + 3)));
        const remaining = wanted.get(key) || 0;
        if (!remaining) continue;
        wanted.set(key, remaining - 1);
      }
      keep.push(...tuple);
    }
    if (!keep.length) return "";
    kept += keep.length / (stride * 3);
    return tris.replace(/(<triangles\b[^>]*count=")\d+(")/, (_m, a, b) => `${a}${keep.length / (stride * 3)}${b}`)
      .replace(/(<triangles\b[^>]*material=")([^"]+)(")/, (_m, a, mat, b) => `${a}${opts.materialNames[mat] || mat}${b}`)
      .replace(p[0], `${p[1]}${keep.join(" ")}${p[3]}`);
  });
  if (!kept) throw new Error("No triangles of this part were found in the export");
  if (wanted && [...wanted.values()].some(Boolean)) throw new Error("Could not match every triangle of the selected piece");
  body = body.replace(attrRe(opts.polygon), (_m, before) => `${before}${opts.name}`);

  const used = Object.keys(opts.materialNames);
  const block = (tag: string) => xml.match(new RegExp(`<${tag}>[\\s\\S]*?<\\/${tag}>`))?.[0] || "";
  const materialBlocks: string[] = [], effectBlocks: string[] = [], imageBlocks: string[] = [];
  const renameTextures = (text: string) => Object.entries(opts.textureNames)
    .reduce((s, [from, to]) => s.replace(attrRe(from), (_m, before) => `${before}${to}`), text);
  const images = new Set<string>();
  for (const mat of used) {
    const material = block("library_materials").match(new RegExp(`<material\\b[^>]*id="${escapeRe(mat)}"[\\s\\S]*?<\\/material>`))?.[0];
    if (!material) throw new Error(`ABMatt did not export material ${mat}`);
    const effectId = material.match(/<instance_effect url="#([^"]+)"/)?.[1];
    const effect = effectId && block("library_effects").match(new RegExp(`<effect\\b[^>]*id="${escapeRe(effectId)}"[\\s\\S]*?<\\/effect>`))?.[0];
    if (!effect) throw new Error(`ABMatt did not export the effect of ${mat}`);
    for (const m of effect.matchAll(/<surface\b[^>]*>\s*<init_from>([^<]+)-image<\/init_from>/g)) images.add(m[1]);
    const renamed = opts.materialNames[mat];
    const rename = (text: string) => text.replace(attrRe(effectId), (_m, before) => `${before}${renamed}-fx`).replace(attrRe(mat), (_m, before) => `${before}${renamed}`);
    materialBlocks.push(rename(material));
    effectBlocks.push(renameTextures(rename(effect)));
  }
  for (const image of images) {
    const found = block("library_images").match(new RegExp(`<image\\b[^>]*id="${escapeRe(image)}-image"[\\s\\S]*?<\\/image>`))?.[0];
    if (!found) throw new Error(`ABMatt did not export texture ${image}`);
    const to = opts.textureNames[image] || image;
    imageBlocks.push(found.replace(/<init_from>[^<]*<\/init_from>/, `<init_from>maps/${to}.png</init_from>`).replace(attrRe(image), (_m, before) => `${before}${to}`));
  }
  const bindings = used.map((mat) => `<instance_material symbol="${opts.materialNames[mat]}" target="#${opts.materialNames[mat]}"/>`).join("");
  const out = [
    `<?xml version='1.0' encoding='UTF-8'?>`,
    `<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">`,
    block("asset"),
    `<library_images>${imageBlocks.join("")}</library_images>`,
    `<library_materials>${materialBlocks.join("")}</library_materials>`,
    `<library_effects>${effectBlocks.join("")}</library_effects>`,
    `<library_geometries>${body}</library_geometries>`,
    `<library_visual_scenes><visual_scene id="part-scene" name="part"><node id="${opts.name}" name="${opts.name}" sid="${opts.name}">`,
    `<instance_geometry url="#${opts.name}-lib"><bind_material><technique_common>${bindings}</technique_common></bind_material></instance_geometry>`,
    `</node></visual_scene></library_visual_scenes>`,
    `<scene><instance_visual_scene url="#part-scene"/></scene>`,
    `</COLLADA>`,
  ].join("\n");

  const json: Record<string, any> = {};
  for (const mat of used) {
    const source = materials[mat];
    if (!source) continue;
    const copy = JSON.parse(JSON.stringify(source));
    if (copy.settings) copy.settings.name = opts.materialNames[mat];
    for (const layer of copy.layers || []) if (layer?.name) layer.name = opts.textureNames[layer.name] || layer.name;
    for (const frame of copy.pat0?.frames || []) if (frame?.texture) frame.texture = opts.textureNames[frame.texture] || frame.texture;
    copy.polygons = { [opts.name]: source.polygons?.[opts.polygon] || { draw_priority: 0 } };
    json[opts.materialNames[mat]] = copy;
  }
  return { xml: out, json, triangles: kept, textures: [...images] };
}

const uniqueName = (base: string, taken: Set<string>) => {
  let name = base, n = 2;
  while (taken.has(name)) name = `${base}_${n++}`;
  taken.add(name);
  return name;
};

const sameTexture = (a: any, b: any) => {
  if (!a || !b || a.width !== b.width || a.height !== b.height || a.format !== b.format || a.mipmaps !== b.mipmaps || a.size !== b.size) return false;
  const x = a.reader?.d?.subarray(a.dataOffset, a.offset + a.size), y = b.reader?.d?.subarray(b.dataOffset, b.offset + b.size);
  if (!x || !y || x.length !== y.length) return false;
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
};

// Copies one polygon (or one connected piece of it) from any game BRRES into the course model,
// with its materials (shader, blending, layers) and textures, centred on `target`
// (or at its original coordinates when `target` is null).
export async function importBRRESPart(data: Uint8Array, sourceData: Uint8Array, opts: {
  model: string; part: string; pieceCenter?: number[] | null; target?: number[] | null; tag?: string; triangles?: number[] | null;
}) {
  const exe = abmattPath();
  if (!exe) throw new Error("ABMatt is unavailable. Check the included tools or set MKWII_ABMATT.");
  if (opts.target && (opts.target.length !== 3 || !opts.target.every(Number.isFinite))) throw new Error("Invalid model position");
  if (opts.pieceCenter && (opts.pieceCenter.length !== 3 || !opts.pieceCenter.every(Number.isFinite))) throw new Error("Invalid piece selection");
  const source = parseBRRES(sourceData), sourceModel = source.models.find((m: any) => m.name === opts.model);
  const part = sourceModel?.objects.find((o: any) => o.name === opts.part);
  if (!part?.triangles) throw new Error("Source model polygon not found");
  const before = parseBRRES(data), model = before.models.find((m: any) => m.name === "course") || before.models[0];
  if (!model) throw new Error("The track model contains no 3D model");

  const world = worldPositions(sourceModel, part);
  let wanted: Map<string, number> | null = null, triangles = Array.from({ length: part.triangles }, (_, t) => t);
  if (opts.pieceCenter || opts.triangles?.length) {
    const piece = selectPiece(part, opts.pieceCenter || [0, 0, 0], opts.triangles);
    if (piece.triangles.length < part.triangles) {
      triangles = piece.triangles;
      wanted = new Map();
      for (const t of triangles) {
        const key = triKey(Array.from({ length: 3 }, (_, k) => Array.from(world.slice(t * 9 + k * 3, t * 9 + k * 3 + 3)) as number[]));
        wanted.set(key, (wanted.get(key) || 0) + 1);
      }
    }
  }
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const t of triangles) for (let k = 0; k < 9; k++) {
    const v = world[t * 9 + k], axis = k % 3;
    min[axis] = Math.min(min[axis], v); max[axis] = Math.max(max[axis], v);
  }
  const delta = opts.target ? opts.target.map((v, i) => v - (min[i] + max[i]) / 2) : [0, 0, 0];

  const tag = (opts.tag || opts.model).replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 20) || "part";
  const polygonNames = new Set<string>(model.objects.map((o: any) => o.name));
  const materialNames = new Set<string>(model.materials.map((m: any) => m.name));
  const textureNames = new Set<string>(before.textures.keys());
  const name = uniqueName(`${tag}_${opts.part}`, polygonNames);
  const draws = sourceModel.draws.filter((d: any) => d.object === sourceModel.objects.indexOf(part));
  const materialMap: Record<string, string> = {};
  for (const d of draws) {
    const mat = sourceModel.materials[d.material]?.name;
    if (mat && !materialMap[mat]) materialMap[mat] = uniqueName(`${tag}_${mat}`, materialNames);
  }
  if (!Object.keys(materialMap).length) throw new Error("The source polygon has no material");
  const textureMap: Record<string, string> = {};
  const addTexture = (tex: string) => {
    if (!tex || textureMap[tex] || !source.textures.has(tex)) return;
    // Shared textures that the track already holds unchanged are reused instead of copied.
    textureMap[tex] = sameTexture(source.textures.get(tex), before.textures.get(tex)) ? tex : uniqueName(`${tag}_${tex}`, textureNames);
  };
  for (const mat of Object.keys(materialMap)) {
    for (const layer of sourceModel.materials.find((m: any) => m.name === mat)?.layers || []) addTexture(layer.texture);
  }

  const dir = await mkdtemp(join(tmpdir(), "mkwii-model-part-"));
  try {
    await writeFile(join(dir, "source.brres"), sourceData);
    await runAbmatt(exe, dir, `convert source.brres to part.dae include ${opts.part}`, "source.brres", false);
    const daeName = existsSync(join(dir, "part.dae")) ? "part" : `part-${opts.model}`;
    if (!existsSync(join(dir, `${daeName}.dae`))) throw new Error(`ABMatt did not export model ${opts.model}`);
    const xml = await readFile(join(dir, `${daeName}.dae`), "utf8");
    const materialJson = existsSync(join(dir, `${daeName}.json`)) ? JSON.parse(await readFile(join(dir, `${daeName}.json`), "utf8")) : {};
    // Texture-swap animations (PAT0) need every frame's texture too.
    for (const mat of Object.keys(materialMap)) for (const frame of materialJson[mat]?.pat0?.frames || []) addTexture(frame.texture);
    const prepared = foreignPartDae(xml, materialJson, { polygon: opts.part, name, materialNames: materialMap, textureNames: textureMap, wanted, delta });
    const work = join(dir, "work");
    await mkdir(join(work, "maps"), { recursive: true });
    for (const tex of new Set([...prepared.textures, ...Object.keys(textureMap)])) {
      const from = join(dir, `${daeName}_maps`, `${tex}.png`);
      if (!existsSync(from)) throw new Error(`ABMatt did not export texture ${tex}`);
      await copyFile(from, join(work, "maps", `${textureMap[tex] || tex}.png`));
    }
    await writeFile(join(work, "part.dae"), prepared.xml);
    await writeFile(join(work, "part.json"), JSON.stringify(prepared.json, null, 2));
    await writeFile(join(work, "course_model.brres"), data);
    const log = await runAbmatt(exe, work, "convert part.dae to course_model.brres --patch", "course_model.brres");
    const result = new Uint8Array(await readFile(join(work, "course_model.brres")));
    const after = parseBRRES(result), next = after.models.find((m: any) => m.name === model.name);
    const added = next?.objects.find((o: any) => o.name === name);
    if (!next || !added || next.objects.length !== model.objects.length + 1) throw new Error(`ABMatt did not add the model part: ${log.slice(-600)}`);
    for (const old of model.objects) {
      const updated = next.objects.find((o: any) => o.name === old.name);
      if (!updated || updated.triangles !== old.triangles) throw new Error(`ABMatt changed existing model object ${old.name}`);
    }
    for (const [texName, original] of before.textures) {
      const updated = after.textures.get(texName);
      if (!updated || updated.format !== original.format || updated.width !== original.width) throw new Error(`ABMatt changed existing texture ${texName}`);
    }
    return { data: result, name };
  } finally {
    const base = resolve(tmpdir()) + sep;
    if (!resolve(dir).startsWith(base)) throw new Error("Unsafe temporary directory cleanup path");
    await rm(dir, { recursive: true, force: true });
  }
}

async function runAbmatt(exe: string, dir: string, command: string, source: string, overwrite = true) {
  await writeFile(join(dir, "commands.txt"), command + "\n");
  // Exports run without -o so ABMatt never re-saves (and possibly fails to repack) the source file.
  const child = Bun.spawn([exe, "-b", source, ...(overwrite ? ["-o"] : []), "-f", "commands.txt"], { cwd: dir, stdout: "pipe", stderr: "pipe", windowsHide: true });
  const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  if (code !== 0) throw new Error(`ABMatt failed: ${(out + "\n" + err).trim().slice(-600)}`);
  return (out + "\n" + err).trim();
}

export async function duplicateBRRESModel(data: Uint8Array, modelName: string, partName: string, sourceCenter: number[], delta: number[], triangles: number[] | null = null) {
  const exe = abmattPath();
  if (!exe) throw new Error("ABMatt is unavailable. Check the included tools or set MKWII_ABMATT.");
  if (![...sourceCenter, ...delta].every(Number.isFinite) || sourceCenter.length !== 3 || delta.length !== 3) throw new Error("Invalid model position");
  const before = parseBRRES(data), model = before.models.find((m: any) => m.name === modelName);
  const part = model?.objects.find((o: any) => o.name === partName);
  if (!part?.triangles) throw new Error("Model polygon not found");
  const selected = selectPiece(part, sourceCenter, triangles);
  if (!selected?.triangles.length) throw new Error("Model object not found");
  const dir = await mkdtemp(join(tmpdir(), "mkwii-model-"));
  try {
    await writeFile(join(dir, "course_model.brres"), data);
    await runAbmatt(exe, dir, `convert course_model.brres to scene.dae include ${partName}`, "course_model.brres");
    const xml = await readFile(join(dir, "scene.dae"), "utf8");
    await writeFile(join(dir, "scene.dae"), duplicateInDae(xml, partName, part, selected, delta));
    await copyFile(join(dir, "course_model.brres"), join(dir, "course_model-edited.brres"));
    await runAbmatt(exe, dir, `convert scene.dae to course_model-edited.brres include ${partName} --patch`, "course_model-edited.brres");
    const result = new Uint8Array(await readFile(join(dir, "course_model-edited.brres")));
    const after = parseBRRES(result), next = after.models.find((m: any) => m.name === modelName);
    if (!next || next.objects.length !== model.objects.length || after.textures.size !== before.textures.size) throw new Error("ABMatt changed the model structure unexpectedly");
    for (const old of model.objects) {
      const updated = next.objects.find((o: any) => o.name === old.name);
      const expected = old.triangles + (old.name === partName ? selected.triangles.length : 0);
      if (!updated || updated.triangles !== expected || (!!updated.colors !== !!old.colors)) throw new Error(`ABMatt changed ${old.name} unexpectedly (triangles ${old.triangles} → ${updated?.triangles}, expected ${expected}; colors ${!!old.colors} → ${!!updated?.colors})`);
    }
    for (const [name, original] of before.textures) {
      const updated = after.textures.get(name);
      if (!updated || updated.format !== original.format || updated.mipmaps !== original.mipmaps) throw new Error(`ABMatt changed texture ${name}`);
    }
    return result;
  } finally {
    const base = resolve(tmpdir()) + sep;
    if (!resolve(dir).startsWith(base)) throw new Error("Unsafe temporary directory cleanup path");
    await rm(dir, { recursive: true, force: true });
  }
}

export async function deleteBRRESModel(data: Uint8Array, modelName: string, partName: string, sourceCenter: number[], triangles: number[] | null = null) {
  const exe = abmattPath();
  if (!exe) throw new Error("ABMatt is required for model deletion");
  if (sourceCenter.length !== 3 || !sourceCenter.every(Number.isFinite)) throw new Error("Invalid model selection");
  const before = parseBRRES(data), model = before.models.find((m: any) => m.name === modelName);
  const part = model?.objects.find((o: any) => o.name === partName);
  if (!part?.triangles) throw new Error("Model polygon not found");
  const selected = selectPiece(part, sourceCenter, triangles);
  const dir = await mkdtemp(join(tmpdir(), "mkwii-model-delete-"));
  try {
    await writeFile(join(dir, "course_model.brres"), data);
    await runAbmatt(exe, dir, `convert course_model.brres to scene.dae include ${partName}`, "course_model.brres");
    const xml = await readFile(join(dir, "scene.dae"), "utf8");
    await writeFile(join(dir, "scene.dae"), deleteFromDae(xml, partName, part, selected));
    await copyFile(join(dir, "course_model.brres"), join(dir, "course_model-edited.brres"));
    await runAbmatt(exe, dir, `convert scene.dae to course_model-edited.brres include ${partName} --patch`, "course_model-edited.brres");
    const result = new Uint8Array(await readFile(join(dir, "course_model-edited.brres")));
    const after = parseBRRES(result), next = after.models.find((m: any) => m.name === modelName);
    if (!next || next.objects.length !== model.objects.length || after.textures.size !== before.textures.size) throw new Error("ABMatt changed the model structure unexpectedly");
    for (const old of model.objects) {
      const updated = next.objects.find((o: any) => o.name === old.name);
      const expected = old.triangles - (old.name === partName ? selected.triangles.length : 0);
      if (!updated || updated.triangles !== expected) throw new Error(`ABMatt changed ${old.name} unexpectedly`);
    }
    for (const [name, original] of before.textures) {
      const updated = after.textures.get(name);
      if (!updated || updated.format !== original.format || updated.mipmaps !== original.mipmaps) throw new Error(`ABMatt changed texture ${name}`);
    }
    return result;
  } finally {
    const base = resolve(tmpdir()) + sep;
    if (!resolve(dir).startsWith(base)) throw new Error("Unsafe temporary directory cleanup path");
    await rm(dir, { recursive: true, force: true });
  }
}

// Exports a BRRES model as Collada (.dae) or Wavefront (.obj) with its textures, through ABMatt.
// Writes the model file at `destination` and its textures/material files beside it.
export async function exportBRRESModel(data: Uint8Array, destination: string) {
  const exe = abmattPath();
  if (!exe) throw new Error("ABMatt is unavailable. Check the included tools or set MKWII_ABMATT.");
  const extension = extname(destination).toLowerCase();
  if (extension !== ".dae" && extension !== ".obj") throw new Error("Choose a .dae or .obj file");
  const stem = basename(destination, extension).replace(/[^a-zA-Z0-9_-]/g, "_") || "course_model";
  const dir = await mkdtemp(join(tmpdir(), "mkwii-model-export-"));
  try {
    await writeFile(join(dir, "source.brres"), data);
    await runAbmatt(exe, dir, `convert source.brres to ${stem}${extension}`, "source.brres", false);
    const produced = (await readdir(dir)).filter((name) => name !== "source.brres" && name !== "commands.txt");
    if (!produced.some((name) => name.toLowerCase().endsWith(extension))) throw new Error("ABMatt did not export the model");
    const target = dirname(resolve(destination));
    await mkdir(target, { recursive: true });
    for (const name of produced) await cp(join(dir, name), join(target, name), { recursive: true });
    return produced;
  } finally {
    const base = resolve(tmpdir()) + sep;
    if (!resolve(dir).startsWith(base)) throw new Error("Unsafe temporary directory cleanup path");
    await rm(dir, { recursive: true, force: true });
  }
}

export async function importOBJModel(data: Uint8Array, objPath: string, target: number[]) {
  const exe = abmattPath();
  if (!exe) throw new Error("ABMatt is unavailable. Check the included tools or set MKWII_ABMATT.");
  if (!objPath || extname(objPath).toLowerCase() !== ".obj" || target.length !== 3 || !target.every(Number.isFinite)) throw new Error("Invalid OBJ import parameters");
  const before = parseBRRES(data);
  const model = before.models.find((m: any) => m.name === "course") || before.models[0];
  if (!model) throw new Error("The track model contains no 3D model");
  const source = await readFile(objPath, "utf8");
  const lines = source.split(/\r?\n/);
  const vertices: number[][] = [];
  for (const line of lines) if (/^v\s/.test(line)) {
    const coords = line.trim().split(/\s+/).slice(1, 4).map(Number);
    if (coords.length !== 3 || !coords.every(Number.isFinite)) throw new Error("OBJ has an invalid vertex");
    vertices.push(coords);
  }
  if (!vertices.length || !lines.some((line) => /^f\s/.test(line))) throw new Error("OBJ must contain vertices and faces");
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const vertex of vertices) for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], vertex[i]); max[i] = Math.max(max[i], vertex[i]); }
  const longest = Math.max(...max.map((v, i) => v - min[i]));
  const scale = longest > 0 && longest < 100 ? 500 / longest : 1;
  const oldNames = new Set(model.objects.map((o: any) => o.name));
  const stem = basename(objPath, extname(objPath)).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 24) || "Imported";
  let unique = stem, suffix = 1;
  while (oldNames.has(unique)) unique = `${stem}_${suffix++}`;
  const dir = await mkdtemp(join(tmpdir(), "mkwii-obj-import-"));
  try {
    const sourceDir = dirname(resolve(objPath));
    const safeSource = (reference: string) => {
      const found = resolve(sourceDir, reference.trim());
      if (!found.startsWith(sourceDir + sep)) throw new Error(`Unsafe OBJ resource path: ${reference}`);
      return found;
    };
    const mtlNames: string[] = [];
    for (const line of lines) if (/^mtllib\s+/i.test(line)) {
      const name = line.trim().slice(7).trim();
      if (name) mtlNames.push(name);
    }
    const materialLines: string[] = [];
    for (const [index, name] of mtlNames.entries()) {
      const materialPath = safeSource(name);
      if (!existsSync(materialPath)) throw new Error(`Missing OBJ material file: ${name}`);
      let material = await readFile(materialPath, "utf8");
      material = material.replace(/^(map_Kd|map_Ka|map_d|bump|map_Bump)\s+(.+)$/gim, (_line, command, imageName) => {
        const imagePath = safeSource(imageName);
        if (!existsSync(imagePath)) throw new Error(`Missing material image: ${imageName}`);
        const copyName = `${index}_${basename(imagePath)}`;
        materialLines.push(`${imagePath}\t${copyName}`);
        return `${command} ${copyName}`;
      });
      await writeFile(join(dir, `material_${index}.mtl`), material);
    }
    for (const line of materialLines) {
      const [sourcePath, copyName] = line.split("\t");
      await copyFile(sourcePath, join(dir, copyName));
    }
    const hasMaterial = lines.some((line) => /^usemtl\s+/i.test(line));
    if (!mtlNames.length || !hasMaterial) {
      const names = new Set(["imported"]);
      if (!mtlNames.length) for (const line of lines) if (/^usemtl\s+/i.test(line)) names.add(line.trim().slice(7).trim());
      await writeFile(join(dir, "material_fallback.mtl"), [...names].map((name) => `newmtl ${name}\nKd 1 1 1\n`).join(""));
    }
    let vertexIndex = 0;
    const importedMtls = mtlNames.map((_, i) => `material_${i}.mtl`);
    if (!mtlNames.length || !hasMaterial) importedMtls.push("material_fallback.mtl");
    const output = [`mtllib ${importedMtls.join(" ")}`, `o ${unique}`];
    if (!hasMaterial) output.push("usemtl imported");
    for (const line of lines) {
      if (/^(mtllib|o|g)\s+/i.test(line)) continue;
      if (/^v\s/.test(line)) {
        const v = vertices[vertexIndex++];
        output.push(`v ${v.map((value, i) => ((value - (min[i] + max[i]) / 2) * scale + target[i]).toFixed(6)).join(" ")}`);
      } else output.push(line);
    }
    await writeFile(join(dir, "import.obj"), output.join("\n"));
    await writeFile(join(dir, "course_model.brres"), data);
    await runAbmatt(exe, dir, "convert import.obj to course_model.brres --patch", "course_model.brres");
    const result = new Uint8Array(await readFile(join(dir, "course_model.brres")));
    const after = parseBRRES(result), next = after.models.find((m: any) => m.name === model.name);
    if (!next || next.objects.length <= model.objects.length) throw new Error("ABMatt did not add the OBJ geometry");
    for (const old of model.objects) {
      const updated = next.objects.find((o: any) => o.name === old.name);
      if (!updated || updated.triangles !== old.triangles) throw new Error(`ABMatt changed existing model object ${old.name}`);
    }
    for (const [name, original] of before.textures) {
      const updated = after.textures.get(name);
      if (!updated || updated.format !== original.format) throw new Error(`ABMatt changed existing texture ${name}`);
    }
    return result;
  } finally {
    const base = resolve(tmpdir()) + sep;
    if (!resolve(dir).startsWith(base)) throw new Error("Unsafe temporary directory cleanup path");
    await rm(dir, { recursive: true, force: true });
  }
}
