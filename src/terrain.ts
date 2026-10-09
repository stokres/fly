// Terrain meshes: land chunks streamed around the player with distance-based LOD.
// Smooth geometry with normals from the heightfield; the painted look (grass, cliffs, beaches,
// snow) is computed per pixel in the shader (terrainShading.ts), lit by the stylized Lambert
// (shading.ts) with baked mountain shadows and occlusion (terrainMaps.ts). Skirts hide LOD cracks.
import { BufferAttribute, BufferGeometry, Group, Mesh, MeshLambertMaterial, type Vector3 } from 'three';
import { CELL, CHUNK_SIZE, FINE_SEGMENTS, Heightfield } from './heightfield';
import { WORLD_HALF_SIZE } from './map';
import type { TerrainMaps } from './terrainMaps';
import { TERRAIN_GLSL, terrainUniforms } from './terrainShading';
import { tuning } from './tuning';

/** Grid step (in fine cells) per LOD level: 64, 32, 16, 8 segments per chunk. */
const LOD_STEPS = [1, 2, 4, 8];
const HYSTERESIS = 60; // meters, so chunks don't flicker between LODs at a boundary
const SKIRT_DEPTH = 10;

interface Chunk {
  cx: number;
  cz: number;
  mesh: Mesh | null;
  lod: number; // -1 = not built
}

