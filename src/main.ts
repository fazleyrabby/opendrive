import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

// --- GAME STATE & CONSTANTS ---
const keys = { ArrowUp: false, ArrowDown: false, ArrowLeft: false, ArrowRight: false };

const carState = {
    speed: 0,
    acceleration: 20,
    maxSpeed: 75,
    friction: 12,
    rotationSpeed: 1.5,
    reverseSpeed: 20
};

// --- AUDIO SYSTEM ---
let audioCtx: AudioContext | null = null;
let engineOsc: OscillatorNode | null = null;
let engineGain: GainNode | null = null;
let engineStopTimeout: number | null = null;
let isEngineRunning = false;

// BGM System
let bgmState = 0; // 0: Off, 1: Cyber Drone, 2: Wind
let bgmGain: GainNode | null = null;
let bgmSources: (AudioBufferSourceNode | OscillatorNode)[] = [];
let windFilter: BiquadFilterNode | null = null;

function initAudio() {
    if (audioCtx) return;
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    audioCtx = new AudioContextClass();
    
    engineOsc = audioCtx.createOscillator();
    engineOsc.type = 'sawtooth';
    engineOsc.frequency.value = 50; 

    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 300;

    engineGain = audioCtx.createGain();
    engineGain.gain.value = 0.05; 

    engineOsc.connect(filter);
    filter.connect(engineGain);
    engineGain.connect(audioCtx.destination);
    
    engineOsc.start();
}

function updateAudio() {
    if (!audioCtx || !engineOsc || !engineGain) return;
    const speedRatio = Math.abs(carState.speed) / carState.maxSpeed;
    const targetFreq = 40 + (speedRatio * 120);
    const accelerationBoost = (keys.ArrowUp && carState.speed >= -5) || (keys.ArrowDown && carState.speed <= 5) ? 25 : 0;
    
    engineOsc.frequency.setTargetAtTime(targetFreq + accelerationBoost, audioCtx.currentTime, 0.1);
    
    if (isEngineRunning || Math.abs(carState.speed) > 1) {
        const targetVolume = 0.05 + (speedRatio * 0.15);
        engineGain.gain.setTargetAtTime(targetVolume, audioCtx.currentTime, 0.1);
    } else {
        engineGain.gain.setTargetAtTime(0, audioCtx.currentTime, 0.8);
    }
    
    if (bgmState === 2 && windFilter) {
        // Modulate wind cutoff based on speed
        windFilter.frequency.setTargetAtTime(300 + (speedRatio * 500), audioCtx.currentTime, 0.2);
    }
}

function switchBGM() {
    bgmState = (bgmState + 1) % 3;
    const labels = ["BGM: Off", "BGM: Cyber Drone", "BGM: High Winds"];
    const indicator = document.getElementById('bgm-indicator');
    if (indicator) indicator.innerText = labels[bgmState];
    applyBGM();
}

function applyBGM() {
    if (!audioCtx) return;
    if (!bgmGain) {
        bgmGain = audioCtx.createGain();
        bgmGain.connect(audioCtx.destination);
    }
    
    // Stop all old
    bgmSources.forEach(s => { s.stop(); s.disconnect(); });
    bgmSources = [];
    windFilter = null;
    
    if (bgmState === 1) { // Cyber Drone
        bgmGain.gain.cancelScheduledValues(audioCtx.currentTime);
        bgmGain.gain.setValueAtTime(0, audioCtx.currentTime);
        bgmGain.gain.linearRampToValueAtTime(0.08, audioCtx.currentTime + 1);

        const baseFreq = 41.20; // E1
        const chord = [baseFreq, baseFreq * 1.5, baseFreq * 2.0];
        chord.forEach((f, i) => {
            const osc = audioCtx!.createOscillator();
            osc.type = i === 0 ? 'square' : 'sawtooth';
            osc.frequency.value = f;
            
            const filter = audioCtx!.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.value = 600; 
            
            osc.connect(filter);
            filter.connect(bgmGain!);
            osc.start();
            bgmSources.push(osc);
        });
    } 
    else if (bgmState === 2) { // Wind
        bgmGain.gain.cancelScheduledValues(audioCtx.currentTime);
        bgmGain.gain.setValueAtTime(0, audioCtx.currentTime);
        bgmGain.gain.linearRampToValueAtTime(0.5, audioCtx.currentTime + 1);

        const bufSize = audioCtx.sampleRate * 3;
        const buf = audioCtx.createBuffer(1, bufSize, audioCtx.sampleRate);
        const output = buf.getChannelData(0);
        for(let i=0; i<bufSize; i++) output[i] = (Math.random() * 2 - 1) * 0.5;
        
        const noise = audioCtx.createBufferSource();
        noise.buffer = buf;
        noise.loop = true;
        
        windFilter = audioCtx.createBiquadFilter();
        windFilter.type = 'bandpass';
        windFilter.frequency.value = 400; 
        windFilter.Q.value = 1.2;
        
        noise.connect(windFilter);
        windFilter.connect(bgmGain);
        noise.start();
        bgmSources.push(noise);        
    } 
    else { // Off
        bgmGain.gain.cancelScheduledValues(audioCtx.currentTime);
        bgmGain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 1);
    }
}


