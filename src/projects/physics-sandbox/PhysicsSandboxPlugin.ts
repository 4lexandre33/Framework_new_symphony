import type {
  Plugin,
  PluginContext,
} from "@core";

import {
  CollisionEnterEvent,
} from "../../contracts/physics/types";

import type {
  CollisionEventPayload,
} from "../../contracts/physics/types";

import {
  RenderToken,
} from "../../tokens/render";

import {
  PhysicsToken,
} from "../../tokens/physics";

import {
  CameraToken,
} from "../../tokens/camera";

import {
  AudioToken,
} from "../../tokens/audio";

import {
  AssetsToken,
} from "../../tokens/assets";

import {
  PhysicsSandboxGame,
} from "./PhysicsSandboxGame";

import {
  ThreeSandboxView,
} from "./adapters/ThreeSandboxView";

import {
  OrbitCameraInput,
} from "./adapters/OrbitCameraInput";

import {
  EngineSandboxAudio,
} from "./adapters/EngineSandboxAudio";

/**
 * Plugin do PROJETO CONSUMIDOR.
 *
 * É um composition adapter entre o projeto e as capabilities
 * públicas fornecidas pela engine.
 *
 * Não implementa infraestrutura da engine.
 */
export function createPhysicsSandboxPlugin():
  Plugin {
  let view:
    ThreeSandboxView |
    null =
      null;

  let game:
    PhysicsSandboxGame |
    null =
      null;

  let input:
    OrbitCameraInput |
    null =
      null;

  let audio:
    EngineSandboxAudio |
    null =
      null;

  const release =
    (): void => {
      input?.dispose();
      input =
        null;

      if (
        game !==
        null
      ) {
        game.dispose();

        game =
          null;

        audio =
          null;

        view =
          null;

        return;
      }

      audio?.dispose();
      audio =
        null;

      view?.dispose();
      view =
        null;
    };

  return {
    manifest: {
      id:
        "example.physics-sandbox",

      name:
        "Example Project — Physics Sandbox",

      version:
        "1.0.0",

      kind:
        "preloaded",

      authority:
        "game",

      dependsOn: [
        {
          id:
            "game.loop",

          range:
            "^1.0.0",
        },
        {
          id:
            "game.render",

          range:
            "^1.0.0",
        },
        {
          id:
            "game.physics",

          range:
            "^1.0.0",
        },
        {
          id:
            "game.camera",

          range:
            "^1.0.0",
        },
        {
          id:
            "game.assets",

          range:
            "^1.0.0",
        },
        {
          id:
            "game.audio",

          range:
            "^1.0.0",
        },
      ],

      permissions: {
        capabilities: [
          RenderToken.id,
          PhysicsToken.id,
          CameraToken.id,
          AssetsToken.id,
          AudioToken.id,
        ],

        events: [
          "game.loop.tick",
          CollisionEnterEvent.type,
        ],
      },

      capabilities: {
        consumes: [
          {
            id:
              RenderToken.id,

            range:
              "^1.0.0",

            optional:
              false,
          },
          {
            id:
              PhysicsToken.id,

            range:
              "^1.0.0",

            optional:
              false,
          },
          {
            id:
              CameraToken.id,

            range:
              "^1.0.0",

            optional:
              false,
          },
          {
            id:
              AssetsToken.id,

            range:
              "^1.0.0",

            optional:
              false,
          },
          {
            id:
              AudioToken.id,

            range:
              "^1.0.0",

            optional:
              false,
          },
        ],

        conflicts:
          [],
      },

      lifecycleHooks: {
        async onBoot(
          ctx:
            PluginContext,
        ): Promise<void> {
          try {
            const render =
              ctx.caps.require(
                RenderToken,
              );

            const physics =
              ctx.caps.require(
                PhysicsToken,
              );

            const camera =
              ctx.caps.require(
                CameraToken,
              );

            const assets =
              ctx.caps.require(
                AssetsToken,
              );

            const audioApi =
              ctx.caps.require(
                AudioToken,
              );

            view =
              new ThreeSandboxView(
                render,
              );

            audio =
              new EngineSandboxAudio(
                assets,
                audioApi,
              );

            await audio
              .initialize();

            game =
              new PhysicsSandboxGame(
                physics,
                view,
                audio,
              );

            input =
              new OrbitCameraInput(
                camera,
                window,
                (): void => {
                  game?.jump();
                },
              );

            input.start();

            console.info(
              "[PhysicsSandbox] Exemplo iniciado com física, câmera orbital e áudio.",
            );
          } catch (
            error:
              unknown
          ) {
            release();

            throw error;
          }
        },
      },
    },

    setup(
      ctx:
        PluginContext,
    ): void {
      /**
       * game.physics já executa physics.stepForGameLoop
       * no fixed tick.
       *
       * Aqui apenas sincronizamos a apresentação.
       */
      const unsubscribeTick =
        ctx.events.on(
          "game.loop.tick",
          (): void => {
            game?.syncVisual();
          },
        );

      /**
       * O projeto consome o evento público da física.
       *
       * Nenhum acesso ao Rapier interno é necessário.
       */
      const unsubscribeCollision =
        ctx.events.on<
          "game.physics.collision-enter",
          CollisionEventPayload
        >(
          CollisionEnterEvent.type,
          (
            event,
          ): void => {
            game
              ?.handleCollisionEnter(
                event.payload
                  .entityIdA,

                event.payload
                  .entityIdB,
              );
          },
        );

      ctx.lifecycle.onDispose(
        (): void => {
          unsubscribeCollision();
          unsubscribeTick();

          release();
        },
      );

      ctx.lifecycle.ready();
    },
  };
}
