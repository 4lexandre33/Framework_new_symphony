# audio — Mixer de Áudio Espacial 3D
capability: game.audio@1.0.0 | category: functional | engine plugin id: game.audio
consumes: AssetsToken
use (from src/projects/<jogo>/**):
  import { AudioToken } from "../../tokens/audio";
  // acesso: const api = ctx.caps.require(Token)  (declare o token em capabilities.consumes + permissions.capabilities)

## token src/tokens/audio.ts
```ts
interface AudioApi {
  playSound( soundUrl: string, channel?: AudioChannelType, volume?: number, loop?: boolean, options?: PlaySoundOptions, ): SoundHandle; // Toca um som já carregado (assets).
  playPositionalSound(soundUrl: string, options: PositionalAudioOptions): SoundHandle; // Som 3D; `options.channel` escolhe o canal (padrão "sfx").
  stopSound(handle: SoundHandle, fadeSeconds?: number): boolean; // Para um som (com fade opcional).
  setSoundVolume(handle: SoundHandle, volume: number, fadeSeconds?: number): boolean; // Volume (0..1) de um som ativo, com rampa opcional.
  setSoundPosition(handle: SoundHandle, position: Vector3Audio): boolean; // Move um som posicional ativo.
  setSoundOrientation(handle: SoundHandle, direction: Vector3Audio): boolean; // Aponta o cone de um som posicional ativo.
  setSoundPlaybackRate(handle: SoundHandle, rate: number): boolean; // Velocidade/pitch de um som ativo.
  isSoundPlaying(handle: SoundHandle): boolean;
  stopChannel(channel: AudioChannelType, fadeSeconds?: number): void; // Para todos os sons de um canal (não afeta a música; para ela use `stopMusic`).
  setChannelVolume(channel: AudioChannelType, volume: number, muted?: boolean): void; // `muted` omitido mantém o estado de mudo atual (não desmuta).
  setChannelMuted(channel: AudioChannelType, muted: boolean): void;
  getChannelVolume(channel: AudioChannelType): number;
  isChannelMuted(channel: AudioChannelType): boolean;
  crossfadeMusic(trackUrl: string, options?: MusicCrossfadeOptions): Promise<void>; // Troca a música com crossfade.
  stopMusic(fadeSeconds?: number): Promise<void>; // Para só a música (fade opcional).
  getCurrentMusicTrack(): string | null; // URL normalizada da música atual, ou null.
  updateListenerPosition(position: Vector3Audio, forward?: Vector3Audio, up?: Vector3Audio): void;
  stopAllSounds(fadeSeconds?: number): void; // Para sons e música; `fadeSeconds` > 0 faz fade-out em vez de corte seco.
  readonly state: AudioSystemState; // Estado do contexto Web Audio ("unavailable" sem Web Audio).
  resume(): Promise<boolean>; // Tenta desbloquear o áudio (chame dentro de um gesto do usuário).
  readonly activeVoiceCount: number; // Vozes ativas (sem a música).
  setVoiceLimit(maxVoices: number, maxHrtfVoices?: number): void; // Limite de vozes simultâneas (rouba o one-shot mais antigo).
}
capability AudioToken = "game.audio"@1.0.0 api AudioApi
```
## contract src/contracts/audio/types.ts
```ts
export type AudioChannelType = "master" | "bgm" | "sfx" | "voice" | "ui";
export type DistanceModelType = "linear" | "inverse" | "exponential";
interface Vector3Audio {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}
export type SoundHandle = number; // Handle de um som tocando (inteiro > 0).
export type AudioSystemState = "running" | "suspended" | "closed" | "interrupted" | "unavailable"; // Estado do sistema de áudio: "unavailable" = sem Web Audio (a engine segue muda).
interface PlaySoundOptions {
  readonly playbackRate?: number; // Velocidade/pitch (1 = normal).
  readonly fadeInSeconds?: number; // Fade-in em segundos.
}
interface PositionalAudioOptions {
  readonly position: Vector3Audio;
  readonly channel?: AudioChannelType; // Canal do mixer (padrão "sfx").
  readonly orientation?: Vector3Audio; // Direção para onde o cone aponta (padrão Web Audio: +X).
  readonly panningModel?: "HRTF" | "equalpower"; // Modelo de panning.
  readonly playbackRate?: number;
  readonly refDistance?: number;
  readonly maxDistance?: number; // Distância máxima.
  readonly maxDistanceMode?: "silence" | "clamp";
  readonly rolloffFactor?: number;
  readonly distanceModel?: DistanceModelType;
  readonly coneInnerAngle?: number;
  readonly coneOuterAngle?: number;
  readonly coneOuterGain?: number;
  readonly loop?: boolean;
  readonly volume?: number;
}
interface MusicCrossfadeOptions {
  readonly durationSeconds: number;
  readonly restart?: boolean; // Reinicia mesmo se a faixa pedida já estiver tocando (padrão false: no-op).
  readonly loop?: boolean;
  readonly fadeCurve?: "linear" | "exponential";
}
interface AudioChannelVolumeChangedPayload {
  readonly channel: AudioChannelType;
  readonly volume: number;
  readonly muted: boolean;
}
event AudioChannelVolumeChangedEvent = "game.audio.channel-volume-changed" payload AudioChannelVolumeChangedPayload
interface MusicCrossfadeCompletedPayload { // Emitido quando o fade TERMINA (não no início).
  readonly trackUrl: string;
  readonly durationSeconds: number;
}
event MusicCrossfadeCompletedEvent = "game.audio.crossfade-completed" payload MusicCrossfadeCompletedPayload
interface PositionalSoundTriggeredPayload {
  readonly soundUrl: string;
  readonly position: Vector3Audio;
  readonly handle?: SoundHandle;
  readonly channel?: AudioChannelType;
}
event PositionalSoundTriggeredEvent = "game.audio.positional-sound-triggered" payload PositionalSoundTriggeredPayload
interface PlaySoundRequest {
  readonly soundUrl: string;
  readonly channel?: AudioChannelType;
  readonly volume?: number;
  readonly loop?: boolean;
}
command PlaySoundCommand = "game.audio.play-sound" request PlaySoundRequest
interface PlayPositionalSoundRequest {
  readonly soundUrl: string;
  readonly options: PositionalAudioOptions;
}
command PlayPositionalSoundCommand = "game.audio.play-positional-sound" request PlayPositionalSoundRequest
interface SetChannelVolumeRequest {
  readonly channel: AudioChannelType;
  readonly volume: number;
  readonly muted?: boolean;
}
command SetChannelVolumeCommand = "game.audio.set-channel-volume" request SetChannelVolumeRequest
interface CrossfadeMusicRequest {
  readonly trackUrl: string;
  readonly options?: MusicCrossfadeOptions;
}
command CrossfadeMusicCommand = "game.audio.crossfade-music" request CrossfadeMusicRequest
interface StopMusicRequest {
  readonly fadeSeconds?: number;
}
command StopMusicCommand = "game.audio.stop-music" request StopMusicRequest
interface MusicStoppedPayload {
  readonly trackUrl: string | null; // Faixa que parou (null se não havia música).
}
event MusicStoppedEvent = "game.audio.music-stopped" payload MusicStoppedPayload // Emitido quando `stopMusic` conclui (após o fade).
```
## notas verificadas (comportamento)
- Tocar um som que NÃO foi carregado/cacheado apenas emite warn silencioso (não lança). Carregue antes (assets) e só então toque.
- Caminhos de assets do jogo: `/projects/<jogo>/...` (pasta `public/projects/<jogo>/`).
- LACUNA: `playSound`/`playPositionalSound` não devolvem handle: não dá para parar um som específico nem mover um som posicional. Só `stopAllSounds()` e volume por canal. Contorno: prefira one-shots curtos repetidos (ex.: "clac" do trilho a cada N s na posição atual); para um loop ambiente (chuva) reserve um canal (ex.: `voice`) e use `setChannelVolume` para ligar/desligar; música só por `crossfadeMusic`.
- Ouvinte: chame `updateListenerPosition` no `game.loop.render` com a posição da câmera (`camera.getCurrentCameraSnapshot()`).
- `loadAudio` fica PENDENTE até o primeiro gesto do usuário (G80): mostre "clique para começar" antes de carregar sons. `setChannelVolume(c, v)` sem o 3º argumento desmuta (G84). `crossfade-completed` sai no início (G84).
