import type {
  VersionedSnapshot,
} from "../entities/VersionedSnapshot";

import type {
  SnapshotBundleSnapshot,
} from "../snapshots";

import type {
  SaveGamePort,
  SaveGameRecord,
} from "./SaveGamePort";

/**
 * Estado canônico de save da Camada 2 após a Etapa 63.
 *
 * O bundle contém somente estado runtime serializável. Definições estáticas e
 * contexts de restore permanecem externos ao save state.
 */
export type DomainSaveState =
  SnapshotBundleSnapshot;

/**
 * Envelope externo de save usado pelo contrato legado/estável de
 * SaveGamePort.
 *
 * Existem dois níveis de schema intencionais:
 * - VersionedSnapshot.schemaVersion: versão do formato de save da aplicação;
 * - SnapshotBundleSnapshot.schemaVersion: versão estrutural do bundle runtime.
 */
export type DomainSaveSnapshot =
  VersionedSnapshot<
    DomainSaveState
  >;

export type DomainSaveGameRecord =
  SaveGameRecord<
    DomainSaveState
  >;

/**
 * Especialização canônica; não substitui SaveGamePort<TState>.
 *
 * Consumers antigos continuam livres para usar SaveGamePort com outro TState.
 */
export type DomainSaveGamePort =
  SaveGamePort<
    DomainSaveState
  >;