// --- DOM SETUP ---
const container = document.getElementById('root')!;
const loadingElement = document.getElementById('loading')!;
const speedoValDisplay = document.getElementById('speedo-val');
const themeIndicator = document.getElementById('theme-indicator');

// --- SCENE SETUP ---
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
const gltfLoader = new GLTFLoader();
gltfLoader.setDRACOLoader(dracoLoader);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 1000);

const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0; 
container.appendChild(renderer.domElement);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xfffff0, 2.0);
dirLight.position.set(50, 100, 50);
dirLight.castShadow = true;
dirLight.shadow.camera.top = 100; dirLight.shadow.camera.bottom = -100;
dirLight.shadow.camera.left = -100; dirLight.shadow.camera.right = 100;
dirLight.shadow.camera.near = 0.1; dirLight.shadow.camera.far = 400;
dirLight.shadow.bias = -0.001;
scene.add(dirLight);

const loadingManager = new THREE.LoadingManager();
loadingManager.onLoad = () => { if(loadingElement) loadingElement.style.display = 'none'; };
setTimeout(() => { if(loadingElement) loadingElement.style.display = 'none'; }, 2000);

// --- PROCEDURAL CURVE ---
function getCurveOffset(z: number) {
    return Math.sin(z * 0.012) * 18 + Math.sin(z * 0.003) * 45;
}

function applyCurve(geo: THREE.BufferGeometry, fixedXOffset: number, meshZ: number) {
    if(!geo.userData.originalX) {
        const count = geo.attributes.position.count;
        geo.userData.originalX = new Float32Array(count);
        for(let i=0; i<count; i++) {
            geo.userData.originalX[i] = geo.attributes.position.getX(i) + fixedXOffset;
        }
    }
    const pos = geo.attributes.position;
    const originX = geo.userData.originalX;
    for(let i=0; i<pos.count; i++) {
        const localY = pos.getY(i);
        const worldZ = meshZ - localY;
        const curve = getCurveOffset(worldZ);
        pos.setX(i, originX[i] + curve);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
}

// --- TEXTURES ---
function createRoadTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 1024; canvas.height = 1024;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#1e1e1e';
    ctx.fillRect(0, 0, 1024, 1024);
    for(let i=0; i<30000; i++) {
        ctx.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.06)';
        ctx.fillRect(Math.random()*1024, Math.random()*1024, 2, 2);
    }
    ctx.strokeStyle = '#e6b800'; ctx.lineWidth = 15;
    ctx.beginPath();
    ctx.moveTo(500, 0); ctx.lineTo(500, 1024);
    ctx.moveTo(524, 0); ctx.lineTo(524, 1024);
    ctx.stroke();
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 18; ctx.setLineDash([80, 40]);
    ctx.beginPath();
    ctx.moveTo(35, 0); ctx.lineTo(35, 1024);
    ctx.moveTo(989, 0); ctx.lineTo(989, 1024);
    ctx.stroke();
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return tex;
}

function createGrassTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 512;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#1e3812'; ctx.fillRect(0, 0, 512, 512);
    for(let i=0; i<15000; i++) {
        ctx.fillStyle = Math.random() > 0.5 ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.05)';
        ctx.fillRect(Math.random()*512, Math.random()*512, 3, 3);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return tex;
}

