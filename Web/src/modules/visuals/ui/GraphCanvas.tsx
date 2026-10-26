'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { interpolateCurves } from '../services/curve-motion.ts';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { GraphDocument, GraphResult, GraphCamera } from '../types.ts';
import {
  perspectiveAxisExtent,
  graphTickStep,
  orthographicExtents,
  perspectiveFieldOfView,
} from '../services/viewExtent.ts';
import { gridTicks } from '../services/gridTicks.ts';
import { isGraphLabelVisible } from '../services/labelVisibility.ts';
import { graphPresentation } from '../services/presentation.ts';
import { GraphObjects } from '../services/plotObjects.ts';
import {
  clipBondToLabels,
  clipBondPolygonToLabels,
} from '../services/bondClipping.ts';
import { ScientificLabel } from './ScientificLabel.tsx';
import {
  layoutGraphLabels,
  separatedBasePairLabels,
} from '../services/labelLayout.ts';

const labelSizeKey = (label: {
  text: string;
  badgeColor?: string;
  sequenceIndex?: number;
  anchored?: boolean;
}) =>
  `${label.text}:${label.badgeColor ? 'badge' : label.sequenceIndex !== undefined ? 'base' : 'plain'}:${label.anchored ? 'anchored' : 'free'}`;

type DiagramLabel = NonNullable<GraphResult['labels']>[number] & {
  electronPair?: boolean;
  vertical?: boolean;
  atomPosition?: [number, number, number];
};

