# anim — Pipeline de Animações & State Machines
capability: game.anim@1.0.0 | category: functional | engine plugin id: game.anim
dependsOn: game.loop
use (from src/projects/<jogo>/**):
  import { AnimationToken } from "../../tokens/anim";
  // acesso: const api = ctx.caps.require(Token)  (declare o token em capabilities.consumes + permissions.capabilities)

## token src/tokens/anim.ts
```ts
interface AnimationApi {
  registerState( entityId: string, config: AnimationClipConfig, ): boolean; // Registra um estado.
  addTransition( entityId: string, transition: AnimationTransition, ): boolean; // Transições podem ser registradas antes dos estados (ficam pendentes).
  playAnimation( entityId: string, stateName: string, fadeDurationSeconds?: number, options?: PlayAnimationOptions, ): boolean; // Toca um estado.
  crossFade( entityId: string, fromState: string, toState: string, durationSeconds: number, ): boolean;
  setParam( entityId: string, paramName: string, value: AnimationParamValue, ): void;
  getParam( entityId: string, paramName: string, ): AnimationParamValue | undefined;
  register3DSkeleton( entityId: string, rootObject: Object3D, animations: ReadonlyArray<AnimationClip>, ): void;
  register2DSprite( entityId: string, material: unknown, frames: ReadonlyArray<SpriteAnimationFrame>, options?: SpriteRegistrationOptions, ): unknown; // Registra o material do sprite e a sequência padrão.
  register2DSpriteState( entityId: string, stateName: string, frames: ReadonlyArray<SpriteAnimationFrame>, ): boolean; // Quadros de um estado da FSM (G77): ao entrar no estado o sprite troca de sequência; o tempo vem da FSM (mesmo…
  unregisterEntity( entityId: string, ): void;
  getCurrentState( entityId: string, ): string | null; // Estado lógico atual.
  getTargetState( entityId: string, ): string | null; // Destino do crossfade em andamento, ou null.
  getStateInfo( entityId: string, ): AnimationStateInfo | null; // Fotografia (objeto novo) do estado da FSM, ou null.
  setClockSource( source: AnimationClockSource, ): void; // Relógio único de FSM + mixer + sprites: "tick" (padrão, determinístico) ou "render" (suave; congela com o jog…
  getClockSource(): AnimationClockSource;
}
capability AnimationToken = "game.anim"@1.0.0 api AnimationApi
```
## contract src/contracts/anim/types.ts
```ts
export type AnimationLoopMode = | "LoopOnce" | "LoopRepeat" | "LoopPingPong";
interface AnimationEventTrigger {
  readonly frameOrTime: number; // Valor normalizado da animação entre 0 e 1.
  readonly eventName: string;
  readonly payload?: Record<string, unknown>;
}
interface AnimationClipConfig {
  readonly id: string; // Nome real do clip dentro do AnimationMixer.
  readonly name: string; // Nome lógico do estado da FSM.
  readonly durationSeconds?: number; // Duração de um ciclo (s).
  readonly loopMode?: AnimationLoopMode;
  readonly timeScale?: number;
  readonly triggers?: ReadonlyArray<AnimationEventTrigger>;
}
interface SpriteAnimationFrame {
  readonly frameIndex: number;
  readonly durationMs: number;
  readonly uvOffset: { readonly x: number; readonly y: number; };
  readonly uvScale: { readonly x: number; readonly y: number; };
}
interface AnimationTransition {
  readonly fromState: string;
  readonly toState: string;
  readonly durationSeconds: number;
  readonly conditionParam?: string;
  readonly conditionOperator?: | ">" | "<" | "==" | "!=" | ">=" | "<=";
  readonly conditionValue?: number | string | boolean;
  readonly exitTime?: number; // Tempo de saída normalizado do estado de origem (0..n).
  readonly hasExitTime?: boolean; // `false` desliga o tempo de saída (transição sem condição volta a disparar imediatamente, no próximo tick).
}
interface PlayAnimationOptions {
  readonly restart?: boolean; // Pedir o estado atual de novo: - `true`: reinicia o clip do começo (golpe repetido, triggers de novo); - `fals…
}
export type AnimationClockSource = | "tick" | "render"; // Relógio que avança FSM, mixer 3D e sprites 2D (sempre o MESMO para os três).
interface SpriteRegistrationOptions {
  readonly cloneTexture?: boolean | "auto"; // Textura por entidade: `true` clona `material.map` para esta entidade; `"auto"` (padrão) clona só se o mesmo `…
  readonly target?: { material: unknown }; // Objeto (Sprite/Mesh) dono do material.
  readonly cloneMaterial?: boolean;
}
interface AnimationStateInfo {
  readonly currentState: string | null;
  readonly targetState: string | null; // Estado de destino durante um crossfade (null se não houver).
  readonly requestedState: string | null; // `targetState ??
  readonly normalizedTime: number;
  readonly elapsedSeconds: number;
  readonly durationSeconds: number;
  readonly isCrossFading: boolean;
  readonly isFinished: boolean; // `LoopOnce` que já chegou ao fim.
}
export type AnimationParamValue = | number | string | boolean;
interface AnimationEventTriggerPayload {
  readonly entityId: string;
  readonly stateName: string;
  readonly eventName: string;
  readonly payload?: Record<string, unknown>;
}
interface AnimationStateChangedPayload {
  readonly entityId: string;
  readonly fromState: string;
  readonly toState: string;
  readonly timestamp: number;
}
event AnimationStateChangedEvent = "game.anim.state-changed" payload AnimationStateChangedPayload
interface AnimationClipFinishedPayload {
  readonly entityId: string;
  readonly stateName: string;
  readonly clipId: string;
  readonly loopMode: AnimationLoopMode;
  readonly completedCycles: number; // Ciclos completos desde a entrada no estado (LoopOnce: sempre 1).
}
event AnimationClipFinishedEvent = "game.anim.clip-finished" payload AnimationClipFinishedPayload // Emitido quando um clip chega ao fim: uma vez em `LoopOnce`; a cada ciclo completo em `LoopRepeat`/`LoopPingPo…
event AnimationTriggeredEvent = "game.anim.event-triggered" payload AnimationEventTriggerPayload
interface PlayAnimationRequest {
  readonly entityId: string;
  readonly stateName: string;
  readonly fadeDurationSeconds?: number;
  readonly restart?: boolean; // Ver `PlayAnimationOptions.restart`.
}
command PlayAnimationCommand = "game.anim.play" request PlayAnimationRequest
interface CrossFadeRequest {
  readonly entityId: string;
  readonly fromState: string;
  readonly toState: string;
  readonly durationSeconds: number;
}
command CrossFadeCommand = "game.anim.cross-fade" request CrossFadeRequest
interface SetAnimParamRequest {
  readonly entityId: string;
  readonly paramName: string;
  readonly value: AnimationParamValue;
}
command SetAnimParamCommand = "game.anim.set-param" request SetAnimParamRequest
```
## notas verificadas (comportamento)
- A engine chama o tick/render da animação. Não chame `update` no jogo.
- Para modelos voxel segmentados: crie `THREE.AnimationClip`s no adapter (tracks `.quaternion`/`.position` de filhos nomeados), passe em `register3DSkeleton(entityId, root, clips)` e registre estados com `registerState` (`config.id` = nome do clip, `config.name` = nome do estado). Inicie com `playAnimation`.
- Transições automáticas por parâmetro: `addTransition({fromState,toState,durationSeconds,conditionParam,conditionOperator,conditionValue})` + `setParam`.
- `unregisterEntity` no dispose.
