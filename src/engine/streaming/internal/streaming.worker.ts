import type {
  StreamingJobRequest,
  StreamingJobResponse,
} from "./StreamingWorkerPool";

const SECTOR_SIZE_WORLD_UNITS =
  50;

self.onmessage =
  (
    event:
      MessageEvent<
        StreamingJobRequest
      >,
  ): void => {
    const {
      jobId,
      cameraPosition,
      sectorCoords,
      maxDistance,
    } =
      event.data;

    const maxDistanceSquared =
      maxDistance *
      maxDistance;

    const visibleSectors =
      [];

    for (
      let index =
        0;
      index <
      sectorCoords.length;
      index +=
        1
    ) {
      const sector =
        sectorCoords[
          index
        ];

      if (
        sector ===
        undefined
      ) {
        continue;
      }

      const centerX =
        sector.x *
        SECTOR_SIZE_WORLD_UNITS;

      const centerY =
        sector.y *
        SECTOR_SIZE_WORLD_UNITS;

      const centerZ =
        sector.z *
        SECTOR_SIZE_WORLD_UNITS;

      const dx =
        cameraPosition.x -
        centerX;

      const dy =
        cameraPosition.y -
        centerY;

      const dz =
        cameraPosition.z -
        centerZ;

      const distanceSquared =
        dx *
          dx +
        dy *
          dy +
        dz *
          dz;

      if (
        distanceSquared <=
        maxDistanceSquared
      ) {
        visibleSectors.push(
          sector,
        );
      }
    }

    const response:
      StreamingJobResponse = {
        jobId,
        visibleSectors,
      };

    self.postMessage(
      response,
    );
  };
