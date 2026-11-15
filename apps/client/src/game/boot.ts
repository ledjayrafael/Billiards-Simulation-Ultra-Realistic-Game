import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// M0: scene kosong + aset uji dari Blender
const renderer = new THREE.WebGLRenderer({ antialias: true });
document.body.style.margin = '0';
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x101418);
const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 50);
camera.position.set(0.6, 0.5, 0.8);
camera.lookAt(0, 0.1, 0);
scene.add(new THREE.HemisphereLight(0xffffff, 0x202028, 2));
new GLTFLoader().load('/assets/m0_cube.glb', (g) => scene.add(g.scene));
function frame(): void {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  scene.rotation.y += 0.005;
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
frame();