/** Renders owned geometry in WebGL and disposes GPU resources when a graph closes. */
export function GraphCanvas({
  document,
  result,
  resetKey,
  onViewport,
  onSelect,
  onCamera,
  onFailure,
  onRendered,
  onRenderPending,
  interactive = true,
  capture = false,
  curveMotion,
  viewportMotion = false,
}: {
  document: GraphDocument;
  result: GraphResult | null;
  resetKey: number;
  onFailure?: () => void;
  onRendered?: (result: GraphResult) => void;
  onRenderPending?: () => void;
  interactive?: boolean;
  capture?: boolean;
  curveMotion?: string;
  viewportMotion?: boolean;
  onCamera?: (camera: GraphCamera) => void;
  onViewport?: (bounds: GraphDocument['bounds']) => void;
  onSelect?: (point: { x: number; y: number }) => void;
}) {
  const pendingCallback = useRef(onRenderPending);
  useEffect(() => {
    pendingCallback.current = onRenderPending;
  }, [onRenderPending]);
  const renderedCallback = useRef(onRendered);
  const frameResult = useRef<GraphResult | null>(null);
  const sourceResult = useRef(result);
  useEffect(() => {
    renderedCallback.current = onRendered;
  }, [onRendered]);
  const failureCallback = useRef(onFailure);
  useEffect(() => {
    failureCallback.current = onFailure;
  }, [onFailure]);
  const host = useRef<HTMLDivElement>(null);
  const viewportCallback = useRef(onViewport);
  const selectCallback = useRef(onSelect);
  useEffect(() => {
    selectCallback.current = onSelect;
  }, [onSelect]);
  const cameraCallback = useRef(onCamera);
  const presentation = useRef(graphPresentation(document));
  const geometryLabels = useRef<DiagramLabel[]>([]);
  const labelStride = useRef(3);
  const geometryPlots = useRef(result?.plots ?? []);
  const labelSizes = useRef(
    new Map<string, { width: number; height: number }>(),
  );
  useEffect(() => {
    cameraCallback.current = onCamera;
  }, [onCamera]);
  useEffect(() => {
    viewportCallback.current = onViewport;
  }, [onViewport]);
  const [error, setError] = useState('');
  const [labels, setLabels] = useState<
    Array<{
      text: string;
      x: number;
      y: number;
      alignRight?: boolean;
      anchored?: boolean;
      scientific?: boolean;
      electronPair?: boolean;
      vertical?: boolean;
      badgeColor?: string;
      tintColor?: string;
      sequenceIndex?: number;
    }>
  >([]);
  const view = useRef<{
    scene: THREE.Scene;
    camera: THREE.Camera;
    renderer: THREE.WebGLRenderer;
    controls: OrbitControls;
    group: THREE.Group;
    objects: GraphObjects;
    draw: () => void;
  } | null>(null);
  useEffect(() => {
    sourceResult.current = result;
    frameResult.current = null;
    geometryLabels.current = [
      ...(result?.labels ?? []),
      ...(result?.electronPairs ?? []).map((pair) => ({
        ...pair,
        text: '',
        anchored: true,
        electronPair: true,
      })),
    ];
    geometryPlots.current = result?.plots ?? [];
    view.current?.draw();
  }, [result]);
  useEffect(() => {
    presentation.current = graphPresentation(document);
    labelStride.current =
      document.chemistry?.kind === 'dna'
        ? (document.chemistry.labelEvery ?? 3)
        : 3;
    view.current?.draw();
  }, [document]);
  useLayoutEffect(() => {
    let changed = false;
    for (const node of host.current?.querySelectorAll<HTMLElement>(
      '[data-scientific-label="true"]',
    ) ?? []) {
      const key = node.getAttribute('data-label-size-key')!;
      const { width, height } = node.getBoundingClientRect();
      const previous = labelSizes.current.get(key);
      if (
        !previous ||
        Math.abs(previous.width - width) > 0.1 ||
        Math.abs(previous.height - height) > 0.1
      ) {
        labelSizes.current.set(key, { width, height });
        changed = true;
      }
    }
    if (changed) view.current?.draw();
    else if (frameResult.current)
      renderedCallback.current?.(frameResult.current);
  }, [labels]);
  useEffect(() => {
    let active = true;
    void window.document.fonts.ready.then(() => {
      if (active) view.current?.draw();
    });
    return () => {
      active = false;
    };
  }, []);
  const chemical = Boolean(document.chemistry);
  const chemicalYUp = chemical && document.chemistry?.kind !== 'vsepr';
  const dimension = document.dimension,
    min = document.bounds.min,
    max = document.bounds.max,
    yMin = document.bounds.y?.min,
    yMax = document.bounds.y?.max;
  const movingBounds = useRef(document.bounds);
  const canvasSettings = useRef({
    min,
    max,
    yMin,
    yMax,
    interactive,
    bounds: document.bounds,
  });
  useEffect(() => {
    canvasSettings.current = {
      min,
      max,
      yMin,
      yMax,
      interactive,
      bounds: document.bounds,
    };
  });
  // Recording zooms keep their WebGL canvas; ordinary views retain their lifecycle.
  const initMin = viewportMotion ? 0 : min;
  const initMax = viewportMotion ? 0 : max;
  const initYMin = viewportMotion ? 0 : yMin;
  const initYMax = viewportMotion ? 0 : yMax;
  const initInteractive = viewportMotion ? true : interactive;
  useEffect(() => {
    if (!host.current) return;
    const element = host.current;
    const { min, max, yMin, yMax, interactive, bounds } =
      canvasSettings.current;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        preserveDrawingBuffer: capture,
        alpha: false,
      });
    } catch {
      if (failureCallback.current) {
        failureCallback.current();
        return;
      }
      setError(
        'Graphics could not start. Enable hardware acceleration and reload.',
      );
      return;
    }
    const readyFrame = requestAnimationFrame(() => setError(''));
    renderer.setClearColor(
      getComputedStyle(element).getPropertyValue('--graph-background').trim() ||
        '#ffffff',
    );
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    element.appendChild(renderer.domElement);
    renderer.domElement.tabIndex = interactive ? 0 : -1;
    renderer.domElement.setAttribute(
      'aria-label',
      !interactive
        ? 'Study graph'
        : dimension === 2
          ? 'Graph. Arrow keys pan; plus and minus zoom.'
          : '3D graph. Arrow keys rotate; plus and minus zoom.',
    );
    const scene = new THREE.Scene(),
      objects = new GraphObjects(dimension),
      group = objects.group;
    scene.add(group);
    movingBounds.current = bounds;
    const span = max - min,
      center = (min + max) / 2,
      verticalSpan =
        yMin !== undefined && yMax !== undefined ? yMax - yMin : span,
      verticalCenter =
        yMin !== undefined && yMax !== undefined ? (yMin + yMax) / 2 : center;
    const camera =
      dimension === 2
        ? new THREE.OrthographicCamera(min, max, max, min, 0.01, 10000)
        : new THREE.PerspectiveCamera(40, 1, 0.01, 10000);
    camera.up.set(0, chemicalYUp ? 1 : 0, chemicalYUp ? 0 : 1);
    if (dimension === 2) {
      camera.up.set(0, 1, 0);
      camera.position.set(center, verticalCenter, span * 4);
    } else
      camera.position.set(
        center + span * (chemicalYUp ? 0.65 : chemical ? 1.6 : 1.35),
        center - span * (chemicalYUp ? 0.35 : chemical ? 0.9 : 1.65),
        center + span * (chemicalYUp ? 1.5 : chemical ? 0.4 : 1.2),
      );
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enabled = interactive;
    controls.target.set(center, verticalCenter, dimension === 2 ? 0 : center);
    controls.enableRotate = dimension === 3;
    controls.enableDamping = false;
    controls.zoomSpeed = 3;
    controls.minZoom = 0.0001;
    controls.maxZoom = 100000;
    controls.minDistance = 0.001;
    controls.maxDistance = 1e6;
    controls.screenSpacePanning = true;
    // A graph is a draggable plane in 2D and an orbitable scene in 3D.
    controls.mouseButtons.LEFT =
      dimension === 2 ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
    controls.touches.ONE =
      dimension === 2 ? THREE.TOUCH.PAN : THREE.TOUCH.ROTATE;
    controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;
    renderer.domElement.style.cursor = !interactive
      ? 'default'
      : dimension === 2
        ? 'grab'
        : 'move';
    let commitTimer: ReturnType<typeof setTimeout> | undefined;
    const commitView = () => {
      if (!(camera instanceof THREE.OrthographicCamera)) return;
      viewportCallback.current?.({
        min: camera.position.x + camera.left / camera.zoom,
        max: camera.position.x + camera.right / camera.zoom,
        y: {
          min: camera.position.y + camera.bottom / camera.zoom,
          max: camera.position.y + camera.top / camera.zoom,
        },
      });
    };
    const dragStart = () => {
      clearTimeout(commitTimer);
      renderer.domElement.style.cursor = 'grabbing';
    };
    const dragEnd = () => {
      renderer.domElement.style.cursor = dimension === 2 ? 'grab' : 'move';
      clearTimeout(commitTimer);
      // Wheel/pinch can emit many end events; one quiet period is one edit.
      commitTimer = setTimeout(commitView, 180);
    };
    controls.addEventListener('start', dragStart);
    controls.addEventListener('end', dragEnd);
    let pointerStart: { x: number; y: number } | null = null;
    const pointerDown = (event: PointerEvent) => {
      pointerStart = { x: event.clientX, y: event.clientY };
    };
    const pointerUp = (event: PointerEvent) => {
      const start = pointerStart;
      pointerStart = null;
      if (
        !interactive ||
        !start ||
        dimension !== 2 ||
        Math.hypot(event.clientX - start.x, event.clientY - start.y) > 3
      )
        return;
      const rect = renderer.domElement.getBoundingClientRect();
      const point = new THREE.Vector3(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        1 - ((event.clientY - rect.top) / rect.height) * 2,
        0,
      ).unproject(camera);
      selectCallback.current?.({ x: point.x, y: point.y });
    };
    const pointerCancel = () => {
      pointerStart = null;
    };
    renderer.domElement.addEventListener('pointerdown', pointerDown);
    renderer.domElement.addEventListener('pointerup', pointerUp);
    renderer.domElement.addEventListener('pointercancel', pointerCancel);
    scene.add(new THREE.AmbientLight(0xffffff, 0.9));
    const sun = new THREE.DirectionalLight(0xffffff, 2.5);
    sun.position.set(5, -3, 8);
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0xffffff, 0.8);
    fill.position.set(-5, 3, -4);
    scene.add(fill);
    const lineMaterials: LineMaterial[] = [];
    const grid = new THREE.Group();
    scene.add(grid);
    let labelPoints: Array<{
      text: string;
      point: THREE.Vector3;
      axisTitle?: boolean;
    }> = [];
    let gridSignature = '';
    const rebuildGrid = () => {
      let left = min,
        right = max,
        bottom = min,
        top = max,
        zMin = min,
        zMax = max;
      if (camera instanceof THREE.OrthographicCamera) {
        left = camera.position.x + camera.left / camera.zoom;
        right = camera.position.x + camera.right / camera.zoom;
        bottom = camera.position.y + camera.bottom / camera.zoom;
        top = camera.position.y + camera.top / camera.zoom;
      } else {
        const extent = perspectiveAxisExtent(
          camera.position.distanceTo(controls.target),
          camera.fov,
          camera.aspect,
          camera.zoom,
        );
        left = controls.target.x - extent;
        right = controls.target.x + extent;
        bottom = controls.target.y - extent;
        top = controls.target.y + extent;
        zMin = controls.target.z - extent;
        zMax = controls.target.z + extent;
        camera.far = Math.max(10000, camera.position.length() + extent * 8);
        camera.updateProjectionMatrix();
        // Clip unbounded surfaces to the same visible cube as the axes.
        renderer.clippingPlanes = [
          new THREE.Plane(new THREE.Vector3(1, 0, 0), -left),
          new THREE.Plane(new THREE.Vector3(-1, 0, 0), right),
          new THREE.Plane(new THREE.Vector3(0, 1, 0), -bottom),
          new THREE.Plane(new THREE.Vector3(0, -1, 0), top),
          new THREE.Plane(new THREE.Vector3(0, 0, 1), -zMin),
          new THREE.Plane(new THREE.Vector3(0, 0, -1), zMax),
        ];
      }
      const display = presentation.current;
      const signature = [
        left,
        right,
        bottom,
        top,
        zMin,
        zMax,
        JSON.stringify(display),
      ].join(',');
      if (signature === gridSignature) return;
      gridSignature = signature;
      grid.traverse((o) => {
        if (o instanceof LineSegments2) {
          o.geometry.dispose();
          o.material.dispose();
        }
      });
      grid.clear();
      lineMaterials.length = 0;
      labelPoints = [];
      const visibleSpan = Math.max(right - left, top - bottom);
      const step = graphTickStep(visibleSpan);
      const xStep = yMin !== undefined ? graphTickStep(right - left) : step;
      const yStep = yMin !== undefined ? graphTickStep(top - bottom) : step;
      const addLine = (points: number[], color: string, width: number) => {
        const geometry = new LineSegmentsGeometry();
        geometry.setPositions(points);
        const material = new LineMaterial({ color, linewidth: width });
        material.resolution.set(element.clientWidth, element.clientHeight);
        lineMaterials.push(material);
        grid.add(new LineSegments2(geometry, material));
      };
      for (const x of gridTicks(left, right, xStep)) {
        if (Math.abs(x) < xStep / 100 ? display.axes.y : display.grid)
          addLine(
            [x, bottom, 0, x, top, 0],
            Math.abs(x) < xStep / 100 ? '#657779' : '#dce4e4',
            Math.abs(x) < xStep / 100 ? 1.5 : 0.6,
          );
        if (
          display.axes.x &&
          Math.abs(x) > xStep / 100 &&
          (dimension === 2 || Math.abs(Math.round(x / step)) % 2 === 0)
        )
          labelPoints.push({
            text: Number(x.toPrecision(5)).toString(),
            point: new THREE.Vector3(x, 0, 0),
          });
      }
      for (const y of gridTicks(bottom, top, yStep)) {
        if (Math.abs(y) < yStep / 100 ? display.axes.x : display.grid)
          addLine(
            [left, y, 0, right, y, 0],
            Math.abs(y) < yStep / 100 ? '#657779' : '#dce4e4',
            Math.abs(y) < yStep / 100 ? 1.5 : 0.6,
          );
        if (
          display.axes.y &&
          Math.abs(y) > yStep / 100 &&
          (dimension === 2 || Math.abs(Math.round(y / step)) % 2 === 0)
        )
          labelPoints.push({
            text: Number(y.toPrecision(5)).toString(),
            point: new THREE.Vector3(0, y, 0),
          });
      }
      if (dimension === 3 && display.axes.z) {
        addLine([0, 0, zMin, 0, 0, zMax], '#657779', 1.5);
        for (const z of gridTicks(zMin, zMax, step)) {
          if (
            Math.abs(z) > step / 100 &&
            Math.abs(Math.round(z / step)) % 2 === 0
          )
            labelPoints.push({
              text: Number(z.toPrecision(5)).toString(),
              point: new THREE.Vector3(0, 0, z),
            });
        }
        labelPoints.push({
          text: display.labels.z,
          axisTitle: true,
          point: new THREE.Vector3(0, 0, zMax + step * 0.4),
        });
      }
      // Arrowheads follow the same world axes and depth test as the grid.
      const arrow = step * 0.08;
      if (dimension === 3)
        addLine(
          [
            right - arrow,
            -arrow,
            0,
            right,
            0,
            0,
            right,
            0,
            0,
            right - arrow,
            arrow,
            0,
            -arrow,
            top - arrow,
            0,
            0,
            top,
            0,
            0,
            top,
            0,
            arrow,
            top - arrow,
            0,
            left + arrow,
            -arrow,
            0,
            left,
            0,
            0,
            left,
            0,
            0,
            left + arrow,
            arrow,
            0,
            -arrow,
            bottom + arrow,
            0,
            0,
            bottom,
            0,
            0,
            bottom,
            0,
            arrow,
            bottom + arrow,
            0,
          ].filter((_value, index) =>
            Math.floor(index / 12) % 2 === 0 ? display.axes.x : display.axes.y,
          ),
          '#657779',
          1.5,
        );
      if (dimension === 3 && display.axes.z)
        addLine(
          [
            -arrow,
            0,
            zMax - arrow,
            0,
            0,
            zMax,
            0,
            0,
            zMax,
            arrow,
            0,
            zMax - arrow,
            -arrow,
            0,
            zMin + arrow,
            0,
            0,
            zMin,
            0,
            0,
            zMin,
            arrow,
            0,
            zMin + arrow,
          ],
          '#657779',
          1.5,
        );
      if (display.axes.x)
        labelPoints.push({
          text: display.labels.x,
          axisTitle: true,
          point: new THREE.Vector3(right - xStep * 0.55, yStep * 0.28, 0),
        });
      if (display.axes.y)
        labelPoints.push({
          text: display.labels.y,
          axisTitle: true,
          point: new THREE.Vector3(xStep * 0.28, top - yStep * 0.55, 0),
        });
    };
    let frame = 0;
    const draw = () => {
      pendingCallback.current?.();
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        rebuildGrid();
        camera.updateMatrixWorld();
        cameraCallback.current?.({
          position: camera.position.toArray(),
          target: controls.target.toArray(),
          zoom: camera.zoom,
        });
        const w = element.clientWidth,
          h = element.clientHeight;
        let projectedLabels = [
          ...labelPoints.map((label) => ({
            ...label,
            annotation: false,
            anchored: false,
            scientific: false,
            electronPair: false,
            vertical: false,
            badgeColor: undefined as string | undefined,
            tintColor: undefined as string | undefined,
            atomPosition: undefined as [number, number, number] | undefined,
            sequenceIndex: undefined as number | undefined,
          })),
          ...(geometryLabels.current ?? []).map((label) => ({
            text: label.text,
            point: new THREE.Vector3(...label.position),
            annotation: true,
            anchored: label.anchored ?? false,
            scientific: label.scientific ?? false,
            axisTitle: false,
            electronPair: label.electronPair,
            vertical: label.vertical,
            badgeColor: label.badgeColor,
            tintColor: label.tintColor,
            atomPosition: label.atomPosition,
            sequenceIndex: label.sequenceIndex,
          })),
        ]
          .filter(
            (label) =>
              !chemical ||
              label.sequenceIndex === undefined ||
              label.sequenceIndex % labelStride.current === 0 ||
              dimension === 2,
          )
          .filter(({ point, text, scientific, electronPair }) => {
            // Scientific overlays stay attached to their source positions.
            // Keep their labels readable even on the back of a model;
            // anchored overlays deliberately bypass collision layout.
            if (dimension === 2 || scientific || electronPair) return true;
            const center = point.clone().project(camera);
            center.x += ((5 + text.length * 3.5) * 2) / w;
            center.y -= ((5 + 7) * 2) / h;
            return isGraphLabelVisible(
              center.unproject(camera),
              camera,
              group,
              renderer.clippingPlanes,
            );
          })
          .map(
            ({
              text,
              point,
              annotation,
              axisTitle,
              anchored,
              scientific,
              electronPair,
              vertical,
              badgeColor,
              tintColor,
              atomPosition,
              sequenceIndex,
            }) => {
              const p = point.clone().project(camera);
              let x = ((p.x + 1) * w) / 2,
                y = ((1 - p.y) * h) / 2;
              if (electronPair && atomPosition) {
                const atom = new THREE.Vector3(...atomPosition).project(camera);
                const ax = ((atom.x + 1) * w) / 2,
                  ay = ((1 - atom.y) * h) / 2;
                const atomLabel = geometryLabels.current.find(
                  (l) =>
                    !l.electronPair &&
                    l.position.every(
                      (v, i) => Math.abs(v - atomPosition[i]) < 1e-8,
                    ),
                );
                const size = labelSizes.current.get(
                  labelSizeKey(atomLabel ?? { text: '' }),
                ) ?? { width: 24, height: 26 };
                // Lone pairs follow the label edge in pixels, including multi-letter atoms.
                const dx = x - ax,
                  dy = y - ay,
                  length = Math.hypot(dx, dy) || 1;
                const ux = dx / length,
                  uy = dy / length;
                const edge = Math.min(
                  Math.abs(ux) > 1e-6
                    ? size.width / 2 / Math.abs(ux)
                    : Infinity,
                  Math.abs(uy) > 1e-6
                    ? size.height / 2 / Math.abs(uy)
                    : Infinity,
                );
                x = ax + ux * (edge + 9);
                y = ay + uy * (edge + 9);
              }
              return {
                text,
                annotation,
                anchored,
                scientific,
                electronPair,
                vertical,
                badgeColor,
                tintColor,
                sequenceIndex,
                // Axis titles near the right edge extend inward, not beyond the canvas.
                alignRight: Boolean(axisTitle && p.x > 0),
                x: x + (anchored ? 0 : 5),
                y: y + (anchored ? 0 : 5),
              };
            },
          )
          .filter((p) => p.x > 0 && p.x < w - 20 && p.y > 0 && p.y < h - 20);
        if (
          chemical &&
          dimension === 3 &&
          labelStride.current > 1 &&
          projectedLabels.some((l) => l.sequenceIndex !== undefined)
        ) {
          projectedLabels = separatedBasePairLabels(
            projectedLabels,
            (l) =>
              labelSizes.current.get(labelSizeKey(l)) ?? {
                width: 21,
                height: 24,
              },
          );
        }
        if (chemical && dimension === 2) {
          const boxes = projectedLabels
            .filter((l) => l.scientific && l.anchored)
            .map((l) => {
              const size = labelSizes.current.get(labelSizeKey(l)) ?? {
                width: l.text.length * 12 + 8,
                height: 26,
              };
              return {
                left: l.x - size.width / 2,
                right: l.x + size.width / 2,
                top: l.y - size.height / 2,
                bottom: l.y + size.height / 2,
              };
            });
          const project = (p: number[]) => {
            const v = new THREE.Vector3(...p).project(camera);
            return { x: ((v.x + 1) * w) / 2, y: ((1 - v.y) * h) / 2 };
          };
          const unproject = (p: { x: number; y: number }) => {
            const v = new THREE.Vector3(
              (p.x / w) * 2 - 1,
              1 - (p.y / h) * 2,
              0,
            ).unproject(camera);
            return [v.x, v.y, 0];
          };
          // Cut actual geometry at measured label boxes; the translucent backdrop
          // must never be responsible for hiding an overlong bond.
          objects.update(
            geometryPlots.current.map((plot) => {
              if (plot.kind === 'line') {
                const positions: number[] = [];
                for (let i = 0; i + 5 < plot.positions.length; i += 6) {
                  const a = project(plot.positions.slice(i, i + 3)),
                    b = project(plot.positions.slice(i + 3, i + 6));
                  for (const part of clipBondToLabels(
                    a,
                    b,
                    boxes.map((box) => ({
                      left: box.left - (plot.width ?? 2.5) / 2,
                      right: box.right + (plot.width ?? 2.5) / 2,
                      top: box.top - (plot.width ?? 2.5) / 2,
                      bottom: box.bottom + (plot.width ?? 2.5) / 2,
                    })),
                  ))
                    positions.push(...unproject(part.a), ...unproject(part.b));
                }
                return { ...plot, positions };
              }
              if (
                plot.kind === 'surface' &&
                plot.id.startsWith('chem-wedge-')
              ) {
                const vertices = [0, 3, 6].map((i) =>
                  project(plot.positions.slice(i, i + 3)),
                );
                const positions = clipBondPolygonToLabels(
                  vertices,
                  boxes,
                ).flatMap((triangle) => triangle.flatMap(unproject));
                return { ...plot, positions };
              }
              return plot;
            }),
            { width: w, height: h },
          );
        }
        renderer.render(scene, camera);
        const segments: NonNullable<
          Parameters<typeof layoutGraphLabels>[3]
        >[number][] = [];
        if (geometryLabels.current?.length)
          for (const plot of geometryPlots.current)
            if (plot.kind === 'line') {
              for (
                let index = 0;
                index + 5 < plot.positions.length && segments.length < 2000;
                index += 6
              ) {
                const project = (offset: number) => {
                  const point = new THREE.Vector3(
                    ...plot.positions.slice(offset, offset + 3),
                  ).project(camera);
                  return {
                    x: ((point.x + 1) * w) / 2,
                    y: ((1 - point.y) * h) / 2,
                  };
                };
                segments.push({ a: project(index), b: project(index + 3) });
              }
            }
        // Keep axis ticks fixed; only mathematical annotations need collision placement.
        frameResult.current = sourceResult.current;
        setLabels([
          ...projectedLabels.filter(
            (label) => !label.annotation || label.anchored,
          ),
          ...layoutGraphLabels(
            projectedLabels.filter(
              (label) => label.annotation && !label.anchored,
            ),
            w,
            h,
            segments,
          ),
        ]);
      });
    };
    const resize = () => {
      const w = element.clientWidth,
        h = element.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h);
      if (camera instanceof THREE.PerspectiveCamera) {
        camera.aspect = w / h;
        camera.fov = perspectiveFieldOfView(40, camera.aspect);
      } else {
        const aspect = w / h;
        // Explicit data ranges fill each axis independently; geometry keeps equal scale.
        const shownBounds = viewportMotion ? movingBounds.current : bounds;
        const width = shownBounds.max - shownBounds.min;
        const { halfWidth, halfHeight } =
          shownBounds.y && presentation.current.preset !== 'geometry'
            ? {
                halfWidth: width / 2,
                halfHeight: (shownBounds.y.max - shownBounds.y.min) / 2,
              }
            : orthographicExtents(width, aspect);
        camera.left = -halfWidth;
        camera.right = halfWidth;
        camera.top = halfHeight;
        camera.bottom = -halfHeight;
      }
      camera.updateProjectionMatrix();
      scene.traverse((o) => {
        if (o instanceof LineSegments2)
          (o.material as LineMaterial).resolution.set(w, h);
      });
      draw();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    controls.addEventListener('change', draw);
    controls.update();
    const keyboard = (event: KeyboardEvent) => {
      if (
        ![
          'ArrowUp',
          'ArrowDown',
          'ArrowLeft',
          'ArrowRight',
          '+',
          '-',
          '=',
        ].includes(event.key)
      )
        return;
      event.preventDefault();
      if (['+', '-', '='].includes(event.key)) {
        if (camera instanceof THREE.OrthographicCamera) {
          camera.zoom *= event.key === '-' ? 2 / 3 : 1.5;
          camera.updateProjectionMatrix();
        } else
          camera.position
            .sub(controls.target)
            .multiplyScalar(event.key === '-' ? 1.5 : 2 / 3)
            .add(controls.target);
      } else if (dimension === 2) {
        const shift = new THREE.Vector3(
          event.key === 'ArrowRight'
            ? span / 20
            : event.key === 'ArrowLeft'
              ? -span / 20
              : 0,
          event.key === 'ArrowUp'
            ? verticalSpan / 20
            : event.key === 'ArrowDown'
              ? -verticalSpan / 20
              : 0,
          0,
        );
        camera.position.add(shift);
        controls.target.add(shift);
      } else {
        const offset = camera.position.clone().sub(controls.target);
        offset.applyAxisAngle(
          new THREE.Vector3(0, 0, 1),
          event.key === 'ArrowLeft'
            ? 0.1
            : event.key === 'ArrowRight'
              ? -0.1
              : 0,
        );
        if (event.key === 'ArrowUp') offset.z += span / 15;
        if (event.key === 'ArrowDown') offset.z -= span / 15;
        camera.position.copy(controls.target).add(offset);
      }
      controls.update();
      draw();
      dragEnd();
    };
    const lost = (event: Event) => {
      event.preventDefault();
      if (failureCallback.current) {
        failureCallback.current();
        return;
      }
      setError('Graphics interrupted. Reset the view to retry.');
    };
    if (interactive) renderer.domElement.addEventListener('keydown', keyboard);
    renderer.domElement.addEventListener('webglcontextlost', lost);
    view.current = { scene, camera, renderer, controls, group, objects, draw };
    resize();
    return () => {
      observer.disconnect();
      clearTimeout(commitTimer);
      cancelAnimationFrame(readyFrame);
      cancelAnimationFrame(frame);
      controls.dispose();
      objects.dispose();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        if (m.material) {
          const materials = Array.isArray(m.material)
            ? m.material
            : [m.material];
          materials.forEach((m) => m.dispose());
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
      view.current = null;
    };
  }, [
    dimension,
    initMin,
    initMax,
    initYMin,
    initYMax,
    resetKey,
    initInteractive,
    viewportMotion,
    capture,
    chemical,
    chemicalYUp,
  ]);
  useEffect(() => {
    const v = view.current;
    if (!viewportMotion || !v) return;
    v.controls.enabled = interactive;
    v.renderer.domElement.style.cursor = interactive ? 'grab' : 'default';
  }, [interactive, viewportMotion]);
  useEffect(() => {
    const v = view.current;
    if (
      !viewportMotion ||
      !v ||
      !(v.camera instanceof THREE.OrthographicCamera) ||
      dimension !== 2
    )
      return;
    const camera = v.camera;
    const from = {
      min: camera.position.x + camera.left / camera.zoom,
      max: camera.position.x + camera.right / camera.zoom,
      y: {
        min: camera.position.y + camera.bottom / camera.zoom,
        max: camera.position.y + camera.top / camera.zoom,
      },
    };
    const to = { min, max, y: { min: yMin ?? min, max: yMax ?? max } };
    const started = performance.now();
    let frame = 0;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const update = (now: number) => {
      const t = reduced ? 1 : Math.min(1, (now - started) / 850);
      const progress = t * t * (3 - 2 * t);
      const mix = (a: number, b: number) => a + (b - a) * progress;
      const bounds = {
        min: mix(from.min, to.min),
        max: mix(from.max, to.max),
        y: { min: mix(from.y.min, to.y.min), max: mix(from.y.max, to.y.max) },
      };
      movingBounds.current = bounds;
      const x = (bounds.min + bounds.max) / 2,
        y = (bounds.y.min + bounds.y.max) / 2;
      camera.position.x = x;
      camera.position.y = y;
      v.controls.target.set(x, y, 0);
      camera.zoom = 1;
      camera.left = -(bounds.max - bounds.min) / 2;
      camera.right = -camera.left;
      camera.bottom = -(bounds.y.max - bounds.y.min) / 2;
      camera.top = -camera.bottom;
      camera.updateProjectionMatrix();
      v.controls.update();
      v.draw();
      if (t < 1) frame = requestAnimationFrame(update);
    };
    update(started);
    return () => cancelAnimationFrame(frame);
  }, [viewportMotion, dimension, min, max, yMin, yMax, resetKey]);
  const previousCurve = useRef<{ key?: string; result: GraphResult } | null>(
    null,
  );
  useEffect(() => {
    const v = view.current;
    if (!v || !result) return;
    const previous = previousCurve.current;
    previousCurve.current = { key: curveMotion, result };
    const canMorph =
      curveMotion &&
      previous?.key &&
      curveMotion !== previous.key &&
      curveMotion.split(':')[0] === previous.key.split(':')[0] &&
      !matchMedia('(prefers-reduced-motion: reduce)').matches &&
      interpolateCurves(previous.result, result, 0);
    let frame = 0;
    const started = performance.now();
    const update = (now: number) => {
      const t = canMorph ? Math.min(1, (now - started) / 700) : 1;
      const progress = t * t * (3 - 2 * t);
      const shown = canMorph
        ? interpolateCurves(previous!.result, result, progress)!
        : result;
      v.objects.update(shown.plots, {
        width: v.renderer.domElement.clientWidth,
        height: v.renderer.domElement.clientHeight,
      });
      v.draw();
      if (t < 1) frame = requestAnimationFrame(update);
    };
    update(started);
    return () => cancelAnimationFrame(frame);
  }, [result, curveMotion, dimension, min, max, yMin, yMax, resetKey, capture]);
  return (
    <div className="absolute inset-0" ref={host}>
      {labels.map((p, i) => (
        <span
          key={i}
          aria-hidden={!p.scientific}
          data-electron-pair={p.electronPair || undefined}
          data-base-pair={p.sequenceIndex}
          data-label-size-key={labelSizeKey(p)}
          aria-label={p.scientific ? p.text : undefined}
          data-scientific-label={p.scientific || undefined}
          className="pointer-events-none absolute text-sm text-(--neutral-dark-400)"
          style={{
            left: p.x,
            top: p.y,
            whiteSpace: 'nowrap',
            padding: p.badgeColor ? 5 : p.anchored ? '1px 4px' : undefined,
            fontSize: p.scientific
              ? document.chemistry?.kind === 'dna' &&
                p.sequenceIndex !== undefined
                ? 16
                : 20
              : undefined,
            color: p.scientific ? '#24313f' : undefined,
            background:
              p.badgeColor || p.tintColor
                ? `color-mix(in srgb, ${p.badgeColor ?? p.tintColor} 16%, rgba(251,252,252,.88))`
                : chemical &&
                    dimension === 3 &&
                    p.scientific &&
                    p.anchored &&
                    p.sequenceIndex === undefined &&
                    !p.text.includes('terminus') &&
                    !p.text.includes('′')
                  ? 'transparent'
                  : p.scientific || p.electronPair
                    ? 'rgba(251, 252, 252, .82)'
                    : undefined,
            backdropFilter:
              (dimension === 2 ||
                p.sequenceIndex !== undefined ||
                p.tintColor) &&
              (p.scientific || p.electronPair)
                ? 'blur(3px)'
                : undefined,
            borderRadius: p.badgeColor ? '50%' : 3,
            width: p.badgeColor ? 36 : undefined,
            height: p.badgeColor ? 36 : undefined,
            boxSizing: 'border-box',
            display: p.badgeColor || p.electronPair ? 'flex' : undefined,
            alignItems: 'center',
            justifyContent: 'center',
            gap: p.electronPair ? 4 : undefined,
            flexDirection: p.electronPair && p.vertical ? 'column' : 'row',
            transform: p.anchored
              ? 'translate(-50%, -50%)'
              : p.alignRight
                ? 'translateX(-100%)'
                : undefined,
            fontFamily: p.scientific
              ? 'Arial, sans-serif'
              : 'var(--font-graph-math)',
            ...(['x', 'y', 'z'].includes(p.text)
              ? {
                  fontStyle: 'italic',
                  fontSize: 16,
                }
              : {}),
          }}
        >
          {p.electronPair ? (
            <>
              {[0, 1].map((dot) => (
                <i
                  key={dot}
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: '50%',
                    background: '#24313f',
                  }}
                />
              ))}
            </>
          ) : p.scientific ? (
            <ScientificLabel text={p.text} />
          ) : (
            p.text
          )}
        </span>
      ))}
      {result?.legend && (
        <div
          className="pointer-events-none absolute bottom-3 right-3 flex flex-wrap gap-3 rounded bg-white/85 px-3 py-2 text-xs text-(--neutral-dark-400)"
          aria-label="Color legend"
        >
          {result.legend.map((entry) => (
            <span key={entry.text} className="flex items-center gap-1.5">
              <i
                style={{
                  background: entry.color,
                  width: 9,
                  height: 9,
                  borderRadius: '50%',
                }}
              />
              {entry.text}
            </span>
          ))}
        </div>
      )}
      {error && (
        <p
          role="alert"
          className="absolute left-4 top-16 rounded-xl bg-white p-4 text-sm"
        >
          {error}
        </p>
      )}
    </div>
  );
}
