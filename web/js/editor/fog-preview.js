// A picture of the track with a fog entry on it, drawn apart from the main view. The track's distance
// from the camera is rendered first, then fog is laid over the colour by the same formulas as
// fogAmount, so it does not depend on how the track's materials are built. The sky stays clear, and
// every material is taken to receive the fog.

import * as THREE from 'three';

const DISTANCE = new THREE.ShaderMaterial({
  vertexShader: 'varying float away; void main() { vec4 p = modelViewMatrix * vec4(position, 1.0); away = -p.z; gl_Position = projectionMatrix * p; }',
  fragmentShader: 'varying float away; void main() { gl_FragColor = vec4(away, 1.0, 0.0, 1.0); }',
  side: THREE.DoubleSide,
});

const FOG = new THREE.ShaderMaterial({
  uniforms: { colour: { value: null }, away: { value: null }, tint: { value: new THREE.Vector3() }, start: { value: 0 }, end: { value: 1 }, shape: { value: 0 } },
  vertexShader: 'varying vec2 at; void main() { at = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: `
    varying vec2 at;
    uniform sampler2D colour, away;
    uniform vec3 tint;
    uniform float start, end;
    uniform int shape;
    vec3 encode(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
    void main() {
      vec3 base = encode(texture2D(colour, at).rgb);
      vec2 far = texture2D(away, at).rg;
      float amount = 0.0;
      if (far.g > 0.5 && shape > 0) {
        float f = clamp((far.r - start) / max(end - start, 0.001), 0.0, 1.0);
        amount = shape == 1 ? f : shape == 2 ? 1.0 - pow(2.0, -8.0 * f) : shape == 3 ? 1.0 - pow(2.0, -8.0 * f * f)
          : shape == 4 ? pow(2.0, -8.0 * (1.0 - f)) : pow(2.0, -8.0 * (1.0 - f) * (1.0 - f));
      }
      gl_FragColor = vec4(mix(base, tint, amount), 1.0);
    }`,
  depthTest: false, depthWrite: false,
});
const quadScene = new THREE.Scene();
quadScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), FOG));
const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

export class FogPreview {
  constructor(viewport, width, height) {
    this.viewport = viewport;
    this.width = width;
    this.height = height;
    this.colour = new THREE.WebGLRenderTarget(width, height, { depthBuffer: true });
    this.distance = new THREE.WebGLRenderTarget(width, height, { depthBuffer: true, type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.output = new THREE.WebGLRenderTarget(width, height, { depthBuffer: false });
    this.pixels = new Uint8Array(width * height * 4);
  }

  // Only the track model and sky, however the main view is set.
  draw(camera) {
    const vp = this.viewport, { renderer, scene } = vp;
    const only = new Set([vp.courseGroup, vp.skyGroup]);
    const kept = scene.children.map((child) => [child, child.visible]);
    const fog = scene.fog, clear = renderer.getClearColor(new THREE.Color()), alpha = renderer.getClearAlpha(), target = renderer.getRenderTarget();
    try {
      for (const [child] of kept) child.visible = only.has(child);
      scene.fog = null;
      renderer.setRenderTarget(this.colour);
      renderer.clear();
      renderer.render(scene, camera);
      vp.skyGroup.visible = false;
      scene.overrideMaterial = DISTANCE;
      renderer.setRenderTarget(this.distance);
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      renderer.render(scene, camera);
    } finally {
      scene.overrideMaterial = null;
      scene.fog = fog;
      for (const [child, visible] of kept) child.visible = visible;
      renderer.setClearColor(clear, alpha);
      renderer.setRenderTarget(target);
    }
  }

  // entry: as in bfg.js. Puts the picture on a 2D canvas of this size.
  show(canvas, entry) {
    const { renderer } = this.viewport, target = renderer.getRenderTarget(), u = FOG.uniforms;
    u.colour.value = this.colour.texture;
    u.away.value = this.distance.texture;
    u.tint.value.set(...entry.color.map((c) => c / 255));
    u.start.value = entry.start;
    u.end.value = entry.end;
    u.shape.value = entry.type > 0 ? ((entry.type - 1) % 5) + 1 : 0;
    renderer.setRenderTarget(this.output);
    renderer.render(quadScene, quadCamera);
    renderer.readRenderTargetPixels(this.output, 0, 0, this.width, this.height, this.pixels);
    renderer.setRenderTarget(target);
    const picture = new ImageData(this.width, this.height), row = this.width * 4;
    for (let y = 0; y < this.height; y++) picture.data.set(this.pixels.subarray((this.height - 1 - y) * row, (this.height - y) * row), y * row);
    canvas.getContext('2d').putImageData(picture, 0, 0);
  }

  dispose() {
    this.colour.dispose();
    this.distance.dispose();
    this.output.dispose();
  }
}
