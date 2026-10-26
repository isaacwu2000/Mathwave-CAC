/** World-space half-width that keeps 3D axes useful as the camera dollies. */
export function perspectiveAxisExtent(
  distance: number,
  fieldOfView: number,
  aspect: number,
  zoom: number,
) {
  return Math.max(
    1e-4,
    Math.min(
      1e6,
      ((distance * Math.tan((fieldOfView * Math.PI) / 360)) / zoom) *
        0.8 *
        Math.min(1, aspect),
    ),
  );
}

/** Fits the authored square within the shorter screen dimension without stretching it. */
export function orthographicExtents(span: number, aspect: number) {
  return {
    halfWidth: (span * Math.max(1, aspect)) / 2,
    halfHeight: (span * Math.max(1, 1 / aspect)) / 2,
  };
}

/** Preserve the shorter-axis field of view when the 3D canvas becomes portrait. */
export function perspectiveFieldOfView(baseDegrees: number, aspect: number) {
  return aspect >= 1
    ? baseDegrees
    : (Math.atan(Math.tan((baseDegrees * Math.PI) / 360) / aspect) * 360) /
        Math.PI;
}

/** Uses familiar 1/2/5 steps, keeping roughly twelve grid intervals in view. */
export function graphTickStep(span: number) {
  const power = 10 ** Math.floor(Math.log10(span / 12));
  const fraction = span / 12 / power;
  return (
    power * (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10)
  );
}
