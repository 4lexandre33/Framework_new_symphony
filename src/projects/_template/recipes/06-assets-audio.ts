// Assets têm contagem de referências: todo load precisa de release.
import type { AssetsApi } from "../../../tokens/assets";
import type { AudioApi } from "../../../tokens/audio";

export async function loadAndPlay(assets: AssetsApi, audio: AudioApi): Promise<() => void> {
  const url = "/projects/meu-jogo/audio/hit.wav"; // arquivo físico em public/projects/meu-jogo/audio/hit.wav
  await assets.loadAudio(url);
  audio.playSound(url, "sfx", 0.8);
  audio.setChannelVolume("bgm", 0.5);
  return (): void => {
    audio.stopAllSounds();
    assets.releaseAsset(url);
  };
}
// Modelos: await assets.loadGLTF(url) → cena Three; texturas: assets.loadTexture(url).
