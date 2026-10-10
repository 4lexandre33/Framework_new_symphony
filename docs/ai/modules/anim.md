# anim — Pipeline de Animações & State Machines
capability: game.anim@1.0.0 | category: functional | engine plugin id: game.anim
dependsOn: game.loop
use (from src/projects/<jogo>/**):
  import { AnimationToken } from "../../tokens/anim";
  // acesso: const api = ctx.caps.require(Token)  (declare o token em capabilities.consumes + permissions.capabilities)

## token src/tokens/anim.ts
```ts
interface AnimationApi {
  registerState( entityId: string, config: AnimationClipConfig, ): boolean;
  addTransition( entityId: string, transition: AnimationTransition, ): boolean;
  playAnimation( entityId: string, stateName: string, fadeDurationSeconds?: number, ): boolean;
  crossFade( entityId: string, fromState: string, toState: string, durationSeconds: number, ): boolean;
  setParam( entityId: string, paramName: string, value: AnimationParamValue, ): void;
  getParam( entityId: string, paramName: string, ): AnimationParamValue | undefined;
  register3DSkeleton( entityId: string, rootObject: Object3D, animations: ReadonlyArray<AnimationClip>, ): void;
  register2DSprite( entityId: string, material: unknown, frames: ReadonlyArray<SpriteAnimationFrame>, ): void;
  unregisterEntity( entityId: string, ): void;
  getCurrentState( entityId: string, ): string | null;
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
  readonly durationSeconds: number;
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
event AnimationTriggeredEvent = "game.anim.event-triggered" payload AnimationEventTriggerPayload
interface PlayAnimationRequest {
  readonly entityId: string;
  readonly stateName: string;
  readonly fadeDurationSeconds?: number;
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
