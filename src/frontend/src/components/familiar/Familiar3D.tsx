import React, { useRef, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { useGLTF, useAnimations, PerspectiveCamera } from '@react-three/drei';
import * as THREE from 'three';
import type { FamiliarPose } from '@shared/types';

export type FamiliarEmotion = 'neutral' | 'alert' | 'happy' | 'sleepy';

interface Familiar3DProps {
  pose: FamiliarPose | 'running' | 'jumping';
  pointAngle?: number;
  pointLength?: number;
  emotion?: FamiliarEmotion;
  onLoaded?: () => void;
}

function Model({ pose, pointAngle = 0, emotion = 'neutral', onLoaded }: Familiar3DProps) {
  const group = useRef<THREE.Group>(null);
  const { scene, animations } = useGLTF('/assets/familiar.glb');
  const { actions, names } = useAnimations(animations, group);

  // Auto-play default idle animation
  useEffect(() => {
    const idleName = names.find(n => n.toLowerCase().includes('idle')) || names[0];
    const idleAction = actions[idleName];
    if (idleAction) {
      idleAction.reset().fadeIn(0.5).play();
    }
    return () => {
      if (idleAction) idleAction.fadeOut(0.5);
    };
  }, [actions, names]);

  // Notify parent that the model has loaded
  useEffect(() => {
    onLoaded?.();
  }, [onLoaded]);

  // Handle pose transitions
  useEffect(() => {
    const poseMap: Record<string, string> = {
      idle: 'idle',
      floating: 'idle',
      running: 'run',
      jumping: 'jump',
      pointing: 'idle',
    };

    const targetBase = poseMap[pose] || pose;
    const actionName = names.find(n => n.toLowerCase().includes(targetBase.toLowerCase())) || names[0];
    const action = actions[actionName];

    if (action) {
      Object.values(actions).forEach((a) => a?.fadeOut(0.3));
      action.reset().fadeIn(0.3).play();
    }
  }, [pose, actions, names]);

  // Cache morph targets to avoid expensive scene.traverse every frame
  const morphMeshes = useRef<THREE.SkinnedMesh[]>([]);
  useEffect(() => {
    const meshes: THREE.SkinnedMesh[] = [];
    scene.traverse((child) => {
      if (child instanceof THREE.SkinnedMesh && child.morphTargetInfluences) {
        meshes.push(child);
      }
    });
    morphMeshes.current = meshes;
  }, [scene]);

  // Procedural Look-At, Breathing and Emotions
  useFrame((state) => {
    if (!group.current) return;

    const t = state.clock.elapsedTime;

    // 1. Look-At Logic (Head/Neck)
    const head = group.current.getObjectByName('Head') || 
                 group.current.getObjectByName('Neck') ||
                 group.current.getObjectByName('mixamorigHead');
    
    if (head) {
      const targetRotY = pose === 'pointing' ? -pointAngle : 0;
      head.rotation.y = THREE.MathUtils.lerp(head.rotation.y, targetRotY, 0.1);
      head.rotation.x = THREE.MathUtils.lerp(head.rotation.x, Math.sin(t) * 0.05, 0.05);
    }

    // 2. Floating micro-bobbing
    if (pose === 'idle' || pose === 'floating') {
      group.current.position.y = Math.sin(t * 1.5) * 0.15;
    }

    // 3. Morph Target Emotions (Face)
    morphMeshes.current.forEach((child) => {
      const dictionary = child.morphTargetDictionary;
      if (!dictionary || !child.morphTargetInfluences) return;

      // Reset all
      child.morphTargetInfluences.fill(0);

      // Blinking (procedural)
      const blinkIndex = dictionary['blink'] || dictionary['Blink'] || dictionary['Eyes_Closed'];
      if (blinkIndex !== undefined) {
        const blink = Math.sin(t * 0.5) > 0.98 ? 1 : 0;
        child.morphTargetInfluences[blinkIndex] = THREE.MathUtils.lerp(child.morphTargetInfluences[blinkIndex], blink, 0.5);
      }

      // Emotion-based morphs
      if (emotion === 'happy') {
        const smile = dictionary['smile'] || dictionary['Smile'] || dictionary['Mouth_Smile'];
        if (smile !== undefined) child.morphTargetInfluences[smile] = 0.8;
      } else if (emotion === 'alert') {
        const angry = dictionary['angry'] || dictionary['Angry'] || dictionary['Brows_Down'];
        if (angry !== undefined) child.morphTargetInfluences[angry] = 0.9;
      } else if (emotion === 'sleepy') {
        const closed = dictionary['blink'] || dictionary['Blink'] || dictionary['Eyes_Closed'];
        if (closed !== undefined) child.morphTargetInfluences[closed] = 0.7;
      }
    });
  });

  return <primitive ref={group} object={scene} dispose={null} scale={2} />;
}

export function Familiar3D(props: Familiar3DProps) {
  return (
    <div style={{ width: '130px', height: '182px', pointerEvents: 'none' }}>
      <Canvas 
        gl={{ 
          antialias: true, 
          alpha: true, 
          powerPreference: 'default', // Changed from 'high-performance' for stability
          failIfMajorPerformanceCaveat: false,
          preserveDrawingBuffer: false
        }}
        onCreated={({ gl }) => {
          const canvas = gl.domElement;
          canvas.addEventListener('webglcontextlost', (e) => {
            e.preventDefault();
            console.warn('WebGL Context Lost. Familiar is sleeping.');
          }, false);
          canvas.addEventListener('webglcontextrestored', () => {
            console.info('WebGL Context Restored. Familiar is back.');
          }, false);
        }}
      >
        <PerspectiveCamera makeDefault position={[0, 0, 4.5]} fov={40} />
        <ambientLight intensity={1.0} />
        <directionalLight position={[5, 5, 5]} intensity={0.5} />
        
        <React.Suspense fallback={null}>
          <Model {...props} />
        </React.Suspense>
      </Canvas>
    </div>
  );
}