/** Terrain material: Lambert with the painted albedo and baked light maps patched in. */
function terrainMaterial(maps: TerrainMaps): MeshLambertMaterial {
  const material = new MeshLambertMaterial();
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, terrainUniforms, maps.uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTerrainPos;\nvarying vec3 vTerrainNormal;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vTerrainPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
        vTerrainNormal = normalize( mat3( modelMatrix ) * objectNormal );`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vTerrainPos;
        varying vec3 vTerrainNormal;
        uniform sampler2D terrainLightMap;
        uniform float terrainMapExtent;
        uniform float terrainMapsReady;
        ${TERRAIN_GLSL}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec2 terrainUv = vTerrainPos.xz / ( 2.0 * terrainMapExtent ) + 0.5;
        vec2 terrainLight = mix( vec2( 1.0 ), texture2D( terrainLightMap, terrainUv ).rg, terrainMapsReady );
        diffuseColor.rgb = terrainAlbedo( vTerrainPos, normalize( vTerrainNormal ) );
        // Valleys and gullies hold a little darker color too, not just less light.
        diffuseColor.rgb *= mix( 0.8, 1.0, terrainLight.r );`,
      )
      .replace(
        '#include <lights_fragment_begin>',
        `stylizedDirect = terrainLight.g;
        #include <lights_fragment_begin>`,
      )
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
        reflectedLight.indirectDiffuse *= mix( 0.45, 1.0, terrainLight.r );`,
      );
  };
  material.customProgramCacheKey = () => 'terrain';
  return material;
}

export class Terrain {
  readonly group = new Group();
  private heightfield: Heightfield;
  private readonly material: MeshLambertMaterial;
  private chunks: Chunk[] = [];

  constructor(heightfield: Heightfield, maps: TerrainMaps) {
    this.heightfield = heightfield;
    this.material = terrainMaterial(maps);
    this.setHeightfield(heightfield);
  }

  /** Swap in a new heightfield (after seed/detail changes): drops all meshes. */
  setHeightfield(heightfield: Heightfield): void {
    this.heightfield = heightfield;
    for (const chunk of this.chunks) chunk.mesh?.geometry.dispose();
    this.group.clear();
    this.chunks = [];
    const n = Math.ceil(WORLD_HALF_SIZE / CHUNK_SIZE);
    for (let cz = -n; cz < n; cz++) {
      for (let cx = -n; cx < n; cx++) {
        if (heightfield.chunkHasLand(cx, cz)) this.chunks.push({ cx, cz, mesh: null, lod: -1 });
      }
    }
  }

  /** Streams chunks around the player. `budgetMs` caps mesh building time this frame. */
  update(player: Vector3, budgetMs: number): void {
    const t = tuning.terrain;
    const wanted: { chunk: Chunk; lod: number; dist: number }[] = [];
    for (const chunk of this.chunks) {
      const dist = this.distanceTo(chunk, player);
      const lod = this.lodFor(dist, chunk.lod, t.lodDistance, t.drawDistance);
      if (lod !== chunk.lod) wanted.push({ chunk, lod, dist });
    }
    wanted.sort((a, b) => a.dist - b.dist);

    const start = performance.now();
    for (const { chunk, lod } of wanted) {
      if (lod === -1) {
        this.drop(chunk);
        continue;
      }
      if (performance.now() - start > budgetMs) continue; // only drops after the budget is spent
      const geometry = this.buildGeometry(chunk.cx, chunk.cz, LOD_STEPS[lod]);
      chunk.lod = lod;
      if (!geometry) continue; // all under water: the opaque sea covers it
      if (chunk.mesh) {
        chunk.mesh.geometry.dispose();
        chunk.mesh.geometry = geometry;
      } else {
        chunk.mesh = new Mesh(geometry, this.material);
        chunk.mesh.position.set(chunk.cx * CHUNK_SIZE, 0, chunk.cz * CHUNK_SIZE);
        chunk.mesh.receiveShadow = true;
        this.group.add(chunk.mesh);
      }
    }
  }

  private drop(chunk: Chunk): void {
    if (chunk.mesh) {
      chunk.mesh.geometry.dispose();
      this.group.remove(chunk.mesh);
      chunk.mesh = null;
    }
    chunk.lod = -1;
  }

  private distanceTo(chunk: Chunk, p: Vector3): number {
    const x0 = chunk.cx * CHUNK_SIZE;
    const z0 = chunk.cz * CHUNK_SIZE;
    const dx = Math.max(x0 - p.x, 0, p.x - (x0 + CHUNK_SIZE));
    const dz = Math.max(z0 - p.z, 0, p.z - (z0 + CHUNK_SIZE));
    return Math.hypot(dx, dz);
  }

  private lodFor(dist: number, current: number, lodDistance: number, drawDistance: number): number {
    const hidden = LOD_STEPS.length; // "not drawn" sorts as coarser than every level
    const at = (d: number) => {
      if (d > drawDistance) return hidden;
      const level = Math.floor(Math.log2(Math.max(d, 1) / lodDistance) + 1);
      return Math.min(LOD_STEPS.length - 1, Math.max(0, level));
    };
    const target = at(dist);
    const now = current === -1 ? hidden : current;
    // Switch only once the boundary is HYSTERESIS meters behind us, so chunks don't flicker.
    const confirmed = at(dist + (target > now ? -HYSTERESIS : HYSTERESIS)) === target;
    const next = target === now || current === -1 || confirmed ? target : now;
    return next === hidden ? -1 : next;
  }

  private buildGeometry(cx: number, cz: number, step: number): BufferGeometry | null {
    const hf = this.heightfield;
    const heights = hf.chunkHeights(cx, cz);
    let max = -Infinity;
    for (const h of heights) max = Math.max(max, h);
    if (max < -1.5) return null;

    const n = FINE_SEGMENTS + 1;
    const segs = FINE_SEGMENTS / step;
    const verts = segs + 1;
    const cell = CHUNK_SIZE / segs;
    const gx0 = cx * FINE_SEGMENTS;
    const gz0 = cz * FINE_SEGMENTS;
    const skirtVerts = segs * 4;
    const pos = new Float32Array((verts * verts + skirtVerts) * 3);
    const nor = new Float32Array((verts * verts + skirtVerts) * 3);

    // Grid vertices; normals from central differences on the fine grid (shared across chunk
    // edges, so neighbors shade seamlessly), over the LOD step so coarse chunks stay smooth.
    const span = 2 * step * CELL;
    for (let j = 0; j < verts; j++) {
      for (let i = 0; i < verts; i++) {
        const v = (j * verts + i) * 3;
        const gx = gx0 + i * step;
        const gz = gz0 + j * step;
        pos[v] = i * cell;
        pos[v + 1] = heights[j * step * n + i * step];
        pos[v + 2] = j * cell;
        const nx = -(hf.fineHeight(gx + step, gz) - hf.fineHeight(gx - step, gz)) / span;
        const nz = -(hf.fineHeight(gx, gz + step) - hf.fineHeight(gx, gz - step)) / span;
        const len = Math.hypot(nx, 1, nz);
        nor[v] = nx / len;
        nor[v + 1] = 1 / len;
        nor[v + 2] = nz / len;
      }
    }

    const index: number[] = [];
    for (let j = 0; j < segs; j++) {
      for (let i = 0; i < segs; i++) {
        const a = j * verts + i;
        const b = a + 1;
        const c = a + verts;
        const d = c + 1;
        // Split along (0,0)-(1,1), matching heightfield.surface(); counter-clockwise from above.
        index.push(a, d, b, a, c, d);
      }
    }

    // Skirts: each edge vertex gets a twin hanging below it, so LOD seams never show sky.
    // The ring of edge vertices goes round the chunk in one consistent direction.
    const ring: number[] = [];
    for (let k = 0; k < segs; k++) ring.push(k); // north edge, west to east
    for (let k = 0; k < segs; k++) ring.push(segs + k * verts); // east edge, north to south
    for (let k = 0; k < segs; k++) ring.push(verts * verts - 1 - k); // south edge, east to west
    for (let k = 0; k < segs; k++) ring.push((segs - k) * verts); // west edge, south to north
    const drop = SKIRT_DEPTH * step;
    const base = verts * verts;
    ring.forEach((src, k) => {
      const v = (base + k) * 3;
      pos[v] = pos[src * 3];
      pos[v + 1] = pos[src * 3 + 1] - drop;
      pos[v + 2] = pos[src * 3 + 2];
      nor[v] = nor[src * 3];
      nor[v + 1] = nor[src * 3 + 1];
      nor[v + 2] = nor[src * 3 + 2];
    });
    for (let k = 0; k < ring.length; k++) {
      const a = ring[k];
      const b = ring[(k + 1) % ring.length];
      const a2 = base + k;
      const b2 = base + ((k + 1) % ring.length);
      index.push(a, b, a2, b, b2, a2); // facing outward
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(pos, 3));
    geometry.setAttribute('normal', new BufferAttribute(nor, 3));
    geometry.setIndex(index);
    geometry.computeBoundingSphere();
    return geometry;
  }
}
