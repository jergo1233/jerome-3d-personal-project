/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { 
  Box, Upload, Trash2, Eye, RefreshCw, ZoomIn, ZoomOut, RotateCw, 
  Layers, FolderOpen, AlertCircle, Cpu, Camera, Play, Pause, Download, FolderPlus, FileText, CheckCircle2
} from 'lucide-react';

interface ModelItem {
  id: string;
  name: string;
  filename: string;
  size: number;
  createdAt: string;
  url: string;
  format: string;
}

export default function App() {
  const [models, setModels] = useState<ModelItem[]>([]);
  const [selectedModel, setSelectedModel] = useState<ModelItem | null>(null);
  const [activeTab, setActiveTab] = useState<'viewer' | 'upload' | 'manager'>('viewer');
  
  // Viewer states
  const [isAutoRotate, setIsAutoRotate] = useState(false);
  const [isWireframe, setIsWireframe] = useState(false);
  const [lightPreset, setLightPreset] = useState<'studio' | 'cyberpunk' | 'warm' | 'dark'>('studio');
  const [polyCount, setPolyCount] = useState(0);
  const [vertexCount, setVertexCount] = useState(0);
  const [isLoadingModel, setIsLoadingModel] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Upload states
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadMessage, setUploadMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Three.js Refs
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const modelGroupRef = useRef<THREE.Group | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  // Fetch models from server folder
  const fetchModels = async () => {
    try {
      const res = await fetch('/api/models');
      if (res.ok) {
        const data = await res.json();
        setModels(data);
        if (data.length > 0 && (!selectedModel || !data.some((m: ModelItem) => m.id === selectedModel.id))) {
          setSelectedModel(data[0]);
        } else if (data.length === 0) {
          setSelectedModel(null);
        }
      }
    } catch (err) {
      console.error('Failed to fetch models:', err);
    }
  };

  useEffect(() => {
    fetchModels();
  }, []);

  // Initialize Three.js Scene
  useEffect(() => {
    if (!containerRef.current) return;

    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;

    // Scene
    const scene = new THREE.Scene();
    sceneRef.current = scene;
    scene.background = new THREE.Color(0x0f172a); // Slate 900
    scene.fog = new THREE.FogExp2(0x0f172a, 0.015);

    // Camera
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    camera.position.set(0, 3, 7);
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    
    containerRef.current.innerHTML = '';
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Orbit Controls (Zoom in, Zoom out, 360 Rotation)
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.minDistance = 1;
    controls.maxDistance = 50;
    controlsRef.current = controls;

    // Lighting setup
    updateLighting(scene, lightPreset);

    // Grid helper & floor
    const gridHelper = new THREE.GridHelper(20, 20, 0x38bdf8, 0x334155);
    gridHelper.position.y = -1.5;
    scene.add(gridHelper);

    const floorGeometry = new THREE.PlaneGeometry(50, 50);
    const floorMaterial = new THREE.MeshStandardMaterial({ 
      color: 0x090d16, 
      roughness: 0.9, 
      metalness: 0.1 
    });
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -1.51;
    floor.receiveShadow = true;
    scene.add(floor);

    // Model Group
    const modelGroup = new THREE.Group();
    scene.add(modelGroup);
    modelGroupRef.current = modelGroup;

    if (selectedModel) {
      loadSelectedModelData(selectedModel);
    }

    // Animation loop
    const animate = () => {
      animationFrameRef.current = requestAnimationFrame(animate);

      if (controlsRef.current) {
        controlsRef.current.update();
      }

      if (isAutoRotate && modelGroupRef.current) {
        modelGroupRef.current.rotation.y += 0.005;
      }

      if (rendererRef.current && sceneRef.current && cameraRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }
    };
    animate();

    // Resize handler
    const handleResize = () => {
      if (!containerRef.current || !rendererRef.current || !cameraRef.current) return;
      const w = containerRef.current.clientWidth;
      const h = containerRef.current.clientHeight;
      cameraRef.current.aspect = w / h;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (rendererRef.current && rendererRef.current.domElement) {
        rendererRef.current.dispose();
      }
    };
  }, []);

  // Update lighting when preset changes
  const updateLighting = (scene: THREE.Scene, preset: string) => {
    const lightsToRem: THREE.Object3D[] = [];
    scene.traverse((child) => {
      if (child instanceof THREE.Light) {
        lightsToRem.push(child);
      }
    });
    lightsToRem.forEach(l => scene.remove(l));

    const ambientLight = new THREE.AmbientLight(0xffffff, preset === 'cyberpunk' ? 0.4 : 0.8);
    scene.add(ambientLight);

    if (preset === 'studio') {
      const keyLight = new THREE.DirectionalLight(0xffffff, 2.0);
      keyLight.position.set(5, 8, 5);
      keyLight.castShadow = true;
      scene.add(keyLight);

      const fillLight = new THREE.DirectionalLight(0x93c5fd, 1.0);
      fillLight.position.set(-5, 4, -3);
      scene.add(fillLight);

      const rimLight = new THREE.DirectionalLight(0xf472b6, 1.5);
      rimLight.position.set(0, -3, -5);
      scene.add(rimLight);
      scene.background = new THREE.Color(0x0f172a);
      scene.fog = new THREE.FogExp2(0x0f172a, 0.015);
    } else if (preset === 'cyberpunk') {
      const cyanLight = new THREE.PointLight(0x06b6d4, 5, 20);
      cyanLight.position.set(4, 3, 4);
      scene.add(cyanLight);

      const magentaLight = new THREE.PointLight(0xec4899, 5, 20);
      magentaLight.position.set(-4, 3, -4);
      scene.add(magentaLight);

      const topLight = new THREE.DirectionalLight(0x8b5cf6, 2.0);
      topLight.position.set(0, 10, 0);
      scene.add(topLight);

      scene.background = new THREE.Color(0x030712);
      scene.fog = new THREE.FogExp2(0x030712, 0.02);
    } else if (preset === 'warm') {
      const sunLight = new THREE.DirectionalLight(0xfde047, 2.5);
      sunLight.position.set(6, 6, 6);
      scene.add(sunLight);

      const ambientWarm = new THREE.AmbientLight(0xfef08a, 0.9);
      scene.add(ambientWarm);

      scene.background = new THREE.Color(0x1c1917);
      scene.fog = new THREE.FogExp2(0x1c1917, 0.015);
    } else {
      const spot = new THREE.DirectionalLight(0xe2e8f0, 1.8);
      spot.position.set(0, 8, 4);
      scene.add(spot);

      scene.background = new THREE.Color(0x020617);
      scene.fog = new THREE.FogExp2(0x020617, 0.025);
    }
  };

  useEffect(() => {
    if (sceneRef.current) {
      updateLighting(sceneRef.current, lightPreset);
    }
  }, [lightPreset]);

  // Load Model Data whenever selectedModel changes
  useEffect(() => {
    if (selectedModel && modelGroupRef.current) {
      loadSelectedModelData(selectedModel);
    }
  }, [selectedModel]);

  const loadSelectedModelData = (model: ModelItem) => {
    if (!modelGroupRef.current) return;
    setIsLoadingModel(true);
    setLoadError(null);

    // Clear existing model group children
    while (modelGroupRef.current.children.length > 0) {
      const child = modelGroupRef.current.children[0];
      modelGroupRef.current.remove(child);
    }

    const ext = model.format.toLowerCase();
    const fileUrl = model.url;

    if (ext === 'fbx') {
      const loader = new FBXLoader();
      loader.load(
        fileUrl,
        (object) => {
          setupLoadedObject(object);
          setIsLoadingModel(false);
        },
        undefined,
        (error) => {
          console.error('FBX Load Error:', error);
          setLoadError(`Failed to parse FBX file (${model.filename}). Please ensure the FBX is binary format export from Blender.`);
          setIsLoadingModel(false);
        }
      );
    } else if (ext === 'obj') {
      const loader = new OBJLoader();
      loader.load(
        fileUrl,
        (object) => {
          setupLoadedObject(object);
          setIsLoadingModel(false);
        },
        undefined,
        (error) => {
          console.error('OBJ Load Error:', error);
          setLoadError(`Failed to parse OBJ file (${model.filename}).`);
          setIsLoadingModel(false);
        }
      );
    } else if (ext === 'gltf' || ext === 'glb') {
      const loader = new GLTFLoader();
      loader.load(
        fileUrl,
        (gltf) => {
          setupLoadedObject(gltf.scene);
          setIsLoadingModel(false);
        },
        undefined,
        (error) => {
          console.error('GLTF Load Error:', error);
          setLoadError(`Failed to parse GLTF/GLB file (${model.filename}).`);
          setIsLoadingModel(false);
        }
      );
    } else {
      setIsLoadingModel(false);
      setLoadError('Unsupported 3D file format.');
    }
  };

  const setupLoadedObject = (object: THREE.Object3D) => {
    if (!modelGroupRef.current) return;

    // Center and scale object
    const box = new THREE.Box3().setFromObject(object);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());

    const maxDim = Math.max(size.x, size.y, size.z);
    const scale = maxDim > 0 ? 3.5 / maxDim : 1;
    object.scale.setScalar(scale);

    object.position.sub(center.multiplyScalar(scale));
    object.position.y += (size.y * scale) / 2 - 1.5;

    let vertices = 0;
    let faces = 0;

    object.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        
        if (child.geometry) {
          vertices += child.geometry.attributes.position.count;
          if (child.geometry.index) {
            faces += child.geometry.index.count / 3;
          } else {
            faces += child.geometry.attributes.position.count / 3;
          }
        }

        if (child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach(m => {
              if (m instanceof THREE.MeshStandardMaterial || m instanceof THREE.MeshPhysicalMaterial) {
                m.wireframe = isWireframe;
              }
            });
          } else {
            const m = child.material as any;
            if (m.wireframe !== undefined) {
              m.wireframe = isWireframe;
            }
          }
        }
      }
    });

    setVertexCount(vertices);
    setPolyCount(Math.round(faces));

    modelGroupRef.current.add(object);
  };

  // Handle wireframe toggle change
  useEffect(() => {
    if (modelGroupRef.current) {
      modelGroupRef.current.traverse((child) => {
        if (child instanceof THREE.Mesh && child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach(m => (m.wireframe = isWireframe));
          } else {
            (child.material as any).wireframe = isWireframe;
          }
        }
      });
    }
  }, [isWireframe]);

  const handleZoomIn = () => {
    if (cameraRef.current && controlsRef.current) {
      cameraRef.current.position.multiplyScalar(0.85);
      controlsRef.current.update();
    }
  };

  const handleZoomOut = () => {
    if (cameraRef.current && controlsRef.current) {
      cameraRef.current.position.multiplyScalar(1.15);
      controlsRef.current.update();
    }
  };

  const handleResetCamera = () => {
    if (cameraRef.current && controlsRef.current) {
      cameraRef.current.position.set(0, 3, 7);
      controlsRef.current.target.set(0, 0, 0);
      controlsRef.current.update();
    }
  };

  const handleTakeSnapshot = () => {
    if (!rendererRef.current) return;
    const dataURL = rendererRef.current.domElement.toDataURL('image/png');
    const link = document.createElement('a');
    link.download = `${selectedModel?.name || 'jerome-3d-model'}-snapshot.png`;
    link.href = dataURL;
    link.click();
  };

  // File Upload Handler
  const handleFileUpload = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const fileInput = form.elements.namedItem('modelFile') as HTMLInputElement;
    if (!fileInput.files || fileInput.files.length === 0) {
      setUploadMessage({ type: 'error', text: 'Please select a 3D model file (.fbx, .obj, .gltf, .glb)' });
      return;
    }

    const file = fileInput.files[0];
    const formData = new FormData();
    formData.append('modelFile', file);

    setUploading(true);
    setUploadProgress(30);
    setUploadMessage(null);

    try {
      setUploadProgress(60);
      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      setUploadProgress(90);
      const data = await res.json();

      if (res.ok && data.success) {
        setUploadProgress(100);
        setUploadMessage({ type: 'success', text: `Model "${data.model.name}" uploaded successfully to /uploads folder!` });
        form.reset();
        await fetchModels();
        setSelectedModel(data.model);
        setActiveTab('viewer');
      } else {
        throw new Error(data.error || 'Upload failed');
      }
    } catch (err: any) {
      console.error('Upload error:', err);
      setUploadMessage({ type: 'error', text: err.message || 'Failed to upload file to server.' });
    } finally {
      setUploading(false);
      setTimeout(() => setUploadProgress(0), 1500);
    }
  };

  const handleDeleteModel = async (filename: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`Are you sure you want to delete ${filename} from the server /uploads folder?`)) return;

    try {
      const res = await fetch(`/api/models/${filename}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        await fetchModels();
        if (selectedModel?.filename === filename) {
          const remaining = models.filter(m => m.filename !== filename);
          setSelectedModel(remaining.length > 0 ? remaining[0] : null);
        }
      } else {
        alert('Failed to delete model');
      }
    } catch (err) {
      console.error('Delete error:', err);
      alert('Error deleting model');
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-sky-500 selection:text-white">
      {/* Top Header */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur-md sticky top-0 z-50 px-6 py-4 flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-sky-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-sky-500/20">
            <Box className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
              3D Model Viewer
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-400 border border-sky-500/20">
                Blender FBX / OBJ / GLTF
              </span>
            </h1>
            <p className="text-xs text-slate-400">
              Jerome Urbano 3D Personal Projects · Interactive Three.js WebGL Studio
            </p>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center bg-slate-950/80 p-1.5 rounded-xl border border-slate-800">
          <button
            onClick={() => setActiveTab('viewer')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium transition-all ${
              activeTab === 'viewer'
                ? 'bg-sky-600 text-white shadow-lg shadow-sky-600/30'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Eye className="w-4 h-4" />
            3D Viewport
          </button>
          <button
            onClick={() => setActiveTab('upload')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium transition-all ${
              activeTab === 'upload'
                ? 'bg-sky-600 text-white shadow-lg shadow-sky-600/30'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Upload className="w-4 h-4" />
            Upload 3D Model
          </button>
          <button
            onClick={() => setActiveTab('manager')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium transition-all ${
              activeTab === 'manager'
                ? 'bg-sky-600 text-white shadow-lg shadow-sky-600/30'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <FolderOpen className="w-4 h-4" />
            Server Files ({models.length})
          </button>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 p-4 md:p-6 max-w-7xl mx-auto w-full grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Left Sidebar: Manual Folder Models Selector & Telemetry */}
        <aside className="lg:col-span-1 flex flex-col gap-6">
          <div className="bg-slate-900/70 border border-slate-800/80 rounded-2xl p-5 shadow-xl backdrop-blur-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                <Layers className="w-4 h-4 text-sky-400" />
                Models in `/uploads` ({models.length})
              </h3>
              <button 
                onClick={fetchModels}
                className="text-slate-400 hover:text-white transition-colors"
                title="Refresh folder scan"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>

            <p className="text-[11px] text-slate-400 mb-4 bg-slate-950/50 p-2.5 rounded-xl border border-slate-800/80">
              💡 You can place your Blender files directly in the <code className="text-sky-400 font-mono">/uploads</code> folder or use the Upload tab above!
            </p>

            <div className="space-y-2.5 max-h-[320px] overflow-y-auto pr-1">
              {models.length === 0 ? (
                <div className="text-xs text-slate-500 italic p-4 text-center bg-slate-950/30 rounded-xl border border-slate-900">
                  No 3D models in the `/uploads` folder yet. Use the Upload tab to add files.
                </div>
              ) : (
                models.map((model) => (
                  <div
                    key={model.id}
                    onClick={() => {
                      setSelectedModel(model);
                      setActiveTab('viewer');
                    }}
                    className={`p-3 rounded-xl border transition-all cursor-pointer flex items-center justify-between group ${
                      selectedModel?.id === model.id
                        ? 'bg-sky-500/10 border-sky-500/50 text-white shadow-sm'
                        : 'bg-slate-950/40 border-slate-800/60 text-slate-300 hover:bg-slate-800/50 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center gap-3 overflow-hidden">
                      <div className="w-8 h-8 rounded-lg bg-indigo-500/20 text-indigo-400 flex items-center justify-center shrink-0 font-bold text-xs">
                        {model.format}
                      </div>
                      <div className="truncate">
                        <div className="text-xs font-medium truncate">{model.name}</div>
                        <div className="text-[10px] text-slate-400">
                          {(model.size / (1024 * 1024)).toFixed(2)} MB
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={(e) => handleDeleteModel(model.filename, e)}
                        className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                        title="Delete from folder"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Model Technical Stats Card */}
          <div className="bg-slate-900/70 border border-slate-800/80 rounded-2xl p-5 shadow-xl backdrop-blur-sm">
            <h3 className="text-sm font-semibold text-slate-200 mb-3 flex items-center gap-2">
              <Cpu className="w-4 h-4 text-sky-400" />
              Model Telemetry & Stats
            </h3>
            <div className="space-y-3 text-xs">
              <div className="flex justify-between items-center py-1.5 border-b border-slate-800">
                <span className="text-slate-400">Active Model</span>
                <span className="font-medium text-white truncate max-w-[140px]">{selectedModel?.name || 'None'}</span>
              </div>
              <div className="flex justify-between items-center py-1.5 border-b border-slate-800">
                <span className="text-slate-400">File Format</span>
                <span className="font-mono text-sky-400 font-semibold">{selectedModel?.format || '-'}</span>
              </div>
              <div className="flex justify-between items-center py-1.5 border-b border-slate-800">
                <span className="text-slate-400">Polygon Count</span>
                <span className="font-mono text-white">{polyCount.toLocaleString()}</span>
              </div>
              <div className="flex justify-between items-center py-1.5 border-b border-slate-800">
                <span className="text-slate-400">Vertex Count</span>
                <span className="font-mono text-white">{vertexCount.toLocaleString()}</span>
              </div>
              <div className="flex justify-between items-center py-1.5">
                <span className="text-slate-400">Renderer Engine</span>
                <span className="text-emerald-400 font-medium">Three.js WebGL2</span>
              </div>
            </div>
          </div>
        </aside>

        {/* Center / Right Content Area */}
        <section className="lg:col-span-3 flex flex-col gap-6">
          {activeTab === 'viewer' && (
            <div className="flex flex-col gap-4">
              {/* 3D Viewport Box */}
              <div className="relative w-full h-[580px] bg-slate-900 rounded-2xl border border-slate-800 overflow-hidden shadow-2xl">
                <div ref={containerRef} className="w-full h-full cursor-grab active:cursor-grabbing" />

                {/* Loading / Error Overlay */}
                {isLoadingModel && (
                  <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm flex flex-col items-center justify-center gap-3 z-20">
                    <div className="w-8 h-8 border-3 border-sky-500 border-t-transparent rounded-full animate-spin" />
                    <p className="text-xs font-medium text-slate-300">Loading 3D Model from server folder...</p>
                  </div>
                )}

                {!selectedModel && !isLoadingModel && (
                  <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-md flex flex-col items-center justify-center gap-3 z-20 p-6 text-center">
                    <FolderPlus className="w-12 h-12 text-sky-400 mb-1 animate-bounce" />
                    <h3 className="text-base font-bold text-white">No 3D Model Selected</h3>
                    <p className="text-xs text-slate-400 max-w-md">
                      Upload an FBX/OBJ file using the Upload tab, or place it in the <code className="text-sky-400 font-mono">/uploads</code> server folder.
                    </p>
                  </div>
                )}

                {loadError && (
                  <div className="absolute top-4 left-4 right-4 bg-amber-500/10 border border-amber-500/30 text-amber-300 p-3 rounded-xl text-xs flex items-center gap-2 z-20 backdrop-blur-md">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{loadError}</span>
                  </div>
                )}

                {/* Floating HUD Top Controls */}
                <div className="absolute top-4 left-4 flex items-center gap-2 z-10">
                  <div className="bg-slate-900/80 backdrop-blur-md border border-slate-800 px-3 py-1.5 rounded-xl flex items-center gap-2 text-xs font-medium text-slate-300">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    {selectedModel?.name || 'No Model Selected'}
                  </div>
                </div>

                {selectedModel && (
                  <div className="absolute top-4 right-4 flex items-center gap-2 z-10">
                    <button
                      onClick={handleTakeSnapshot}
                      className="p-2.5 bg-slate-900/80 hover:bg-slate-800 backdrop-blur-md border border-slate-800 rounded-xl text-slate-300 hover:text-white transition-all shadow-lg"
                      title="Take Snapshot"
                    >
                      <Camera className="w-4 h-4" />
                    </button>
                  </div>
                )}

                {/* Floating HUD Bottom Controls */}
                <div className="absolute bottom-4 left-4 right-4 flex flex-wrap items-center justify-between gap-3 bg-slate-900/80 backdrop-blur-md border border-slate-800 p-3 rounded-xl z-10 shadow-xl">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleZoomIn}
                      className="p-2 bg-slate-800/80 hover:bg-slate-700 text-slate-200 rounded-lg transition-colors flex items-center gap-1.5 text-xs font-medium"
                      title="Zoom In"
                    >
                      <ZoomIn className="w-4 h-4" />
                      <span className="hidden sm:inline">Zoom In</span>
                    </button>
                    <button
                      onClick={handleZoomOut}
                      className="p-2 bg-slate-800/80 hover:bg-slate-700 text-slate-200 rounded-lg transition-colors flex items-center gap-1.5 text-xs font-medium"
                      title="Zoom Out"
                    >
                      <ZoomOut className="w-4 h-4" />
                      <span className="hidden sm:inline">Zoom Out</span>
                    </button>
                    <button
                      onClick={handleResetCamera}
                      className="p-2 bg-slate-800/80 hover:bg-slate-700 text-slate-200 rounded-lg transition-colors flex items-center gap-1.5 text-xs font-medium"
                      title="Reset View"
                    >
                      <RotateCw className="w-4 h-4" />
                      <span className="hidden sm:inline">Reset</span>
                    </button>
                    <button
                      onClick={() => setIsAutoRotate(!isAutoRotate)}
                      className={`p-2 rounded-lg transition-colors flex items-center gap-1.5 text-xs font-medium ${
                        isAutoRotate ? 'bg-sky-600 text-white' : 'bg-slate-800/80 hover:bg-slate-700 text-slate-200'
                      }`}
                      title="Toggle 360 Auto-Rotation"
                    >
                      {isAutoRotate ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                      <span className="hidden sm:inline">360° Rotate</span>
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setIsWireframe(!isWireframe)}
                      className={`px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                        isWireframe ? 'bg-amber-600 text-white' : 'bg-slate-800/80 hover:bg-slate-700 text-slate-300'
                      }`}
                    >
                      Wireframe
                    </button>

                    <select
                      value={lightPreset}
                      onChange={(e) => setLightPreset(e.target.value as any)}
                      className="bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded-lg px-3 py-2 outline-none focus:border-sky-500"
                    >
                      <option value="studio">Studio 3-Point</option>
                      <option value="cyberpunk">Cyberpunk Neon</option>
                      <option value="warm">Warm Sunlight</option>
                      <option value="dark">Minimal Dark</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Instructions / Features Card */}
              <div className="bg-slate-900/70 border border-slate-800/80 rounded-2xl p-5 shadow-xl backdrop-blur-sm grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-sky-500/10 text-sky-400 flex items-center justify-center shrink-0">
                    <RotateCw className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-xs font-semibold text-white mb-1">360° Orbit Rotation</h4>
                    <p className="text-[11px] text-slate-400">Click and drag anywhere on the canvas to rotate your Blender model in 360 degrees.</p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-indigo-500/10 text-indigo-400 flex items-center justify-center shrink-0">
                    <ZoomIn className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-xs font-semibold text-white mb-1">Smooth Zoom In / Out</h4>
                    <p className="text-[11px] text-slate-400">Use your mouse scroll wheel or buttons to inspect intricate details of your model.</p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center shrink-0">
                    <FolderOpen className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-xs font-semibold text-white mb-1">Server Folder Storage</h4>
                    <p className="text-[11px] text-slate-400">Files are stored securely in the server's `/uploads` folder without requiring a database.</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'upload' && (
            <div className="bg-slate-900/70 border border-slate-800/80 rounded-2xl p-8 shadow-xl backdrop-blur-sm flex flex-col items-center justify-center text-center">
              <div className="w-16 h-16 rounded-2xl bg-sky-500/10 text-sky-400 flex items-center justify-center mb-4 border border-sky-500/20">
                <Upload className="w-8 h-8" />
              </div>
              <h3 className="text-lg font-bold text-white mb-1">Upload 3D Model to `/uploads`</h3>
              <p className="text-xs text-slate-400 max-w-md mb-6">
                Upload `.fbx`, `.obj`, `.gltf`, or `.glb` files from Blender. Files are saved directly into the server's <code className="text-sky-400 font-mono">/uploads</code> folder.
              </p>

              <form onSubmit={handleFileUpload} className="w-full max-w-md flex flex-col gap-4">
                <div className="border-2 border-dashed border-slate-700 hover:border-sky-500 rounded-2xl p-8 bg-slate-950/40 transition-colors flex flex-col items-center justify-center cursor-pointer relative">
                  <input
                    type="file"
                    name="modelFile"
                    accept=".fbx,.obj,.gltf,.glb"
                    className="absolute inset-0 opacity-0 cursor-pointer"
                    required
                  />
                  <FileText className="w-10 h-10 text-slate-500 mb-2" />
                  <span className="text-xs font-medium text-slate-200">Click to browse or drag and drop your 3D file</span>
                  <span className="text-[10px] text-slate-500 mt-1">Supports FBX, OBJ, GLTF, GLB (Max 100MB)</span>
                </div>

                {uploading && (
                  <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
                    <div className="bg-sky-500 h-full transition-all duration-300" style={{ width: `${uploadProgress}%` }} />
                  </div>
                )}

                {uploadMessage && (
                  <div className={`p-3 rounded-xl text-xs flex items-center gap-2 ${
                    uploadMessage.type === 'success' ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30' : 'bg-rose-500/10 text-rose-300 border border-rose-500/30'
                  }`}>
                    {uploadMessage.type === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
                    <span>{uploadMessage.text}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={uploading}
                  className="w-full py-3 bg-sky-600 hover:bg-sky-500 text-white font-semibold rounded-xl text-xs transition-colors shadow-lg shadow-sky-600/30 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  <Upload className="w-4 h-4" />
                  {uploading ? 'Uploading to /uploads...' : 'Upload & View Model'}
                </button>
              </form>
            </div>
          )}

          {activeTab === 'manager' && (
            <div className="bg-slate-900/70 border border-slate-800/80 rounded-2xl p-6 shadow-xl backdrop-blur-sm">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h3 className="text-sm font-semibold text-white">Server Storage Directory (`/uploads`)</h3>
                  <p className="text-xs text-slate-400">All files stored in the server uploads folder.</p>
                </div>
                <button
                  onClick={fetchModels}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Scan Folder
                </button>
              </div>

              <div className="space-y-3">
                {models.length === 0 ? (
                  <div className="py-12 text-center bg-slate-950/40 rounded-xl border border-slate-800/80">
                    <FolderOpen className="w-10 h-10 text-slate-600 mx-auto mb-3" />
                    <p className="text-xs font-medium text-slate-300 mb-1">No 3D models found in server folder</p>
                    <p className="text-[11px] text-slate-500">Use the Upload tab above to add your 3D models.</p>
                  </div>
                ) : (
                  models.map((model) => (
                    <div
                      key={model.id}
                      className="p-4 rounded-xl bg-slate-950/50 border border-slate-800 flex items-center justify-between gap-4"
                    >
                      <div className="flex items-center gap-3 overflow-hidden">
                        <div className="w-10 h-10 rounded-xl bg-sky-500/10 text-sky-400 flex items-center justify-center font-bold text-xs shrink-0 border border-sky-500/20">
                          {model.format}
                        </div>
                        <div className="truncate">
                          <h4 className="text-xs font-semibold text-white truncate">{model.name}</h4>
                          <p className="text-[10px] text-slate-400">
                            Filename: <span className="text-slate-300 font-mono">{model.filename}</span> · {(model.size / (1024 * 1024)).toFixed(2)} MB
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => {
                            setSelectedModel(model);
                            setActiveTab('viewer');
                          }}
                          className="px-3 py-1.5 bg-sky-600/20 hover:bg-sky-600/30 text-sky-300 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          View
                        </button>
                        <a
                          href={model.url}
                          download
                          className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors"
                          title="Download file"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </a>
                        <button
                          onClick={(e) => handleDeleteModel(model.filename, e)}
                          className="p-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 rounded-lg transition-colors"
                          title="Delete from server"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
