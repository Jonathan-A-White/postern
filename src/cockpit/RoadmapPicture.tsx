// src/cockpit/RoadmapPicture.tsx — the Roadmap's picture (mw-njb33n.6): raw WebGL2, one canvas. Calm and
// battery-safe: it draws when something changed (it opened, resized, or his finger moved it) and never on
// a frame loop, so an idle picture costs nothing. The layout and the gesture arithmetic are
// roadmapPicture.ts's.
import { useEffect, useMemo, useRef } from 'react';
import { navigate } from '../router';
import { beadHref } from '../nav/route';
import { LANES } from '../model/roadmap';
import type { ViewIndex } from '../model/tree';
import {
  LANE_COLOURS,
  clampView,
  css,
  fitView,
  hitTest,
  pictureModel,
  worldToScreen,
  zoomAbout,
  type PictureModel,
  type PictureView,
  type Point,
  type Size,
} from './roadmapPicture';

const VERTEX = `#version 300 es
in vec2 a_centre;
in vec2 a_corner;
in float a_radius;
in vec3 a_colour;
uniform vec2 u_size;
uniform vec3 u_view;
out vec2 v_uv;
out vec3 v_colour;
out float v_px;
void main() {
  vec2 s = (a_centre + a_corner * a_radius) * u_view.x + u_view.yz;
  gl_Position = vec4(s.x / u_size.x * 2.0 - 1.0, 1.0 - s.y / u_size.y * 2.0, 0.0, 1.0);
  v_uv = a_corner;
  v_colour = a_colour;
  v_px = a_radius * u_view.x;
}`;

const FRAGMENT = `#version 300 es
precision mediump float;
in vec2 v_uv;
in vec3 v_colour;
in float v_px;
uniform float u_halo;
out vec4 o;
void main() {
  float d = length(v_uv);
  float aa = 1.5 / max(v_px, 1.0);
  float edge = 1.0 - smoothstep(1.0 - aa, 1.0, d);
  float a;
  if (u_halo > 0.5) {
    float ring = smoothstep(1.0 - 3.0 * aa, 1.0 - 2.0 * aa, d) * edge;
    a = 0.08 * edge + 0.35 * ring;
  } else {
    a = 0.92 * edge;
  }
  o = vec4(v_colour * a, a);
}`;

const HALO_COLOUR = [0.62, 0.67, 0.76];
/** centre (2), corner (2), radius (1), colour (3). */
const FLOATS = 8;
const CORNERS = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, -1],
  [1, 1],
  [-1, 1],
];

interface Renderer {
  setModel: (model: PictureModel) => void;
  draw: (view: PictureView, size: Size, dpr: number) => void;
  dispose: () => void;
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('no shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error('shader did not compile');
  return shader;
}

/** The picture's GL: null when this phone has no WebGL2 or its program will not build. */
function createRenderer(canvas: HTMLCanvasElement): Renderer | null {
  let gl: WebGL2RenderingContext | null = null;
  try {
    gl = canvas.getContext('webgl2', { antialias: false, premultipliedAlpha: true, alpha: true }) as WebGL2RenderingContext | null;
  } catch {
    return null;
  }
  if (!gl) return null;
  const g = gl;
  try {
    const program = g.createProgram();
    if (!program) return null;
    g.attachShader(program, compile(g, g.VERTEX_SHADER, VERTEX));
    g.attachShader(program, compile(g, g.FRAGMENT_SHADER, FRAGMENT));
    g.linkProgram(program);
    if (!g.getProgramParameter(program, g.LINK_STATUS)) return null;
    g.useProgram(program);

    const vao = g.createVertexArray();
    const buffer = g.createBuffer();
    g.bindVertexArray(vao);
    g.bindBuffer(g.ARRAY_BUFFER, buffer);
    const stride = FLOATS * 4;
    const attribute = (name: string, size: number, offset: number) => {
      const at = g.getAttribLocation(program, name);
      g.enableVertexAttribArray(at);
      g.vertexAttribPointer(at, size, g.FLOAT, false, stride, offset * 4);
    };
    attribute('a_centre', 2, 0);
    attribute('a_corner', 2, 2);
    attribute('a_radius', 1, 4);
    attribute('a_colour', 3, 5);
    const uSize = g.getUniformLocation(program, 'u_size');
    const uView = g.getUniformLocation(program, 'u_view');
    const uHalo = g.getUniformLocation(program, 'u_halo');
    g.enable(g.BLEND);
    g.blendFunc(g.ONE, g.ONE_MINUS_SRC_ALPHA);

    let haloVertices = 0;
    let nodeVertices = 0;
    const quad = (out: number[], x: number, y: number, r: number, colour: readonly number[]) => {
      for (const [cx, cy] of CORNERS) out.push(x, y, cx, cy, r, colour[0], colour[1], colour[2]);
    };

    return {
      setModel(model) {
        const data: number[] = [];
        for (const c of model.clusters) quad(data, c.x, c.y, c.r, HALO_COLOUR);
        haloVertices = model.clusters.length * 6;
        for (const n of model.nodes) quad(data, n.x, n.y, n.r, n.colour);
        nodeVertices = model.nodes.length * 6;
        g.bindBuffer(g.ARRAY_BUFFER, buffer);
        g.bufferData(g.ARRAY_BUFFER, new Float32Array(data), g.STATIC_DRAW);
      },
      draw(view, size, dpr) {
        const w = Math.max(1, Math.round(size.width * dpr));
        const h = Math.max(1, Math.round(size.height * dpr));
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
        }
        g.viewport(0, 0, w, h);
        g.clearColor(0, 0, 0, 0);
        g.clear(g.COLOR_BUFFER_BIT);
        g.uniform2f(uSize, size.width, size.height);
        g.uniform3f(uView, view.scale, view.x, view.y);
        g.uniform1f(uHalo, 1);
        g.drawArrays(g.TRIANGLES, 0, haloVertices);
        g.uniform1f(uHalo, 0);
        g.drawArrays(g.TRIANGLES, haloVertices, nodeVertices);
      },
      dispose() {
        g.deleteBuffer(buffer);
        g.deleteVertexArray(vao);
        g.deleteProgram(program);
      },
    };
  } catch {
    return null;
  }
}