// --- ENVIRONMENT BUILD ---
const roadLength = 400;
const roadRepeat = 40;
const roadSegments = 100;

const roadTex = createRoadTexture();
roadTex.repeat.set(1, roadRepeat);

const roadMat = new THREE.MeshStandardMaterial({ 
    map: roadTex, roughness: 0.9, metalness: 0.1, color: 0x999999
});
const roadGeo = new THREE.PlaneGeometry(16, roadLength, 4, roadSegments);
const road = new THREE.Mesh(roadGeo, roadMat);
road.rotation.x = -Math.PI / 2;
road.receiveShadow = true;
scene.add(road);

const edgeMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
const edgeGeo1 = new THREE.PlaneGeometry(1.2, roadLength, 1, roadSegments);
const edgeGeo2 = new THREE.PlaneGeometry(1.2, roadLength, 1, roadSegments);
const edge1 = new THREE.Mesh(edgeGeo1, edgeMat);
const edge2 = new THREE.Mesh(edgeGeo2, edgeMat);
edge1.rotation.x = -Math.PI / 2; edge1.position.y = 0.02;
edge2.rotation.x = -Math.PI / 2; edge2.position.y = 0.02;
scene.add(edge1, edge2);

const grassTex = createGrassTexture();
grassTex.repeat.set(60, 60);
const grassMat = new THREE.MeshStandardMaterial({ map: grassTex, roughness: 1.0 });
const grassGeo = new THREE.PlaneGeometry(600, 600, 20, 20); 
const grass = new THREE.Mesh(grassGeo, grassMat);
grass.rotation.x = -Math.PI / 2;
grass.position.y = -0.05;
grass.receiveShadow = true;
scene.add(grass); 

// --- ROBUST LOW-POLY TREES ---
// Replacing glitchy external scale-broken trees with beautifully consistent procedural low-poly
const treesGroup = new THREE.Group();
const treesConfig: { mesh: THREE.Object3D, baseZ: number, offsetX: number }[] = [];

const leavesMat = new THREE.MeshStandardMaterial({ color: 0x1f3a15, roughness: 0.9, flatShading: true });
const trunkMat = new THREE.MeshStandardMaterial({ color: 0x3d2817, roughness: 0.9, flatShading: true });

const leavesGeo1 = new THREE.ConeGeometry(3.5, 6.0, 5); // 5 radial segments = stylistic low poly
const leavesGeo2 = new THREE.ConeGeometry(2.8, 5.0, 5);
const leavesGeo3 = new THREE.ConeGeometry(2.0, 3.5, 5);
const trunkGeo = new THREE.CylinderGeometry(0.5, 0.8, 3, 5);

for(let i=0; i<120; i++) {
    const tree = new THREE.Group();
    
    // Layer the needles/leaves
    const l1 = new THREE.Mesh(leavesGeo1, leavesMat);
    l1.position.y = 4.0; l1.castShadow = true; l1.receiveShadow = true;
    
    const l2 = new THREE.Mesh(leavesGeo2, leavesMat);
    l2.position.y = 7.0; l2.castShadow = true; l2.receiveShadow = true;
    
    const l3 = new THREE.Mesh(leavesGeo3, leavesMat);
    l3.position.y = 9.8; l3.castShadow = true; l3.receiveShadow = true;
    
    // Base trunk
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.y = 1.5; trunk.castShadow = true; trunk.receiveShadow = true;
    
    tree.add(trunk, l1, l2, l3);
    
    // Randomize rotation & size
    tree.rotation.y = Math.random() * Math.PI * 2;
    const scale = 0.8 + Math.random() * 1.5; // Big variation
    tree.scale.set(scale, scale, scale);

    const side = i % 2 === 0 ? 1 : -1;
    const distance = 15 + Math.random() * 60;
    const offsetX = side * distance;
    const baseZ = (Math.random() - 0.5) * 500; 
    tree.position.set(offsetX, -0.05, baseZ);
    
    treesGroup.add(tree);
    treesConfig.push({ mesh: tree, baseZ, offsetX });
}
scene.add(treesGroup);

