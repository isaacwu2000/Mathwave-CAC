import {
  Raycaster,
  Vector2,
  type Camera,
  type Plane,
  type Object3D,
  type Vector3,
} from 'three';

/** Tests the camera-to-label segment against plotted surfaces, matching scene depth. */
export function isGraphLabelVisible(
  point: Vector3,
  camera: Camera,
  plots: Object3D,
  clippingPlanes: Plane[] = [],
): boolean {
  const projected = point.clone().project(camera);
  if (
    projected.z < -1 ||
    projected.z > 1 ||
    Math.abs(projected.x) > 1 ||
    Math.abs(projected.y) > 1
  )
    return false;
  const ray = new Raycaster();
  ray.setFromCamera(new Vector2(projected.x, projected.y), camera);
  ray.far = Math.max(0, ray.ray.origin.distanceTo(point) - 1e-5);
  const surfaces: Object3D[] = [];
  plots.traverse((object) => {
    if (object.type === 'Mesh' && object.visible) surfaces.push(object);
  });
  return !ray
    .intersectObjects(surfaces, false)
    .some((hit) =>
      clippingPlanes.every((plane) => plane.distanceToPoint(hit.point) >= 0),
    );
}
