import * as THREE from "three";

import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { SSAOPass } from "three/examples/jsm/postprocessing/SSAOPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";

import type { RenderFrameRenderer } from "../../../tokens/render";

import type { PostProcessingPipeline } from "./PostProcessingPipeline";

/** Provedor da textura LUT (2D em tira N·N × N) já carregada, ou null. */
export type LutTextureProvider = () => THREE.Texture | null;

const FULLSCREEN_VERTEX = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/** Color grading por LUT 2D em tira (vermelho em x da fatia, verde em y, azul = fatia). */
export const COLOR_GRADING_SHADER = {
  name: "EngineColorGradingShader",
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    tLut: { value: null as THREE.Texture | null },
    uLutSize: { value: 16 },
    uIntensity: { value: 1 },
  },
  vertexShader: FULLSCREEN_VERTEX,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform sampler2D tLut;
    uniform float uLutSize;
    uniform float uIntensity;
    varying vec2 vUv;

    vec3 lookupLut(vec3 color) {
      float n = uLutSize;
      vec3 c = clamp(color, 0.0, 1.0);
      float blue = c.b * (n - 1.0);
      float slice0 = floor(blue);
      float slice1 = min(slice0 + 1.0, n - 1.0);
      float f = blue - slice0;
      float x = c.r * (n - 1.0) + 0.5;
      float y = (c.g * (n - 1.0) + 0.5) / n;
      vec2 uv0 = vec2((slice0 * n + x) / (n * n), y);
      vec2 uv1 = vec2((slice1 * n + x) / (n * n), y);
      return mix(texture2D(tLut, uv0).rgb, texture2D(tLut, uv1).rgb, f);
    }

    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      vec3 graded = lookupLut(color.rgb);
      gl_FragColor = vec4(mix(color.rgb, graded, uIntensity), color.a);
    }
  `,
};

/** Vinheta + aberração cromática (deslocamento radial dos canais R/B). */
export const VIGNETTE_ABERRATION_SHADER = {
  name: "EngineVignetteAberrationShader",
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uVignette: { value: 0 },
    uAberration: { value: 0 },
  },
  vertexShader: FULLSCREEN_VERTEX,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uVignette;
    uniform float uAberration;
    varying vec2 vUv;

    void main() {
      vec2 dir = vUv - vec2(0.5);
      vec4 base = texture2D(tDiffuse, vUv);
      vec3 color = base.rgb;

      if (uAberration > 0.0) {
        color.r = texture2D(tDiffuse, vUv + dir * uAberration).r;
        color.b = texture2D(tDiffuse, vUv - dir * uAberration).b;
      }

      // 0 no centro, 1 nos cantos.
      float d = clamp(length(dir) * 1.41421356, 0.0, 1.0);
      float vignette = 1.0 - uVignette * d * d;

      gl_FragColor = vec4(color * vignette, base.a);
    }
  `,
};

export type PostFXPassName =
  | "render"
  | "ssao"
  | "bloom"
  | "output"
  | "color-grading"
  | "vignette";

/**
 * Pipeline de pós-processamento real (G9) sobre o EffectComposer do three.
 * Implementa `RenderFrameRenderer` para ser instalado no `game.render`.
 *
 * Os passes são criados uma vez (SSAO sob demanda) e ligados/desligados
 * por frame conforme a configuração; nada é alocado por frame.
 */
export class PostFXComposer implements RenderFrameRenderer {
  private composer: EffectComposer | null = null;
  private boundRenderer: THREE.WebGLRenderer | null = null;

  private renderPass: RenderPass | null = null;
  private ssaoPass: SSAOPass | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private outputPass: OutputPass | null = null;
  private gradingPass: ShaderPass | null = null;
  private vignettePass: ShaderPass | null = null;

  private width = 1;
  private height = 1;
  private pixelRatio = 1;
  private disposed = false;

  private readonly placeholderScene = new THREE.Scene();
  private readonly placeholderCamera = new THREE.PerspectiveCamera();

  public constructor(
    private readonly pipeline: PostProcessingPipeline,
    private readonly lutProvider: LutTextureProvider = (): THREE.Texture | null => null,
  ) {}

  public setSize(width: number, height: number, pixelRatio: number): void {
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.pixelRatio = Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1;

    if (this.composer !== null) {
      this.composer.setPixelRatio(this.pixelRatio);
      this.composer.setSize(this.width, this.height);
    }
  }

  public render(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    deltaSeconds: number,
  ): void {
    if (this.disposed) {
      renderer.render(scene, camera);
      return;
    }

    const composer = this.ensureComposer(renderer);
    this.syncPasses(scene, camera);
    composer.render(deltaSeconds);
  }

  /** Nomes dos passes que seriam desenhados agora (para diagnóstico/testes). */
  public getEnabledPassNames(): PostFXPassName[] {
    const names: PostFXPassName[] = [];
    const pipeline = this.pipeline;

    names.push("render");
    if (pipeline.isSSAOEffective) names.push("ssao");
    if (pipeline.isBloomEffective) names.push("bloom");
    names.push("output");
    if (pipeline.isColorGradingRequested && this.lutProvider() !== null) names.push("color-grading");
    if (pipeline.isVignetteEffective || pipeline.isChromaticAberrationEffective) names.push("vignette");

    return names;
  }

