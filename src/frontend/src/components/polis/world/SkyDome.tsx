/** Небо-градієнт із теплим світінням над обрієм. Спільне для міста й
 * інтер'єру, щоб перехід між ними не змінював атмосферу. */
import { useMemo } from 'react';
import * as THREE from 'three';

const VERT = `
varying vec3 vP;
void main() {
  vP = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAG = `
varying vec3 vP;
uniform vec3 top;
uniform vec3 horizon;
uniform vec3 glow;
void main() {
  float h = normalize(vP).y;
  vec3 c = mix(horizon, top, smoothstep(-0.02, 0.55, h));
  c = mix(c, glow, pow(max(0.0, 1.0 - abs(h - 0.03) * 4.5), 3.0));
  c = mix(c, horizon * 0.55, smoothstep(0.0, -0.35, h));
  gl_FragColor = vec4(c, 1.0);
}`;

export function SkyDome({
  radius = 220,
  top = '#120c1e',
  horizon = '#3a2418',
  glow = '#8a4d22',
}: {
  radius?: number;
  top?: string;
  horizon?: string;
  glow?: string;
}) {
  const uniforms = useMemo(() => ({
    top: { value: new THREE.Color(top) },
    horizon: { value: new THREE.Color(horizon) },
    glow: { value: new THREE.Color(glow) },
  }), [top, horizon, glow]);

  return (
    <mesh renderOrder={-1} frustumCulled={false}>
      <sphereGeometry args={[radius, 32, 20]} />
      <shaderMaterial
        vertexShader={VERT}
        fragmentShader={FRAG}
        uniforms={uniforms}
        side={THREE.BackSide}
        depthWrite={false}
        fog={false}
        toneMapped={false}
      />
    </mesh>
  );
}