// --- STREETLIGHTS ---
const streetlightsGroup = new THREE.Group();
const streetlightsConfig: { mesh: THREE.Group, baseZ: number, offsetX: number, pointLight: THREE.PointLight | null }[] = [];
scene.add(streetlightsGroup);

const poleGeo = new THREE.CylinderGeometry(0.15, 0.25, 12, 8);
const poleMat = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.7, roughness: 0.3 });
const bulbGeo = new THREE.SphereGeometry(0.6, 8, 8);
const sgBulbMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffdd88, emissiveIntensity: 0 });

for(let i=0; i<40; i++) {
    const sl = new THREE.Group();
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.y = 6;
    pole.castShadow = true;
    const bulb = new THREE.Mesh(bulbGeo, sgBulbMat.clone());
    bulb.position.set(0, 12, 0);
    sl.add(pole, bulb);

    const isLeft = i % 2 === 0;
    const offsetX = isLeft ? -9.5 : 9.5; 
    const baseZ = (i - 20) * 45; 

    sl.position.set(offsetX, 0, baseZ);
    streetlightsGroup.add(sl);
    
    let pointLight = null;
    if (i % 5 === 0) { // Add actual point lights to every 5th pole for performance
        pointLight = new THREE.PointLight(0xffdd88, 0, 80);
        pointLight.position.set(0, 11, 0);
        sl.add(pointLight);
    }

    streetlightsConfig.push({ mesh: sl, baseZ, offsetX, pointLight });
}

// Attempt to load genuine free 3D tree resources
// (We use a single beautiful Beech tree here because extracting a random node from the forest pack resulted in broken geometry)
gltfLoader.load('https://vazxmixjsiawhamofees.supabase.co/storage/v1/object/public/models/tree-beech/model.gltf', (gltf) => {
    const realTreeAsset = gltf.scene;
    
    realTreeAsset.traverse(c => { if ((c as THREE.Mesh).isMesh) { c.castShadow = true; c.receiveShadow = true; }});
    
    treesConfig.forEach(config => {
        treesGroup.remove(config.mesh); // Remove procedural tree
        const newRealTree = realTreeAsset.clone();
        newRealTree.position.copy(config.mesh.position);
        newRealTree.rotation.y = Math.random() * Math.PI * 2;
        // Adjusted tree scale to be realistic but not broken/oversized
        const scale = 2.5 + Math.random() * 2.0; 
        newRealTree.scale.set(scale, scale, scale);
        
        treesGroup.add(newRealTree);
        config.mesh = newRealTree; // Update the reference so logic tracking follows the new mesh
    });
}, undefined, (e) => {
    console.log("Using procedural low-poly fallbacks for trees.");
});

// --- THEME / ENVIRONMENT SYSTEM ---
scene.fog = new THREE.FogExp2(0x8899aa, 0.0015);
const rgbeLoader = new RGBELoader();
let cachedSunsetTexture: THREE.Texture | null = null;
rgbeLoader.load('https://cdn.jsdelivr.net/gh/mrdoob/three.js@master/examples/textures/equirectangular/venice_sunset_1k.hdr', (texture) => {
    texture.mapping = THREE.EquirectangularReflectionMapping;
    cachedSunsetTexture = texture;
    applyTheme(0);
});

const themes = [
    { 
        name: "Sunset Realistic", 
        fogCol: 0x8899aa, fogDensity: 0.0015, bgCol: 0x8899aa,
        useHDR: true, 
        ambCol: 0x404040, dirCol: 0xfffff0, dirInt: 2.0, 
        streetlightsOn: false, roadWireframe: false, grassWireframe: false
    },
    { 
        name: "Bright Daylight", 
        fogCol: 0x87CEEB, fogDensity: 0.001, bgCol: 0x87CEEB,
        useHDR: false, 
        ambCol: 0x999999, dirCol: 0xffffff, dirInt: 3.0, 
        streetlightsOn: false, roadWireframe: false, grassWireframe: false
    },
    { 
        name: "Midnight Drift", 
        fogCol: 0x010105, fogDensity: 0.004, bgCol: 0x000000,
        useHDR: false, 
        ambCol: 0x222233, dirCol: 0x4466aa, dirInt: 0.5, 
        streetlightsOn: true, roadWireframe: false, grassWireframe: false
    }
];

