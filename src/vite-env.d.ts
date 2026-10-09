/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Id do projeto consumidor ativo (ver src/project.ts). Opcional se houver só um. */
  readonly VITE_PROJECT?: string;
}
