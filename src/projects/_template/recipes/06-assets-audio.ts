// Assets têm contagem de referências: todo load precisa de release. Sons devolvem handle.
import type { AssetsApi } from "../../../tokens/assets";
import type { AudioApi } from "../../../tokens/audio";

export async function loadAndPlay(assets: AssetsApi, audio: AudioApi): Promise<() => void> {
  const hit = "/projects/meu-jogo/audio/hit.wav"; // arquivo físico em public/projects/meu-jogo/audio/hit.wav
  const rain = "/projects/meu-jogo/audio/rain.wav";
  await Promise.all([assets.loadAudio(hit), assets.loadAudio(rain)]); // não espera gesto; o áudio destrava sozinho no 1º clique/tecla
  audio.playSound(hit, "sfx", 0.8);
  const rainHandle = audio.playSound(rain, "sfx", 0.5, true); // loop controlável pelo handle
  audio.setChannelVolume("bgm", 0.5); // mantém o estado de mudo
  return (): void => {
    audio.stopSound(rainHandle, 0.5); // fade de 0,5 s
    assets.releaseAsset(hit);
    assets.releaseAsset(rain);
  };
}
// Modelos: const gltf = await assets.loadGLTF(url) → gltf.scene é uma instância própria (um releaseAsset por instância).
// JSON: await assets.loadJSON<T>(url). Texturas de dados: assets.loadTexture(url, { colorSpace: "linear" }).