let currentThemeIndex = 0;
let headlightsEnabled = true;

function applyTheme(idx: number) {
    const t = themes[idx];
    scene.fog!.color.setHex(t.fogCol);
    (scene.fog as THREE.FogExp2).density = t.fogDensity;
    
    if(t.useHDR && cachedSunsetTexture) {
        scene.environment = cachedSunsetTexture;
        scene.background = cachedSunsetTexture;
    } else {
        scene.environment = null;
        scene.background = new THREE.Color(t.bgCol);
    }
    
    ambientLight.color.setHex(t.ambCol);
    dirLight.color.setHex(t.dirCol);
    dirLight.intensity = t.dirInt;

    roadMat.wireframe = t.roadWireframe;
    grassMat.wireframe = t.grassWireframe;
    
    if (t.roadWireframe && t.roadWireframeCol) {
        roadMat.color.setHex(t.roadWireframeCol);
        grassMat.color.setHex(t.grassWireframeCol!);
    } else {
        roadMat.color.setHex(0x999999);
        grassMat.color.setHex(0xffffff);
    }
    
    updateHeadlights();

    // Toggle streetlights
    if (streetlightsConfig && streetlightsConfig.length > 0) {
        streetlightsConfig.forEach(sl => {
            if (sl.pointLight) sl.pointLight.intensity = t.streetlightsOn ? 1.5 : 0;
            const bulbMat = (sl.mesh.children[1] as THREE.Mesh).material as THREE.MeshStandardMaterial;
            bulbMat.emissiveIntensity = t.streetlightsOn ? 2.0 : 0.0;
        });
    }

    if (themeIndicator) {
        themeIndicator.innerText = `Theme: ${t.name}`;
    }
}

function updateHeadlights() {
    headlightsGroup.children.forEach((c) => {
        if ((c as THREE.SpotLight).isSpotLight) {
            (c as THREE.SpotLight).intensity = headlightsEnabled ? 350 : 0;
        }
    });
}


// --- CAR / ASSET INITIALIZATION ---
const carRoot = new THREE.Group();
scene.add(carRoot);

const carBodyGroup = new THREE.Group(); 
carRoot.add(carBodyGroup);

// --- HEADLIGHTS ---
const headlightsGroup = new THREE.Group();
const hl1 = new THREE.SpotLight(0xffffee, 0, 150, Math.PI/5, 0.4, 1.2);
hl1.position.set(-0.8, 0.6, -1.8); hl1.target.position.set(-0.8, 0, -25);
const hl2 = new THREE.SpotLight(0xffffee, 0, 150, Math.PI/5, 0.4, 1.2);
hl2.position.set(0.8, 0.6, -1.8); hl2.target.position.set(0.8, 0, -25);
hl1.castShadow = true; hl2.castShadow = true;
headlightsGroup.add(hl1, hl1.target, hl2, hl2.target);
carBodyGroup.add(headlightsGroup); 

const fallbackMesh = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.8, 4.8), new THREE.MeshStandardMaterial({ color: 0xaa0000 }));
fallbackMesh.position.y = 0.4; fallbackMesh.castShadow = true;
carBodyGroup.add(fallbackMesh);

let activeCarMesh: THREE.Object3D | null = null;
let wheels: THREE.Object3D[] = [];

const bodyMaterial = new THREE.MeshPhysicalMaterial({ color: 0xcc0000, metalness: 0.8, roughness: 0.2, clearcoat: 1.0, clearcoatRoughness: 0.03 });
const detailsMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1.0, roughness: 0.5 });
const glassMaterial = new THREE.MeshPhysicalMaterial({ color: 0x010101, metalness: 0.8, roughness: 0.1, transmission: 0.8, transparent: true });

