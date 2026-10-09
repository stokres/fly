// Loads the Blender-built glTF assets (public/models). Each file is a bag of named meshes
// ("broadleaf_a_lod0", ...); callers take geometries by name and draw them with their own
// stylized materials (the files carry no materials, only vertex colors and custom normals).
import type { BufferGeometry, Mesh } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export type GeometrySet = Map<string, BufferGeometry>;

const loader = new GLTFLoader();
const cache = new Map<string, Promise<GeometrySet>>();

/** All mesh geometries in models/<file>, keyed by object name. */
export function loadGeometries(file: string): Promise<GeometrySet> {
  let p = cache.get(file);
  if (!p) {
    p = loader.loadAsync(`${import.meta.env.BASE_URL}models/${file}`).then((gltf) => {
      const out: GeometrySet = new Map();
      gltf.scene.traverse((o) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh) return;
        const geo = mesh.geometry;
        // Bake the node transform in, so geometries are in the asset's own space.
        mesh.updateWorldMatrix(true, false);
        geo.applyMatrix4(mesh.matrixWorld);
        out.set(mesh.name, geo);
      });
      return out;
    });
    cache.set(file, p);
  }
  return p;
}
