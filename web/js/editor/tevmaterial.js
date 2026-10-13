// Three.js material that reproduces a Wii GX material: texture coordinate generation, the light
// channels, every TEV stage (colour/alpha combiners, registers, konst colours, swap tables),
// alpha test, blending and depth mode. Values stay in the console's gamma space, so baked vertex
// colours, shadow maps and light maps combine exactly as on the Wii.

import * as THREE from 'three';

const DEG = Math.PI / 180;
const GX_BLEND = [THREE.ZeroFactor, THREE.OneFactor, null, null, THREE.SrcAlphaFactor, THREE.OneMinusSrcAlphaFactor, THREE.DstAlphaFactor, THREE.OneMinusDstAlphaFactor];
const DEPTH = [THREE.NeverDepth, THREE.LessDepth, THREE.EqualDepth, THREE.LessEqualDepth, THREE.GreaterDepth, THREE.NotEqualDepth, THREE.GreaterEqualDepth, THREE.AlwaysDepth];
const KONST_FRACTION = [1, 7 / 8, 3 / 4, 5 / 8, 1 / 2, 3 / 8, 1 / 4, 1 / 8];
const f = (v) => (Number.isInteger(v) ? v.toFixed(1) : String(v));

// Sets a texture matrix the same way the non-TEV materials map an SRT (Maya mode approximation).
export function setTexMatrix(m, scale, rot, trans) {
  m.setUvTransform(-(trans[0] || 0), -(trans[1] || 0), scale[0] || 1, scale[1] || 1, (rot || 0) * DEG, 0, 0);
  return m;
}

function konstColor(sel) {
  if (sel < 8) return `vec3(${f(KONST_FRACTION[sel])})`;
  if (sel >= 0x0C && sel <= 0x0F) return `uKonst[${sel - 0x0C}].rgb`;
  const k = (sel - 0x10) & 3, comp = 'rgba'[(sel - 0x10) >> 2];
  return comp ? `vec3(uKonst[${k}].${comp})` : 'vec3(1.0)';
}

function konstAlpha(sel) {
  if (sel < 8) return f(KONST_FRACTION[sel]);
  if (sel >= 0x10) { const comp = 'rgba'[(sel - 0x10) >> 2]; return comp ? `uKonst[${(sel - 0x10) & 3}].${comp}` : '1.0'; }
  return '1.0';
}

const REG = ['prev', 'c0', 'c1', 'c2'];
const COLOR_IN = ['prev.rgb', 'vec3(prev.a)', 'c0.rgb', 'vec3(c0.a)', 'c1.rgb', 'vec3(c1.a)', 'c2.rgb', 'vec3(c2.a)', 'tex.rgb', 'vec3(tex.a)', 'ras.rgb', 'vec3(ras.a)', 'vec3(1.0)', 'vec3(0.5)', 'konstC', 'vec3(0.0)'];
const ALPHA_IN = ['prev.a', 'c0.a', 'c1.a', 'c2.a', 'tex.a', 'ras.a', 'konstA', '0.0'];
const BIAS = ['0.0', '0.5', '-0.5'];
const SCALE = ['1.0', '2.0', '4.0', '0.5'];
const COMPARE = ['never', '<', '==', '<=', '>', '!=', '>=', 'always'];

function swizzle(table) { return 'rgba'[table[0]] + 'rgba'[table[1]] + 'rgba'[table[2]] + 'rgba'[table[3]]; }

function combiner(op, inputs, isAlpha) {
  const a = `clamp(${inputs[op.a]}, 0.0, 1.0)`, b = `clamp(${inputs[op.b]}, 0.0, 1.0)`, c = `clamp(${inputs[op.c]}, 0.0, 1.0)`, d = inputs[op.d];
  let value;
  if (op.bias === 3) {
    // Compare mode: d + (a OP b ? c : 0). Scale picks the compared width; approximated per channel.
    const cmp = op.sub ? '==' : '>';
    const test = isAlpha || op.scale === 3 ? `${a} ${cmp} ${b}` : `(${a}).r ${cmp} (${b}).r`;
    value = isAlpha || op.scale !== 3 ? `${d} + ((${test}) ? ${c} : ${isAlpha ? '0.0' : 'vec3(0.0)'})`
      : `${d} + mix(vec3(0.0), ${c}, vec3(${op.sub ? 'equal' : 'greaterThan'}(${a}, ${b})))`;
  } else {
    value = `(${d} ${op.sub ? '-' : '+'} mix(${a}, ${b}, ${c}) + ${BIAS[op.bias]}) * ${SCALE[op.scale]}`;
  }
  return op.clamp ? `clamp(${value}, 0.0, 1.0)` : `clamp(${value}, -4.0, 4.0)`;
}

function alphaCompare(comp, ref) {
  if (comp === 0) return 'false';
  if (comp === 7) return 'true';
  return `(outColor.a ${COMPARE[comp]} ${f(ref)})`;
}