/** Inside this many px a touch is a tap, not a drag. */
const TAP_SLOP = 8;
/** A node's circle is at least this wide on screen before its count shows, and this wide before its title. */
const COUNT_AT = 12;
const TITLE_AT = 26;

const FALLBACK_SIZE: Size = { width: 320, height: 480 };

export function RoadmapPicture({ index, onUnavailable }: { index: ViewIndex; onUnavailable: () => void }) {
  const model = useMemo(() => pictureModel(index), [index]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const modelRef = useRef(model);
  const viewRef = useRef<PictureView | null>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const redraw = useRef<() => void>(() => undefined);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = createRenderer(canvas);
    if (!renderer) {
      onUnavailable();
      return;
    }
    rendererRef.current = renderer;
    let fitted = true;

    const sizeNow = (): Size => ({ width: canvas.clientWidth || FALLBACK_SIZE.width, height: canvas.clientHeight || FALLBACK_SIZE.height });

    const draw = () => {
      const size = sizeNow();
      const m = modelRef.current;
      const view = (viewRef.current = fitted || !viewRef.current ? fitView(m, size) : clampView(viewRef.current, m, size));
      renderer.draw(view, size, Math.min(window.devicePixelRatio || 1, 2));
      // The labels follow the picture; they are moved here, not through React.
      const box = labelsRef.current;
      if (!box) return;
      for (const el of Array.from(box.querySelectorAll<HTMLElement>('[data-node]'))) {
        const node = m.nodes.find((n) => n.id === el.dataset.node);
        if (!node) continue;
        const p = worldToScreen(view, node);
        const px = node.r * view.scale;
        el.style.display = px >= COUNT_AT ? '' : 'none';
        el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -50%)`;
        el.style.maxWidth = `${Math.max(0, px * 1.7)}px`;
        const title = el.querySelector<HTMLElement>('[data-title]');
        if (title) title.style.display = px >= TITLE_AT ? '' : 'none';
      }
      for (const el of Array.from(box.querySelectorAll<HTMLElement>('[data-cluster]'))) {
        const cluster = m.clusters.find((c) => c.app === el.dataset.cluster);
        if (!cluster) continue;
        const p = worldToScreen(view, { x: cluster.x, y: cluster.y - cluster.r });
        el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -100%)`;
      }
    };
    redraw.current = draw;
    renderer.setModel(modelRef.current);
    draw();

    const moved = (next: PictureView) => {
      fitted = false;
      viewRef.current = next;
      draw();
    };

    // One finger pans, two pinch; a touch that never moved is a tap on whatever node is under it.
    const down = new Map<number, Point>();
    let start: Point | null = null;
    let travelled = 0;
    let pinched = false;
    let pinchFrom: { distance: number; scale: number } | null = null;
    const local = (e: PointerEvent): Point => {
      const box = canvas.getBoundingClientRect();
      return { x: e.clientX - box.left, y: e.clientY - box.top };
    };
    const gap = () => {
      const [a, b] = [...down.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };
    const centre = () => {
      const [a, b] = [...down.values()];
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    };

    const onDown = (e: PointerEvent) => {
      canvas.setPointerCapture?.(e.pointerId);
      down.set(e.pointerId, local(e));
      if (down.size === 1) {
        start = local(e);
        travelled = 0;
        pinched = false;
      } else if (down.size === 2) {
        pinched = true;
        pinchFrom = { distance: gap(), scale: (viewRef.current ?? fitView(modelRef.current, sizeNow())).scale };
      }
    };
    const onMove = (e: PointerEvent) => {
      const before = down.get(e.pointerId);
      if (!before) return;
      const at = local(e);
      const view = viewRef.current ?? fitView(modelRef.current, sizeNow());
      const m = modelRef.current;
      const size = sizeNow();
      if (down.size === 1) {
        travelled = Math.max(travelled, Math.hypot(at.x - (start?.x ?? at.x), at.y - (start?.y ?? at.y)));
        down.set(e.pointerId, at);
        if (travelled >= TAP_SLOP) moved(clampView({ ...view, x: view.x + at.x - before.x, y: view.y + at.y - before.y }, m, size));
      } else if (down.size === 2 && pinchFrom && pinchFrom.distance > 0) {
        const lastCentre = centre();
        down.set(e.pointerId, at);
        const now = centre();
        const factor = (pinchFrom.scale * (gap() / pinchFrom.distance)) / view.scale;
        const panned = { ...view, x: view.x + now.x - lastCentre.x, y: view.y + now.y - lastCentre.y };
        moved(zoomAbout(panned, factor, now, m, size));
      } else {
        down.set(e.pointerId, at);
      }
    };
    const onUp = (e: PointerEvent) => {
      const was = down.has(e.pointerId);
      down.delete(e.pointerId);
      if (down.size < 2) pinchFrom = null;
      if (!was || down.size > 0 || pinched || travelled >= TAP_SLOP || e.type === 'pointercancel') return;
      const hit = hitTest(modelRef.current, viewRef.current ?? fitView(modelRef.current, sizeNow()), local(e));
      if (hit) navigate(beadHref(hit.id));
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const box = canvas.getBoundingClientRect();
      const view = viewRef.current ?? fitView(modelRef.current, sizeNow());
      moved(zoomAbout(view, Math.exp(-e.deltaY * 0.002), { x: e.clientX - box.left, y: e.clientY - box.top }, modelRef.current, sizeNow()));
    };
    const onLost = (e: Event) => {
      e.preventDefault();
      onUnavailable();
    };

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('webglcontextlost', onLost);
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(draw);
    resize?.observe(canvas);

    return () => {
      resize?.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('webglcontextlost', onLost);
      redraw.current = () => undefined;
      rendererRef.current = null;
      renderer.dispose();
    };
  }, [onUnavailable]);

  // A fresher view of the factory: the same pan and zoom, new circles.
  useEffect(() => {
    modelRef.current = model;
    rendererRef.current?.setModel(model);
    redraw.current();
  }, [model]);

  return (
    <div className="flex flex-col gap-3" data-testid="roadmap-picture">
      <div className="relative h-[min(68vh,560px)] overflow-hidden rounded-2xl border border-line bg-surface">
        <canvas
          ref={canvasRef}
          role="img"
          aria-label="The roadmap as a picture: each app a ring, each epic a dot sized by its open stories and coloured by lane. Drag to move, pinch to zoom, tap a dot to open it."
          className="block h-full w-full"
          style={{ touchAction: 'none' }}
        />
        <div ref={labelsRef} className="pointer-events-none absolute inset-0 overflow-hidden text-[11px] leading-tight" aria-hidden="true">
          {model.clusters.map((c) => (
            <div key={c.app} data-cluster={c.app} className="absolute left-0 top-0 whitespace-nowrap px-1 pb-0.5 text-[12px] font-semibold text-muted">
              {c.app}
            </div>
          ))}
          {model.nodes.map((n) => (
            <div key={n.id} data-node={n.id} className="absolute left-0 top-0 flex flex-col items-center text-center font-medium text-black/80">
              <span className="font-semibold tabular-nums">{n.open}</span>
              <span data-title className="line-clamp-2 wrap-anywhere">
                {n.title}
              </span>
            </div>
          ))}
        </div>
        {model.nodes.length === 0 && (
          <p className="absolute inset-0 flex items-center justify-center px-6 text-center text-[13px] text-muted">No epics with open stories</p>
        )}
      </div>
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[12.5px] text-muted" aria-label="Lane colours">
        {LANES.map((lane) => (
          <li key={lane.id} className="flex items-center gap-1.5">
            <span className="inline-block size-3 rounded-full" style={{ backgroundColor: css(LANE_COLOURS[lane.id]) }} aria-hidden="true" />
            {lane.label}
          </li>
        ))}
      </ul>
      <p className="px-1 text-[12.5px] text-faint">Drag to move, pinch to zoom, tap a dot to open its epic.</p>
      <ul className="sr-only" aria-label="Epics in the picture">
        {model.nodes.map((n) => (
          <li key={n.id}>
            <a href={beadHref(n.id)}>{`${n.app}: ${n.title}, ${n.open} open, ${n.lane}`}</a>
          </li>
        ))}
      </ul>
    </div>
  );
}