function buildBlockyCar(primaryColor: number, isTruck: boolean = false) {
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshPhysicalMaterial({ color: primaryColor, metalness: 0.6, roughness: 0.3, clearcoat: 0.8 });
    const glassMat = new THREE.MeshPhysicalMaterial({ color: 0x111111, metalness: 0.9, roughness: 0.1 });
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.9 });
    const rimMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.8, roughness: 0.2 });

    // Chassis
    const chassisGeo = isTruck ? new THREE.BoxGeometry(2.2, 0.8, 5.0) : new THREE.BoxGeometry(2.0, 0.6, 4.6);
    const chassis = new THREE.Mesh(chassisGeo, bodyMat);
    chassis.position.y = isTruck ? 0.8 : 0.6;
    chassis.castShadow = true; chassis.receiveShadow = true;
    group.add(chassis);

    // Cabin
    const cabinGeo = isTruck ? new THREE.BoxGeometry(2.0, 1.0, 2.0) : new THREE.BoxGeometry(1.8, 0.6, 2.2);
    const cabin = new THREE.Mesh(cabinGeo, glassMat);
    cabin.position.set(0, isTruck ? 1.7 : 1.2, isTruck ? -0.5 : 0.2);
    cabin.castShadow = true; cabin.receiveShadow = true;
    group.add(cabin);

    // Wheels
    const wRadius = isTruck ? 0.5 : 0.4;
    const wWidth = isTruck ? 0.6 : 0.4;
    const wheelGeo = new THREE.CylinderGeometry(wRadius, wRadius, wWidth, 16);
    wheelGeo.rotateZ(Math.PI / 2);
    const rimGeo = new THREE.CylinderGeometry(wRadius * 0.6, wRadius * 0.6, wWidth + 0.05, 8);
    rimGeo.rotateZ(Math.PI / 2);

    const wPos = [
        new THREE.Vector3(1.1, wRadius, 1.5),
        new THREE.Vector3(-1.1, wRadius, 1.5),
        new THREE.Vector3(1.1, wRadius, -1.6),
        new THREE.Vector3(-1.1, wRadius, -1.6)
    ];

    wPos.forEach((p, i) => {
        const wGroup = new THREE.Group();
        wGroup.position.copy(p);
        const w = new THREE.Mesh(wheelGeo, wheelMat);
        const rim = new THREE.Mesh(rimGeo, rimMat);
        w.castShadow = true;
        wGroup.add(w, rim);
        wGroup.name = `wheel_${i}`;
        group.add(wGroup);
    });

    return group;
}

const carConfigs: any[] = [
    {
        name: "Ferrari",
        url: "https://cdn.jsdelivr.net/gh/mrdoob/three.js@master/examples/models/gltf/ferrari.glb",
        scale: 1, rotY: 0, yOffset: 0,
        setup: (model: THREE.Object3D) => {
            const actualModel = model.children[0];
            const setMat = (name: string, mat: THREE.Material) => {
                const mesh = actualModel.getObjectByName(name) as THREE.Mesh;
                if (mesh) mesh.material = mat;
            };
            setMat('body', bodyMaterial);
            setMat('rim_fl', detailsMaterial); setMat('rim_fr', detailsMaterial);
            setMat('rim_rl', detailsMaterial); setMat('rim_rr', detailsMaterial);
            setMat('trim', detailsMaterial); setMat('glass', glassMaterial);

            ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr'].forEach(wName => {
                const w = actualModel.getObjectByName(wName);
                if (w) wheels.push(w);
            });
            headlightsGroup.position.set(0,0,0);
        }
    }
];

let currentCarConfigIndex = 0;

function switchCarModel() {
    currentCarConfigIndex = (currentCarConfigIndex + 1) % carConfigs.length;
    loadCarByIndex(currentCarConfigIndex);
}

