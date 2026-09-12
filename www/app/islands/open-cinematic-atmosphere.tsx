/**
 * A progressive-enhancement atmosphere layer for the WWW hero.
 *
 * Content never depends on this island: it draws a small WebGL violet field
 * when the browser and motion preference allow it, and otherwise leaves the
 * CSS backdrop intact.
 */

import { element, OpenElement } from '@openelement/element';
import { compiledStyle } from '../site-ui/compiled-style.ts';
import { readIslandState } from '../site-ui/island-state.ts';
import { defineIslandConfig } from '@openelement/app';

interface AtmosphereState {
  frame: number;
  contextLost: boolean;
  observer: ResizeObserver | null;
  canvas: HTMLCanvasElement | null;
  onContextLost: ((event: Event) => void) | null;
}

export const openElement = defineIslandConfig({ hydrate: 'idle', ssr: true, dsd: true });

@element('open-cinematic-atmosphere')
export default class CinematicAtmosphere extends OpenElement {
  static override styles = [compiledStyle(`
  :host { position: absolute; inset: 0; display: block; overflow: hidden; pointer-events: none; }
  canvas { width: 100%; height: 100%; display: block; opacity: .82; }
  @media (prefers-reduced-motion: reduce) { canvas { display: none; } }
`)];
  override connectedCallback(): void {
    super.connectedCallback();
    if (globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    requestAnimationFrame(() => this.startAtmosphere());
  }

  override disconnectedCallback(): void {
    const state = readIslandState<AtmosphereState>(this, 'atmosphere', () => ({
      frame: 0,
      contextLost: false,
      observer: null,
      canvas: null,
      onContextLost: null,
    }));
    cancelAnimationFrame(state.frame);
    state.observer?.disconnect();
    state.observer = null;
    if (state.canvas && state.onContextLost) {
      state.canvas.removeEventListener('webglcontextlost', state.onContextLost);
    }
    state.canvas = null;
    state.onContextLost = null;
    super.disconnectedCallback();
  }

  startAtmosphere(): void {
    const state = readIslandState<AtmosphereState>(this, 'atmosphere', () => ({
      frame: 0,
      contextLost: false,
      observer: null,
      canvas: null,
      onContextLost: null,
    }));
    const canvas = this.shadowRoot?.querySelector('canvas');
    if (!(canvas instanceof HTMLCanvasElement) || state.contextLost) return;
    const gl = canvas.getContext('webgl', {
      alpha: true,
      antialias: false,
      powerPreference: 'low-power',
    });
    if (!gl) return;
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type);
      if (!shader) return null;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
    };
    const vertex = compile(
      gl.VERTEX_SHADER,
      'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}',
    );
    const fragment = compile(
      gl.FRAGMENT_SHADER,
      `
      precision mediump float;uniform vec2 r;uniform vec2 m;uniform float t;
      float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      void main(){vec2 uv=(gl_FragCoord.xy*2.-r)/min(r.x,r.y);uv-=m*.09;
        float d=length(uv);float glow=.12/(.08+abs(d-.54+sin(t*.22)*.025));
        vec2 cell=floor((uv+2.)*18.);float seed=hash(cell);float phase=hash(cell+19.7)*6.2831;
        float twinkle=.78+.22*sin(t*.34+phase);
        float stars=step(.965,seed)*smoothstep(1.5,.1,d)*twinkle;
        vec3 violet=vec3(.37,.15,.78)*glow+vec3(.72,.55,1.)*stars*.8;
        gl_FragColor=vec4(violet,min(.72,glow*.22+stars*.55));}
    `,
    );
    if (!vertex || !fragment) return;
    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'p');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const resolution = gl.getUniformLocation(program, 'r');
    const pointer = gl.getUniformLocation(program, 'm');
    const time = gl.getUniformLocation(program, 't');
    const resize = () => {
      const scale = Math.min(devicePixelRatio || 1, 1.5);
      canvas.width = Math.max(1, Math.floor(canvas.clientWidth * scale));
      canvas.height = Math.max(1, Math.floor(canvas.clientHeight * scale));
      gl.viewport(0, 0, canvas.width, canvas.height);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    state.observer = observer;
    state.canvas = canvas;
    state.onContextLost = (event: Event) => {
      event.preventDefault();
      state.contextLost = true;
      cancelAnimationFrame(state.frame);
      observer.disconnect();
    };
    canvas.addEventListener('webglcontextlost', state.onContextLost, { once: true });

    const started = performance.now();
    const render = (now: number) => {
      if (state.contextLost || !this.isConnected) return;
      const t = (now - started) / 1000;
      const style = getComputedStyle(this);
      gl.uniform2f(resolution, canvas.width, canvas.height);
      gl.uniform2f(
        pointer,
        Number(style.getPropertyValue('--pointer-x')) || 0,
        Number(style.getPropertyValue('--pointer-y')) || 0,
      );
      gl.uniform1f(time, t);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      state.frame = requestAnimationFrame(render);
    };
    state.frame = requestAnimationFrame(render);
  }

  render() {
    return <canvas aria-hidden='true'></canvas>;
  }
}