// Light channel: material colour (register or vertex colour) times the lighting when enabled.
function channelCode(chan, i, hasColor, lightSet) {
  if (!chan) return `vec4(1.0)`;
  const vc = hasColor && i === 0 ? 'gxColor' : 'vec4(1.0)';
  const part = (ctrl, comp) => {
    const mat = ctrl.matSrc ? `${vc}.${comp}` : `uMat[${i}].${comp}`;
    if (!ctrl.enabled) return mat;
    const amb = ctrl.ambSrc ? `${vc}.${comp}` : `uAmb[${i}].${comp}`;
    // A light set (from the track's posteffect.blight) replaces the channel's lights and ambient colour.
    const ndl = 'dot(uLightView > 0.5 ? N : Nw, uLightDir)';
    const light = ctrl.lights || lightSet ? (ctrl.diffuse === 0 ? 'uLightColor' : `uLightColor * ${ctrl.diffuse === 2 ? `max(${ndl}, 0.0)` : ndl}`) : 'vec3(0.0)';
    const lightComp = comp === 'a' ? `(${light}).r` : `(${light})`;
    return `${mat} * clamp(${amb} + ${lightComp}, 0.0, 1.0)`;
  };
  return `vec4(${part(chan.color, 'rgb')}, ${part(chan.alpha, 'a')})`;
}

export function canUseTEV(mat) {
  const gx = mat?.gx;
  return !!gx && gx.stages.length > 0 && gx.stages.length <= 16;
}

/**
 * mat: parsed MDL0 material with .gx; textures: (texMapId) => THREE.Texture | null (raw, no colour space);
 * uvSets: indices of the UV sets the geometry has; hasColor: geometry has vertex colours (gxColor attribute).
 */