function loadCarByIndex(index: number) {
    if (activeCarMesh) carBodyGroup.remove(activeCarMesh);
    else carBodyGroup.remove(fallbackMesh);
    wheels = []; 

    const config = carConfigs[index];
    if (loadingElement) { loadingElement.textContent = `Loading ${config.name}...`; loadingElement.style.display = 'block'; }

    if (config.buildProcedural) {
        const model = config.buildProcedural();
        config.setup(model);
        carBodyGroup.add(model);
        activeCarMesh = model;
        if (loadingElement) loadingElement.style.display = 'none';
        return;
    }

    gltfLoader.load(config.url!, (gltf) => {
        const model = gltf.scene;
        model.scale.set(config.scale, config.scale, config.scale);
        model.rotation.y = config.rotY;
        model.position.y = config.yOffset;
        model.traverse((child) => {
            if ((child as THREE.Mesh).isMesh) {
                child.castShadow = true; child.receiveShadow = true;
            }
        });
        config.setup(model);
        carBodyGroup.add(model);
        activeCarMesh = model;
        if (loadingElement) loadingElement.style.display = 'none';
    }, undefined, (e) => {
        console.warn(`Failed to load ${config.name}, falling back.`);
        
        // Let the user know the model failed to load or disappear
        if (loadingElement) {
            loadingElement.innerHTML = `⚠️ Failed to load <b>${config.name}</b><br><span style="font-size:12px">File missing or zero bytes. Please ZIP the models before uploading!</span>`;
            setTimeout(() => { loadingElement.style.display = 'none'; }, 5000);
        }
        
        if (!activeCarMesh && !carBodyGroup.children.includes(fallbackMesh)) carBodyGroup.add(fallbackMesh);
    });
}
loadCarByIndex(currentCarConfigIndex);

// --- DYNAMIC CAMERA VARS ---
let cameraZoomLevel = 0;
const targetCameraOffsets = [
    new THREE.Vector3(0, 2.8, 6.0),   // Far chase (Elevated to see road)
    new THREE.Vector3(0, 2.0, 3.8),   // Mid chase
    new THREE.Vector3(0, 1.8, 1.5),   // Close cam (Raised heavily to look over the roof)
];
let activeCameraOffset = targetCameraOffsets[0].clone();

// --- INPUT HANDLING ---
window.addEventListener('keydown', (e) => {
    initAudio(); 
    isEngineRunning = true;
    if (engineStopTimeout) { clearTimeout(engineStopTimeout); engineStopTimeout = null; }
    
    if (e.code === 'KeyE') {
        currentThemeIndex = (currentThemeIndex + 1) % themes.length;
        applyTheme(currentThemeIndex);
    }
    if (e.code === 'KeyB') switchBGM();
    if (e.code === 'KeyC') cameraZoomLevel = (cameraZoomLevel + 1) % targetCameraOffsets.length;
    if (e.code === 'KeyL') {
        headlightsEnabled = !headlightsEnabled;
        updateHeadlights();
    }
    if (Object.keys(keys).includes(e.code)) keys[e.code as keyof typeof keys] = true;
});

window.addEventListener('keyup', (e) => {
    if (Object.keys(keys).includes(e.code)) keys[e.code as keyof typeof keys] = false;
    
    if (!keys.ArrowUp && !keys.ArrowDown && !keys.ArrowLeft && !keys.ArrowRight) {
        if (!engineStopTimeout) {
            engineStopTimeout = window.setTimeout(() => { isEngineRunning = false; }, 2500); 
        }
    }
});

// --- GAME LOOP ---
const clock = new THREE.Clock();
const currentLookAt = new THREE.Vector3();
carRoot.position.z = 0; 

