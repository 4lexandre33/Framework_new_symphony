import type { StreamingJobRequest, StreamingJobResponse } from "./StreamingWorkerPool";

self.onmessage = (event: MessageEvent<StreamingJobRequest>) => {
  const { jobId, cameraPosition, sectorCoords, maxDistance } = event.data;

  const visibleSectors = sectorCoords.filter((sec) => {
    // Coordenadas aproximadas de centro do setor no espaço 3D
    const sectorCenterX = sec.x * 50.0;
    const sectorCenterY = sec.y * 50.0;
    const sectorCenterZ = sec.z * 50.0;

    const dx = cameraPosition.x - sectorCenterX;
    const dy = cameraPosition.y - sectorCenterY;
    const dz = cameraPosition.z - sectorCenterZ;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

    return distance <= maxDistance;
  });

  const response: StreamingJobResponse = {
    jobId,
    visibleSectors,
  };

  self.postMessage(response);
};