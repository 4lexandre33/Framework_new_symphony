import { defineEvent, defineCommand } from "@core";

export type CameraMode = "perspective" | "orthographic" | "follow";

export interface Vector3D {
  x: number;
  y: number;
  z: number;
}

export interface PerspectiveCameraOptions {
  fov: number;
  near: number;
  far: number;
  position: Vector3D;
  target: Vector3D;
}

export interface OrthographicCameraOptions {
  size: number;
  near: number;
  far: number;
  position: Vector3D;
  target: Vector3D;
}

export interface ViewportDimensions {
  width: number;
  height: number;
  aspectRatio: number;
  pixelRatio: number;
}

export interface AmbientLightConfig {
  color: number | string;
  intensity: number;
}

/** Luz direcional da engine. Campos de sombra/alvo opcionais em `DirectionalLightShadowOptions` (G22). */
export interface DirectionalLightConfig extends DirectionalLightShadowOptions {
  color: number | string;
  intensity: number;
  position: Vector3D;
  castShadow: boolean;
}

export interface RenderFramePayload {
  readonly alphaInterpolation: number;
  readonly deltaSeconds: number;
  /** Presentes quando o frame vem do `game.loop.render` (repassados como recebidos). */
  readonly realDeltaSeconds?: number;
  readonly isPaused?: boolean;
}

export const RenderFrameEvent = defineEvent<"game.render.frame", RenderFramePayload>(
  "game.render.frame"
);

export interface ViewportResizePayload {
  readonly width: number;
  readonly height: number;
  readonly aspectRatio: number;
  readonly pixelRatio: number;
}

export const ViewportResizeEvent = defineEvent<"game.render.resize", ViewportResizePayload>(
  "game.render.resize"
);

export interface SetCameraModeRequest {
  readonly mode: CameraMode;
  readonly target?: Vector3D;
}

export const SetCameraModeCommand = defineCommand<"game.render.set-camera-mode", SetCameraModeRequest>(
  "game.render.set-camera-mode"
);

// ── EXTENSÕES ADITIVAS (G22, G40–G44) ───────────────────────────────────────

/**
 * Campos opcionais extras da luz direcional da engine (G22). Todos são
 * aditivos a `DirectionalLightConfig`; omitidos preservam o valor atual.
 */
export interface DirectionalLightShadowOptions {
  /** Ponto para onde a luz aponta. Padrão: origem (0,0,0). */
  readonly target?: Vector3D;
  /** Meia-largura (em unidades de mundo) da caixa ortográfica de sombra. Padrão 15. */
  readonly shadowAreaSize?: number;
  /** Resolução do shadow map (potência de 2 recomendada). Padrão 1024. */
  readonly shadowMapSize?: number;
  readonly shadowNear?: number;
  /** Padrão 50. */
  readonly shadowFar?: number;
  readonly shadowBias?: number;
  readonly shadowNormalBias?: number;
}

export type SceneLightType =
  | "directional"
  | "point"
  | "spot"
  | "hemisphere"
  | "ambient";

/**
 * Luz adicional gerenciada pelo render (`addLight`). A engine é dona do
 * objeto: `removeLight`/dispose liberam o shadow map.
 */
export interface SceneLightConfig {
  readonly type: SceneLightType;
  readonly color?: number | string;
  readonly intensity?: number;
  readonly position?: Vector3D;
  /** directional/spot: alvo da luz. */
  readonly target?: Vector3D;
  /** point/spot: alcance (0 = infinito). */
  readonly distance?: number;
  /** point/spot: decaimento físico (padrão 2). */
  readonly decay?: number;
  /** spot: ângulo do cone em radianos. */
  readonly angle?: number;
  /** spot: suavidade da borda 0..1. */
  readonly penumbra?: number;
  /** hemisphere: cor do chão. */
  readonly groundColor?: number | string;
  readonly castShadow?: boolean;
  /** directional: meia-largura da caixa de sombra. */
  readonly shadowAreaSize?: number;
  readonly shadowMapSize?: number;
}

/** Retângulo normalizado (0..1, origem no canto inferior esquerdo) dentro do canvas. */
export interface ViewportRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Política de dimensionamento do viewport (G43).
 * - `"window"` (padrão): segue `window.innerWidth/innerHeight`.
 * - `"parent"`: segue o tamanho do elemento pai do canvas.
 * - `"none"`: só `resize()` manual altera o tamanho.
 */
export type ViewportAutoResizeMode = "window" | "parent" | "none";

export interface ViewportOptions {
  readonly autoResize?: ViewportAutoResizeMode;
  /** Limite do devicePixelRatio aplicado ao renderer. Padrão 2. */
  readonly maxPixelRatio?: number;
  /** Sub-retângulo do canvas onde a cena é desenhada; null = canvas inteiro. */
  readonly rect?: ViewportRect | null;
}

/** Leitura (objeto NOVO a cada chamada) dos parâmetros das câmeras do render. */
export interface RenderCameraSettings {
  readonly mode: CameraMode;
  readonly perspective: {
    readonly fov: number;
    readonly near: number;
    readonly far: number;
    readonly aspect: number;
  };
  readonly orthographic: {
    /** Meia-altura visível (unidades de mundo). */
    readonly size: number;
    readonly near: number;
    readonly far: number;
    readonly zoom: number;
  };
}

export interface RemoveMeshOptions {
  /**
   * false = só tira o objeto da cena, sem liberar geometria/material/textura
   * (use para objetos cujo recurso é cache compartilhado, ex. GLTF de `assets`).
   * Padrão true.
   */
  readonly disposeResources?: boolean;
}

export interface RenderContextPayload {
  /** true após `webglcontextlost`; false após `webglcontextrestored`. */
  readonly contextLost: boolean;
}

/** Emitido quando o navegador perde o contexto WebGL (o desenho é suspenso). */
export const RenderContextLostEvent = defineEvent<"game.render.context-lost", RenderContextPayload>(
  "game.render.context-lost"
);

/** Emitido quando o contexto WebGL é restaurado (o desenho volta sozinho). */
export const RenderContextRestoredEvent = defineEvent<"game.render.context-restored", RenderContextPayload>(
  "game.render.context-restored"
);
