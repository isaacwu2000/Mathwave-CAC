import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { Plot } from '../types.ts';

type ObjectEntry = {
  plot: Plot;
  object: LineSegments2 | THREE.Points | THREE.Mesh;
};
const sameNumbers = (a: number[] | undefined, b: number[] | undefined) =>
  a === b ||
  Boolean(a && b && a.length === b.length && a.every((n, i) => n === b[i]));

/** Owns plot objects and reuses their buffers across graph frames.
 * Removed objects release GPU resources; unchanged geometry is never rebuilt.
 */
export class GraphObjects {
  readonly group = new THREE.Group();
  private readonly entries = new Map<string, ObjectEntry>();
  constructor(private readonly dimension: 2 | 3) {}

  update(plots: readonly Plot[], viewport: { width: number; height: number }) {
    const live = new Set(
      plots.filter((p) => p.positions.length).map((p) => p.id),
    );
    for (const [id, entry] of this.entries)
      if (!live.has(id)) this.remove(id, entry);
    for (const plot of plots) {
      if (!plot.positions.length) continue;
      let entry = this.entries.get(plot.id);
      if (
        entry &&
        (entry.plot.kind !== plot.kind ||
          entry.plot.radius !== plot.radius ||
          (plot.radius &&
            entry.plot.positions.length !== plot.positions.length))
      ) {
        this.remove(plot.id, entry);
        entry = undefined;
      }
      if (!entry) {
        let object: ObjectEntry['object'];
        if (plot.kind === 'line') {
          object = new LineSegments2(
            new LineSegmentsGeometry(),
            new LineMaterial({
              color: plot.color,
              linewidth: plot.width ?? 2.5,
            }),
          );
        } else if (
          plot.kind === 'point' &&
          plot.radius &&
          this.dimension === 3
        ) {
          object = new THREE.InstancedMesh(
            new THREE.SphereGeometry(plot.radius, 20, 12),
            new THREE.MeshStandardMaterial({
              color: plot.color,
              roughness: 0.4,
            }),
            plot.positions.length / 3,
          );
        } else if (plot.kind === 'point') {
          const material = new THREE.PointsMaterial({
            color: plot.color,
            size: 9,
            sizeAttenuation: false,
          });
          material.onBeforeCompile = (shader) => {
            shader.fragmentShader = shader.fragmentShader.replace(
              '#include <clipping_planes_fragment>',
              '#include <clipping_planes_fragment>\nif (distance(gl_PointCoord, vec2(0.5)) > 0.5) discard;',
            );
          };
          object = new THREE.Points(new THREE.BufferGeometry(), material);
        } else
          object = new THREE.Mesh(
            new THREE.BufferGeometry(),
            this.dimension === 3
              ? new THREE.MeshStandardMaterial({
                  color: plot.color,
                  side: THREE.DoubleSide,
                  roughness: 0.38,
                })
              : new THREE.MeshBasicMaterial({
                  color: plot.color,
                  transparent: true,
                  opacity: plot.opacity ?? 0.15,
                  side: THREE.DoubleSide,
                  depthWrite: false,
                }),
          );
        object.name = plot.id;
        entry = { plot: { ...plot, positions: [] }, object };
        this.entries.set(plot.id, entry);
        this.group.add(object);
      }
      const { object } = entry;
      if (object instanceof LineSegments2) {
        object.material.resolution.set(viewport.width, viewport.height);
        object.material.linewidth = plot.width ?? 2.5;
      }
      if (
        object instanceof THREE.Mesh &&
        object.material instanceof THREE.MeshBasicMaterial
      )
        object.material.opacity = plot.opacity ?? 0.15;
      const material = object.material;
      if (
        !Array.isArray(material) &&
        'color' in material &&
        material.color instanceof THREE.Color
      )
        material.color.set(plot.color);
      if (
        !sameNumbers(entry.plot.positions, plot.positions) ||
        !sameNumbers(entry.plot.normals, plot.normals)
      ) {
        if (object instanceof THREE.InstancedMesh) {
          const matrix = new THREE.Matrix4();
          for (let i = 0; i < plot.positions.length; i += 3)
            object.setMatrixAt(
              i / 3,
              matrix.makeTranslation(
                plot.positions[i],
                plot.positions[i + 1],
                plot.positions[i + 2],
              ),
            );
          object.instanceMatrix.needsUpdate = true;
          object.computeBoundingBox();
          object.computeBoundingSphere();
        } else if (object instanceof LineSegments2) {
          const start = object.geometry.getAttribute('instanceStart');
          if (
            start instanceof THREE.InterleavedBufferAttribute &&
            start.data.array.length === plot.positions.length
          ) {
            start.data.array.set(plot.positions);
            start.data.needsUpdate = true;
          } else object.geometry.setPositions(plot.positions);
        } else {
          const old = object.geometry.getAttribute('position');
          if (
            old instanceof THREE.BufferAttribute &&
            old.array.length === plot.positions.length
          ) {
            old.array.set(plot.positions);
            old.needsUpdate = true;
          } else
            object.geometry.setAttribute(
              'position',
              new THREE.Float32BufferAttribute(plot.positions, 3),
            );
          if (plot.kind === 'surface') {
            if (plot.normals)
              object.geometry.setAttribute(
                'normal',
                new THREE.Float32BufferAttribute(plot.normals, 3),
              );
            else object.geometry.computeVertexNormals();
          }
        }
        object.geometry.computeBoundingBox();
        object.geometry.computeBoundingSphere();
      }
      entry.plot = plot;
    }
  }

  private remove(id: string, entry: ObjectEntry) {
    if (entry.object instanceof THREE.InstancedMesh) entry.object.dispose();
    entry.object.geometry.dispose();
    const materials = Array.isArray(entry.object.material)
      ? entry.object.material
      : [entry.object.material];
    materials.forEach((m) => m.dispose());
    this.group.remove(entry.object);
    this.entries.delete(id);
  }

  dispose() {
    for (const [id, entry] of this.entries) this.remove(id, entry);
  }
}
