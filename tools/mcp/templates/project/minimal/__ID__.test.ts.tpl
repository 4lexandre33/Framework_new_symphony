import { describe, expect, it } from "vitest";
import { project } from "./index";
import { __PASCAL__Game } from "./__PASCAL__Game";

describe("__ID__", () => {
  it("exporta o projeto com o plugin do jogo", () => {
    expect(project.id).toBe("__ID__");
    const plugins = project.createPlugins();
    expect(plugins.map((plugin) => plugin.manifest.id)).toEqual(["project.__ID__"]);
  });

  it("acumula tempo a cada tick", () => {
    const game = new __PASCAL__Game();
    game.tick(0.5);
    game.tick(0.25);
    expect(game.elapsed).toBeCloseTo(0.75);
    expect(game.tickCount).toBe(2);
  });

  it("ignora ticks depois do dispose", () => {
    const game = new __PASCAL__Game();
    game.dispose();
    game.tick(1);
    expect(game.tickCount).toBe(0);
    expect(game.isDisposed).toBe(true);
  });
});
