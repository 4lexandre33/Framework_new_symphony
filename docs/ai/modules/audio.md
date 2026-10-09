# audio — Mixer de Áudio Espacial 3D
capability: game.audio@1.0.0 | category: functional | engine plugin id: game.audio
consumes: AssetsToken
use (from src/projects/<jogo>/**):
  import { AudioToken } from "../../tokens/audio";
  // acesso: const api = ctx.caps.require(Token)  (declare o token em capabilities.consumes + permissions.capabilities)

## token src/tokens/audio.ts
```ts
interface AudioApi {
  playSound(soundUrl: string, channel?: AudioChannelType, volume?: number, loop?: boolean): void;
  playPositionalSound(soundUrl: string, options: PositionalAudioOptions): void;
  setChannelVolume(channel: AudioChannelType, volume: number, muted?: boolean): void;
  getChannelVolume(channel: AudioChannelType): number;
  isChannelMuted(channel: AudioChannelType): boolean;
  crossfadeMusic(trackUrl: string, options?: MusicCrossfadeOptions): Promise<void>;
  updateListenerPosition(position: Vector3Audio, forward?: Vector3Audio, up?: Vector3Audio): void;
  stopAllSounds(): void;
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
interface PositionalAudioOptions {
  readonly position: Vector3Audio;
  readonly refDistance?: number;
  readonly maxDistance?: number;
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
  readonly loop?: boolean;
  readonly fadeCurve?: "linear" | "exponential";
}
interface AudioChannelVolumeChangedPayload {
  readonly channel: AudioChannelType;
  readonly volume: number;
  readonly muted: boolean;
}
event AudioChannelVolumeChangedEvent = "game.audio.channel-volume-changed" payload AudioChannelVolumeChangedPayload
interface MusicCrossfadeCompletedPayload {
  readonly trackUrl: string;
  readonly durationSeconds: number;
}
event MusicCrossfadeCompletedEvent = "game.audio.crossfade-completed" payload MusicCrossfadeCompletedPayload
interface PositionalSoundTriggeredPayload {
  readonly soundUrl: string;
  readonly position: Vector3Audio;
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
```
## notas verificadas (comportamento)
- Tocar um som que NÃO foi carregado/cacheado apenas emite warn silencioso (não lança). Carregue antes (assets) e só então toque.
- Caminhos de assets do jogo: `/projects/<jogo>/...` (pasta `public/projects/<jogo>/`).