export function makeTEVMaterial(mat, { textures, uvSets, hasColor, lightSets = null }) {
  const gx = mat.gx;
  const lightSet = gx.lightSet >= 0 ? lightSets?.[gx.lightSet] || null : null;
  const texMtx = Array.from({ length: 8 }, (_, i) => setTexMatrix(new THREE.Matrix3(), mat.srt[i]?.scale || [1, 1], mat.srt[i]?.rot || 0, mat.srt[i]?.trans || [0, 0]));
  const used = new Map(); // texMap id -> uniform name
  for (const s of gx.stages) if (s.texEnabled && !used.has(s.texMap) && textures(s.texMap)) used.set(s.texMap, `uTex${s.texMap}`);
  const coords = gx.texGens.length;

  // ---- vertex shader
  const vs = [];
  // The viewport uses a logarithmic depth buffer: these chunks keep the depth consistent with the
  // other materials (grid, markers), otherwise they would show through the track.
  vs.push('#include <common>', '#include <skinning_pars_vertex>', '#include <logdepthbuf_pars_vertex>');
  if (hasColor) vs.push('attribute vec4 gxColor;');
  for (const set of uvSets) vs.push(`attribute vec2 tc${set};`);
  vs.push('uniform vec4 uMat[2];', 'uniform vec4 uAmb[2];', 'uniform vec3 uLightDir;', 'uniform vec3 uLightColor;', 'uniform float uLightView;', 'uniform mat3 uTexMtx[8];');
  vs.push('varying vec4 vRas0;', 'varying vec4 vRas1;');
  for (let i = 0; i < coords; i++) vs.push(`varying vec2 vTc${i};`);
  vs.push('void main() {', '#include <skinbase_vertex>', '#include <begin_vertex>', '#include <beginnormal_vertex>', '#include <skinnormal_vertex>', '#include <skinning_vertex>');
  vs.push('vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);', 'gl_Position = projectionMatrix * mvPosition;', '#include <logdepthbuf_vertex>');
  vs.push('vec3 N = normalize(normalMatrix * objectNormal);', 'vec3 Nw = normalize(mat3(modelMatrix) * objectNormal);');
  vs.push(`vRas0 = ${channelCode(gx.chans[0], 0, hasColor, !!lightSet)};`, `vRas1 = ${channelCode(gx.chans[1], 1, hasColor, !!lightSet)};`);
  gx.texGens.forEach((g, i) => {
    const mode = mat.srt[i]?.mapMode ?? 0;
    let src;
    if (mode === 1 || mode === 3 || mode === 4) src = 'N.xy * vec2(0.5, -0.5) + 0.5';
    else if (mode === 2) src = '(mvPosition.xy / max(-mvPosition.z, 1.0)) * vec2(0.5, -0.5) + 0.5';
    else if (g.source >= 5 && g.source <= 12) src = uvSets.includes(g.source - 5) ? `tc${g.source - 5}` : 'vec2(0.0)';
    else if (g.source === 1) src = 'N.xy * vec2(0.5, -0.5) + 0.5';
    else if (g.source === 0) src = 'transformed.xy';
    else src = 'vec2(0.0)';
    vs.push(`vTc${i} = (uTexMtx[${i}] * vec3(${src}, 1.0)).xy;`);
  });
  vs.push('}');

  // ---- fragment shader
  const fs = ['#include <common>', '#include <logdepthbuf_pars_fragment>'];
  for (const [, name] of used) fs.push(`uniform sampler2D ${name};`);
  fs.push('uniform vec4 uRegs[4];', 'uniform vec4 uKonst[4];', 'uniform float uHighlight;', 'varying vec4 vRas0;', 'varying vec4 vRas1;');
  for (let i = 0; i < coords; i++) fs.push(`varying vec2 vTc${i};`);
  fs.push('void main() {', '#include <logdepthbuf_fragment>', 'vec4 prev = uRegs[0], c0 = uRegs[1], c1 = uRegs[2], c2 = uRegs[3];', 'vec4 tex = vec4(1.0), ras = vec4(1.0); vec3 konstC; float konstA;');
  for (const s of gx.stages) {
    const name = used.get(s.texMap);
    fs.push(`tex = ${s.texEnabled && name && s.texCoord < coords ? `texture2D(${name}, vTc${s.texCoord}).${swizzle(gx.swap[s.alpha.tswap])}` : 'vec4(1.0)'};`);
    const rasSrc = s.channel === 0 ? 'vRas0' : s.channel === 1 ? 'vRas1' : 'vec4(0.0)';
    fs.push(`ras = ${rasSrc}.${swizzle(gx.swap[s.alpha.rswap])};`);
    fs.push(`konstC = ${konstColor(s.kcsel)}; konstA = ${konstAlpha(s.kasel)};`);
    fs.push(`{ vec3 rc = ${combiner(s.color, COLOR_IN, false)}; float ra = ${combiner(s.alpha, ALPHA_IN, true)};`);
    fs.push(`  ${REG[s.color.dest]}.rgb = rc; ${REG[s.alpha.dest]}.a = ra; }`);
  }
  const at = gx.alphaTest;
  const tests = [alphaCompare(at.comp0, at.ref0), alphaCompare(at.comp1, at.ref1)];
  const logic = ['&&', '||', '!=', '=='][at.op];
  fs.push('vec4 outColor = prev;');
  if (!(at.comp0 === 7 && at.comp1 === 7 && at.op === 0)) fs.push(`if (!((${tests[0]}) ${logic} (${tests[1]}))) discard;`);
  fs.push('outColor.rgb = mix(clamp(outColor.rgb, 0.0, 1.0), vec3(1.0, 0.88, 0.54), uHighlight);');
  fs.push(`gl_FragColor = vec4(outColor.rgb, ${gx.blend.enabled ? 'clamp(outColor.a, 0.0, 1.0)' : '1.0'});`, '}');

  const uniforms = {
    uRegs: { value: gx.regs.map((c) => new THREE.Vector4(...c)) },
    uKonst: { value: gx.konst.map((c) => new THREE.Vector4(...c)) },
    uMat: { value: [0, 1].map((i) => new THREE.Vector4(...(gx.chans[i]?.matColor || [1, 1, 1, 1]))) },
    uAmb: { value: [0, 1].map((i) => new THREE.Vector4(...(lightSet?.ambient || gx.chans[i]?.ambColor || [0, 0, 0, 1]))) },
    uLightDir: { value: lightSet ? new THREE.Vector3(...lightSet.dir) : new THREE.Vector3(0.35, 1, 0.45).normalize() },
    uLightColor: { value: lightSet ? new THREE.Vector3(...lightSet.color) : new THREE.Vector3(0.75, 0.75, 0.75) },
    uLightView: { value: lightSet?.view ? 1 : 0 },
    uTexMtx: { value: texMtx },
    uHighlight: { value: 0 },
  };
  const tevTextures = [];
  for (const [id, name] of used) { const t = textures(id); uniforms[name] = { value: t }; tevTextures.push(t); }

  const m = new THREE.ShaderMaterial({ uniforms, vertexShader: vs.join('\n'), fragmentShader: fs.join('\n') });
  m.name = mat.name;
  m.side = mat.cull === 0 ? THREE.DoubleSide : mat.cull === 1 ? THREE.BackSide : THREE.FrontSide;
  m.visible = mat.cull !== 3;
  const b = gx.blend;
  if (b.enabled && !b.logic) {
    const src = b.src === 2 ? THREE.DstColorFactor : b.src === 3 ? THREE.OneMinusDstColorFactor : GX_BLEND[b.src];
    const dst = b.dst === 2 ? THREE.SrcColorFactor : b.dst === 3 ? THREE.OneMinusSrcColorFactor : GX_BLEND[b.dst];
    m.transparent = true;
    m.blending = THREE.CustomBlending;
    m.blendSrc = src ?? THREE.SrcAlphaFactor;
    m.blendDst = dst ?? THREE.OneMinusSrcAlphaFactor;
    m.blendEquation = b.subtract ? THREE.ReverseSubtractEquation : THREE.AddEquation;
  } else m.transparent = !!mat.xlu;
  m.depthTest = gx.zmode.test;
  m.depthWrite = gx.zmode.write;
  m.depthFunc = DEPTH[gx.zmode.func] ?? THREE.LessEqualDepth;
  m.userData.tev = true;
  m.userData.texMtx = texMtx;
  m.userData.srt = mat.srt;
  m.userData.tevTextures = tevTextures;
  m.userData.brresMaterial = mat;
  return m;
}
