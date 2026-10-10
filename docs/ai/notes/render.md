## notas verificadas (comportamento)
- A câmera do render é sobrescrita por `game.camera` a cada frame (ver `modules/camera.md`). Use `getScene()`/`addMeshToScene` para conteúdo e `game.camera` para enquadramento.
- Three.js é permitido nos adapters do jogo: crie geometrias/materiais e adicione com `addMeshToScene(chaveÚnica, obj)`; no dispose `removeMeshFromScene` + `geometry.dispose()`/`material.dispose()`.
- Voxel: prefira `THREE.InstancedMesh` (um por cor/material) ou geometria mesclada; evite milhares de `Mesh` separados.
- A luz direcional da engine é UMA só e seu alvo fica na origem: longe de (0,0,0) a direção muda e a sombra some. Para mundos grandes, desligue a da engine (`setDirectionalLight({...intensity:0, castShadow:false})`) e adicione a SUA `THREE.DirectionalLight` via `addMeshToScene`, movendo luz e `light.target` junto com o foco da câmera (e adicionando o target também).