  /** Passes efetivamente construídos (após o primeiro render). */
  public getBuiltPassNames(): PostFXPassName[] {
    const names: PostFXPassName[] = [];

    if (this.renderPass?.enabled === true) names.push("render");
    if (this.ssaoPass?.enabled === true) names.push("ssao");
    if (this.bloomPass?.enabled === true) names.push("bloom");
    if (this.outputPass?.enabled === true) names.push("output");
    if (this.gradingPass?.enabled === true) names.push("color-grading");
    if (this.vignettePass?.enabled === true) names.push("vignette");

    return names;
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.releaseGpu();
  }

  private releaseGpu(): void {
    this.renderPass?.dispose();
    this.ssaoPass?.dispose();
    this.bloomPass?.dispose();
    this.outputPass?.dispose();
    this.gradingPass?.dispose();
    this.vignettePass?.dispose();
    // Libera renderTarget1/2 internos do composer.
    this.composer?.dispose();
    this.composer = null;
    this.boundRenderer = null;
    this.renderPass = null;
    this.ssaoPass = null;
    this.bloomPass = null;
    this.outputPass = null;
    this.gradingPass = null;
    this.vignettePass = null;
  }

  private ensureComposer(renderer: THREE.WebGLRenderer): EffectComposer {
    if (this.composer !== null && this.boundRenderer === renderer) {
      return this.composer;
    }

    // Renderer trocado: recria tudo para não misturar contextos.
    if (this.composer !== null) {
      this.releaseGpu();
    }

    const composer = new EffectComposer(renderer);
    composer.setPixelRatio(this.pixelRatio);
    composer.setSize(this.width, this.height);

    const config = this.pipeline.getConfig();

    this.renderPass = new RenderPass(this.placeholderScene, this.placeholderCamera);
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(this.width, this.height),
      config.bloomStrength ?? 0.8,
      config.bloomRadius ?? 0.4,
      config.bloomThreshold ?? 0.85,
    );
    this.outputPass = new OutputPass();
    this.gradingPass = new ShaderPass(COLOR_GRADING_SHADER);
    this.vignettePass = new ShaderPass(VIGNETTE_ABERRATION_SHADER);

    composer.addPass(this.renderPass);
    // Slot do SSAO (criado sob demanda, inserido após o RenderPass).
    composer.addPass(this.bloomPass);
    composer.addPass(this.outputPass);
    composer.addPass(this.gradingPass);
    composer.addPass(this.vignettePass);

    this.composer = composer;
    this.boundRenderer = renderer;
    return composer;
  }

  private ensureSSAOPass(scene: THREE.Scene, camera: THREE.Camera): SSAOPass {
    if (this.ssaoPass !== null) {
      return this.ssaoPass;
    }

    const pass = new SSAOPass(
      scene,
      camera,
      Math.max(1, Math.floor(this.width * this.pixelRatio)),
      Math.max(1, Math.floor(this.height * this.pixelRatio)),
    );

    this.composer?.insertPass(pass, 1);
    this.ssaoPass = pass;
    return pass;
  }

  private syncPasses(scene: THREE.Scene, camera: THREE.Camera): void {
    const pipeline = this.pipeline;
    const config = pipeline.getConfig();

    const renderPass = this.renderPass as RenderPass;
    renderPass.scene = scene;
    renderPass.camera = camera;
    renderPass.enabled = true;

    const ssaoWanted = pipeline.isSSAOEffective;

    if (ssaoWanted) {
      const ssao = this.ensureSSAOPass(scene, camera);
      ssao.scene = scene;
      ssao.camera = camera;
      ssao.kernelRadius = Math.max(0.0001, (config.ssaoRadius ?? 0.5) * 16);
      ssao.enabled = true;
    } else if (this.ssaoPass !== null) {
      this.ssaoPass.enabled = false;
    }

    const bloom = this.bloomPass as UnrealBloomPass;
    bloom.enabled = pipeline.isBloomEffective;
    bloom.strength = config.bloomStrength ?? 0.8;
    bloom.radius = config.bloomRadius ?? 0.4;
    bloom.threshold = config.bloomThreshold ?? 0.85;

    const lut = pipeline.isColorGradingRequested ? this.lutProvider() : null;
    const grading = this.gradingPass as ShaderPass;
    grading.enabled = lut !== null;

    if (lut !== null) {
      const uniforms = grading.material.uniforms;
      const image = lut.image as { height?: number } | null | undefined;
      const size = image?.height;

      (uniforms.tLut as THREE.IUniform).value = lut;
      (uniforms.uLutSize as THREE.IUniform).value =
        size !== undefined && Number.isFinite(size) && size > 1 ? size : 16;
      (uniforms.uIntensity as THREE.IUniform).value = config.colorGradingIntensity ?? 1;
    }

    const vignette = this.vignettePass as ShaderPass;
    const vignetteOn = pipeline.isVignetteEffective;
    const aberrationOn = pipeline.isChromaticAberrationEffective;
    vignette.enabled = vignetteOn || aberrationOn;
    (vignette.material.uniforms.uVignette as THREE.IUniform).value =
      vignetteOn ? config.vignetteIntensity ?? 0 : 0;
    (vignette.material.uniforms.uAberration as THREE.IUniform).value =
      aberrationOn ? config.chromaticAberrationOffset ?? 0 : 0;
  }
}
