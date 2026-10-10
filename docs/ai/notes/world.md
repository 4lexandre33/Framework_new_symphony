## notas verificadas (comportamento)
- `EntityComponentState` é imutável e NÃO há API para mover uma entidade. Para mover: `despawnEntity` + `spawnEntity` com o mesmo id (emite eventos; não faça por tick) ou mantenha no `world` só entidades paradas no seu referencial.
- Os índices espaciais (`querySpatialGrid`, `queryOctree`) são atualizados no tick pela engine.
- `world` é só dado (ECS + consultas): não cria malha nem corpo físico.
- `game.ai` lê `world.getEntityState` em `registerAgent` (posição inicial) e em `setAgentTargetEntity` (posição do alvo no momento da chamada).
