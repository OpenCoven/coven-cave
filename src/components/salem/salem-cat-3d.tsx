"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

type SalemMood = "idle" | "thinking" | "happy" | "listening";

type Props = {
  mood?: SalemMood;
  size?: number;
};

/**
 * Salem — 3D pixie black cat built with raw Three.js.
 * Renders in a small canvas, no external model file needed.
 * Mood drives ear twitch, tail wag, and eye blink animations.
 */
export function SalemCat3D({ mood = "idle", size = 96 }: Props) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    cat: THREE.Group;
    tail: THREE.Mesh;
    leftEar: THREE.Mesh;
    rightEar: THREE.Mesh;
    leftEye: THREE.Mesh;
    rightEye: THREE.Mesh;
    leftPupil: THREE.Mesh;
    rightPupil: THREE.Mesh;
    frame: number;
  } | null>(null);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(size, size);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 0.2, 3.2);
    camera.lookAt(0, 0, 0);

    // Lighting
    const ambLight = new THREE.AmbientLight(0xffffff, 0.72);
    scene.add(ambLight);
    const pointLight = new THREE.PointLight(0xb39ddb, 1.8, 10);
    pointLight.position.set(2, 3, 2);
    scene.add(pointLight);
    const rimLight = new THREE.PointLight(0x9c6fe4, 1.15, 8);
    rimLight.position.set(-2, -1, 1);
    scene.add(rimLight);

    const cat = new THREE.Group();
    scene.add(cat);

    // Material palette
    const blackMat = new THREE.MeshStandardMaterial({ color: 0x171520, roughness: 0.52, metalness: 0.12 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x211d31, roughness: 0.62 });
    const glowMat = new THREE.MeshStandardMaterial({ color: 0xb388ff, emissive: 0x7c4dff, emissiveIntensity: 0.9, roughness: 0.2 });
    const pupilMat = new THREE.MeshStandardMaterial({ color: 0x1a0a2e, roughness: 0.9 });
    const noseMat = new THREE.MeshStandardMaterial({ color: 0xce93d8, roughness: 0.4 });
    const innerEarMat = new THREE.MeshStandardMaterial({ color: 0x7e57c2, roughness: 0.5 });

    // Body — squarish rounded blob
    const bodyGeo = new THREE.SphereGeometry(0.42, 16, 16);
    const body = new THREE.Mesh(bodyGeo, blackMat);
    body.scale.set(1, 1.1, 0.9);
    body.position.set(0, -0.22, 0);
    cat.add(body);

    // Head
    const headGeo = new THREE.SphereGeometry(0.34, 16, 16);
    const head = new THREE.Mesh(headGeo, blackMat);
    head.position.set(0, 0.35, 0.04);
    cat.add(head);

    // Ears — pointy triangle-ish cones
    const earGeo = new THREE.ConeGeometry(0.13, 0.26, 5);
    const leftEar = new THREE.Mesh(earGeo, blackMat);
    leftEar.position.set(-0.2, 0.61, 0.02);
    leftEar.rotation.z = 0.18;
    cat.add(leftEar);

    const rightEar = new THREE.Mesh(earGeo.clone(), blackMat);
    rightEar.position.set(0.2, 0.61, 0.02);
    rightEar.rotation.z = -0.18;
    cat.add(rightEar);

    // Inner ear detail
    const innerEarGeo = new THREE.ConeGeometry(0.07, 0.16, 5);
    const leftInnerEar = new THREE.Mesh(innerEarGeo, innerEarMat);
    leftInnerEar.position.set(-0.2, 0.61, 0.05);
    leftInnerEar.rotation.z = 0.18;
    cat.add(leftInnerEar);
    const rightInnerEar = new THREE.Mesh(innerEarGeo.clone(), innerEarMat);
    rightInnerEar.position.set(0.2, 0.61, 0.05);
    rightInnerEar.rotation.z = -0.18;
    cat.add(rightInnerEar);

    // Eyes — glowing purple ovals
    const eyeGeo = new THREE.SphereGeometry(0.075, 12, 12);
    const leftEye = new THREE.Mesh(eyeGeo, glowMat);
    leftEye.position.set(-0.12, 0.38, 0.3);
    leftEye.scale.set(1, 0.8, 0.6);
    cat.add(leftEye);

    const rightEye = new THREE.Mesh(eyeGeo.clone(), glowMat);
    rightEye.position.set(0.12, 0.38, 0.3);
    rightEye.scale.set(1, 0.8, 0.6);
    cat.add(rightEye);

    // Pupils
    const pupilGeo = new THREE.SphereGeometry(0.045, 8, 8);
    const leftPupil = new THREE.Mesh(pupilGeo, pupilMat);
    leftPupil.position.set(-0.12, 0.38, 0.36);
    leftPupil.scale.set(0.5, 1, 0.3);
    cat.add(leftPupil);

    const rightPupil = new THREE.Mesh(pupilGeo.clone(), pupilMat);
    rightPupil.position.set(0.12, 0.38, 0.36);
    rightPupil.scale.set(0.5, 1, 0.3);
    cat.add(rightPupil);

    // Nose — tiny tetrahedron-ish
    const noseGeo = new THREE.SphereGeometry(0.032, 6, 6);
    const nose = new THREE.Mesh(noseGeo, noseMat);
    nose.position.set(0, 0.3, 0.33);
    cat.add(nose);

    // Tail — curved tube via CatmullRomCurve3
    const tailCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.3, -0.52, 0),
      new THREE.Vector3(0.65, -0.44, 0),
      new THREE.Vector3(0.82, -0.1, 0),
      new THREE.Vector3(0.72, 0.18, 0),
      new THREE.Vector3(0.54, 0.28, 0),
    ]);
    const tailGeo = new THREE.TubeGeometry(tailCurve, 20, 0.055, 8, false);
    const tail = new THREE.Mesh(tailGeo, darkMat);
    cat.add(tail);

    // Tiny feet / paws
    const pawGeo = new THREE.SphereGeometry(0.11, 8, 8);
    const leftPaw = new THREE.Mesh(pawGeo, blackMat);
    leftPaw.position.set(-0.2, -0.6, 0.15);
    leftPaw.scale.set(1.1, 0.6, 1.2);
    cat.add(leftPaw);
    const rightPaw = new THREE.Mesh(pawGeo.clone(), blackMat);
    rightPaw.position.set(0.2, -0.6, 0.15);
    rightPaw.scale.set(1.1, 0.6, 1.2);
    cat.add(rightPaw);

    // Small sparkles floating around Salem
    const sparkleMat = new THREE.MeshStandardMaterial({ color: 0xd1c4e9, emissive: 0x9c27b0, emissiveIntensity: 1.2 });
    const sparkles: Array<{ mesh: THREE.Mesh; phi: number; speed: number; r: number; yOff: number }> = [];
    for (let i = 0; i < 5; i++) {
      const sg = new THREE.OctahedronGeometry(0.03 + Math.random() * 0.025);
      const sm = new THREE.Mesh(sg, sparkleMat);
      const phi = (i / 5) * Math.PI * 2;
      const r = 0.58 + Math.random() * 0.12;
      sm.position.set(Math.cos(phi) * r, -0.1 + Math.random() * 0.6, Math.sin(phi) * r * 0.4);
      cat.add(sm);
      sparkles.push({ mesh: sm, phi, speed: 0.4 + Math.random() * 0.6, r, yOff: sm.position.y });
    }

    sceneRef.current = {
      renderer, scene, camera, cat, tail,
      leftEar, rightEar, leftEye, rightEye, leftPupil, rightPupil,
      frame: 0,
    };

    let animId: number;
    let t = 0;
    let blinkT = 0;
    let nextBlink = 3 + Math.random() * 4;

    const animate = () => {
      animId = requestAnimationFrame(animate);
      t += 0.016;
      blinkT += 0.016;

      // Gentle body float
      cat.position.y = Math.sin(t * 0.9) * 0.025;
      cat.rotation.y = Math.sin(t * 0.4) * 0.06;

      // Mood-driven animations
      if (mood === "idle") {
        tail.rotation.z = Math.sin(t * 1.1) * 0.22;
        leftEar.rotation.z = 0.18;
        rightEar.rotation.z = -0.18;
      } else if (mood === "happy") {
        tail.rotation.z = Math.sin(t * 2.4) * 0.45;
        leftEar.rotation.z = 0.18 + Math.sin(t * 3) * 0.12;
        rightEar.rotation.z = -0.18 - Math.sin(t * 3) * 0.12;
        cat.position.y += Math.abs(Math.sin(t * 2.2)) * 0.03;
      } else if (mood === "thinking") {
        tail.rotation.z = Math.sin(t * 0.6) * 0.15;
        leftEar.rotation.z = 0.28;
        rightEar.rotation.z = -0.28;
        leftPupil.scale.set(0.3, 1.2, 0.3);
        rightPupil.scale.set(0.3, 1.2, 0.3);
      } else if (mood === "listening") {
        tail.rotation.z = Math.sin(t * 1.6) * 0.3;
        leftEar.rotation.z = 0.05;
        rightEar.rotation.z = -0.05;
      }

      // Blink
      if (blinkT >= nextBlink) {
        const blinkPhase = blinkT - nextBlink;
        if (blinkPhase < 0.12) {
          const s = 1 - blinkPhase / 0.06;
          leftEye.scale.set(1, Math.max(0.05, s) * 0.8, 0.6);
          rightEye.scale.set(1, Math.max(0.05, s) * 0.8, 0.6);
        } else if (blinkPhase < 0.24) {
          const s = (blinkPhase - 0.12) / 0.12;
          leftEye.scale.set(1, Math.max(0.05, s) * 0.8, 0.6);
          rightEye.scale.set(1, Math.max(0.05, s) * 0.8, 0.6);
        } else {
          leftEye.scale.set(1, 0.8, 0.6);
          rightEye.scale.set(1, 0.8, 0.6);
          blinkT = 0;
          nextBlink = 2 + Math.random() * 5;
        }
      }

      // Sparkle orbit
      sparkles.forEach((s) => {
        s.phi += s.speed * 0.016;
        s.mesh.position.x = Math.cos(s.phi) * s.r;
        s.mesh.position.z = Math.sin(s.phi) * s.r * 0.4;
        s.mesh.position.y = s.yOff + Math.sin(s.phi * 2 + t) * 0.06;
        s.mesh.rotation.y += 0.04;
      });

      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(animId);
      renderer.dispose();
      if (el.contains(renderer.domElement)) el.removeChild(renderer.domElement);
      sceneRef.current = null;
    };
  }, [size, mood]);

  return (
    <div
      ref={canvasRef}
      style={{ width: size, height: size, display: "block" }}
      aria-hidden="true"
    />
  );
}