function animate() {
    requestAnimationFrame(animate);
    const delta = Math.min(clock.getDelta(), 0.1); 
    if (!carRoot) return;

    // Kinematics
    if (keys.ArrowUp) carState.speed += carState.acceleration * delta;
    else if (keys.ArrowDown) carState.speed -= carState.acceleration * delta;
    else {
        if (carState.speed > 0) { carState.speed -= carState.friction * delta; if (carState.speed < 0) carState.speed = 0; }
        else if (carState.speed < 0) { carState.speed += carState.friction * delta; if (carState.speed > 0) carState.speed = 0; }
    }
    carState.speed = THREE.MathUtils.clamp(carState.speed, -carState.reverseSpeed, carState.maxSpeed);

    // Update Speedometer UI
    if (speedoValDisplay) {
        const kmh = Math.floor(Math.abs(carState.speed) * 3); 
        speedoValDisplay.innerText = kmh.toString();
    }

    // Steering & Roll
    const isMoving = Math.abs(carState.speed) > 0.1;
    let targetRoll = 0;
    if (isMoving) {
        const steerDir = carState.speed > 0 ? 1 : -1;
        const speedFactor = 1 - (Math.abs(carState.speed) / carState.maxSpeed) * 0.4;
        let turnRate = 0;
        if (keys.ArrowLeft) {
            turnRate = carState.rotationSpeed * steerDir * speedFactor * delta;
            carRoot.rotation.y += turnRate; targetRoll = 0.08 * steerDir; 
        }
        if (keys.ArrowRight) {
            turnRate = carState.rotationSpeed * steerDir * speedFactor * delta;
            carRoot.rotation.y -= turnRate; targetRoll = -0.08 * steerDir;
        }
    }
    carBodyGroup.rotation.z = THREE.MathUtils.lerp(carBodyGroup.rotation.z, targetRoll, 5 * delta);

    const wheelSpin = (carState.speed * delta) / 0.3; 
    wheels.forEach(w => w.rotation.x -= wheelSpin);

    // Movement & Clamp
    carRoot.translateZ(-carState.speed * delta);
    const exactTrackX = getCurveOffset(carRoot.position.z);
    const roadWidthHalf = 7.8; 
    const offroadBoundaryL = exactTrackX - roadWidthHalf + 1; 
    const offroadBoundaryR = exactTrackX + roadWidthHalf - 1;
    if (carRoot.position.x < offroadBoundaryL) { carRoot.position.x = offroadBoundaryL; carState.speed *= 0.98; } 
    else if (carRoot.position.x > offroadBoundaryR) { carRoot.position.x = offroadBoundaryR; carState.speed *= 0.98; }

    // Dynamic Tracking Geometry mapping
    road.position.z = carRoot.position.z;
    edge1.position.z = carRoot.position.z; edge2.position.z = carRoot.position.z;
    grass.position.x = carRoot.position.x; grass.position.z = carRoot.position.z;

    applyCurve(roadGeo, 0, carRoot.position.z);
    applyCurve(edgeGeo1, -8.3, carRoot.position.z);
    applyCurve(edgeGeo2, 8.3, carRoot.position.z);

    roadTex.offset.y = -carRoot.position.z / (roadLength / roadRepeat);
    grassTex.offset.y = -carRoot.position.z / (600 / 60);
    grassTex.offset.x = carRoot.position.x / (600 / 60);

    treesConfig.forEach(config => {
        let relZ = config.baseZ - carRoot.position.z;
        if (relZ > 200) config.baseZ -= 600;
        else if (relZ < -400) config.baseZ += 600;
        config.mesh.position.z = config.baseZ;
        config.mesh.position.x = getCurveOffset(config.baseZ) + config.offsetX;
    });

    streetlightsConfig.forEach(config => {
        let relZ = config.baseZ - carRoot.position.z;
        if (relZ > 200) config.baseZ -= 1800; // 40 * 45 total tracking space
        else if (relZ < -1600) config.baseZ += 1800;
        config.mesh.position.z = config.baseZ;
        config.mesh.position.x = getCurveOffset(config.baseZ) + config.offsetX;
    });

    dirLight.position.set(carRoot.position.x + 50, 100, carRoot.position.z + 50); dirLight.target = carRoot;
    updateAudio();

    // Camera Move
    activeCameraOffset.lerp(targetCameraOffsets[cameraZoomLevel], 5 * delta);
    const idealOffset = new THREE.Vector3(
        carRoot.position.x,
        carRoot.position.y + activeCameraOffset.y,
        carRoot.position.z + activeCameraOffset.z
    );
    
    const lookAheadZ = carRoot.position.z - 20;
    const lookAheadX = getCurveOffset(lookAheadZ);
    const panFactor = cameraZoomLevel === 2 ? 0.05 : 0.2; 
    const dynamicLookX = THREE.MathUtils.lerp(carRoot.position.x, lookAheadX, panFactor);
    
    // Dynamically adjust the tilt of the camera - look further down the road when zoomed in
    const lookAtHeight = cameraZoomLevel === 2 ? 0.2 : 1.2;
    const lookAtDist = cameraZoomLevel === 2 ? 12 : 5;
    const idealLookAt = new THREE.Vector3(dynamicLookX, carRoot.position.y + lookAtHeight, carRoot.position.z - lookAtDist);

    const dampFactor = 1 - Math.exp(-15 * delta); 
    camera.position.lerp(idealOffset, dampFactor);
    currentLookAt.lerp(idealLookAt, dampFactor);
    camera.lookAt(currentLookAt);

    renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

animate();
