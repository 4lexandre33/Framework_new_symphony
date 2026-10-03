import type {
  ChunkDataMatrix,
  CompiledChunkMeshBuffers,
} from "../../contracts/terrain/types";

type AxisVector = [
  number,
  number,
  number,
];

export class GreedyMesher {
  public static compileChunkMesh(
    chunk:
      ChunkDataMatrix,
  ): CompiledChunkMeshBuffers {
    const {
      sizeX,
      sizeY,
      sizeZ,
      blocks,
      coord,
    } =
      chunk;

    const positions:
      number[] = [];

    const normals:
      number[] = [];

    const uvs:
      number[] = [];

    const indices:
      number[] = [];

    if (
      sizeX <=
        0 ||
      sizeY <=
        0 ||
      sizeZ <=
        0 ||
      blocks.length <
        sizeX *
          sizeY *
          sizeZ
    ) {
      return {
        chunkCoord:
          coord,

        positions:
          new Float32Array(),

        normals:
          new Float32Array(),

        uvs:
          new Float32Array(),

        indices:
          new Uint32Array(),
      };
    }

    const dimensions:
      AxisVector = [
        sizeX,
        sizeY,
        sizeZ,
      ];

    const maximumMaskSize =
      Math.max(
        sizeX *
          sizeY,

        sizeY *
          sizeZ,

        sizeX *
          sizeZ,
      );

    const mask =
      new Int32Array(
        maximumMaskSize,
      );

    const position:
      AxisVector = [
        0,
        0,
        0,
      ];

    const neighborOffset:
      AxisVector = [
        0,
        0,
        0,
      ];

    const widthVector:
      AxisVector = [
        0,
        0,
        0,
      ];

    const heightVector:
      AxisVector = [
        0,
        0,
        0,
      ];

    let vertexCounter =
      0;

    const getBlock = (
      x: number,
      y: number,
      z: number,
    ): number => {
      if (
        x <
          0 ||
        x >=
          sizeX ||
        y <
          0 ||
        y >=
          sizeY ||
        z <
          0 ||
        z >=
          sizeZ
      ) {
        return 0;
      }

      const index =
        x +
        sizeX *
          (
            z +
            sizeZ *
              y
          );

      return (
        blocks[
          index
        ] ??
        0
      );
    };

    for (
      let axis = 0;
      axis < 3;
      axis += 1
    ) {
      const horizontalAxis =
        (
          axis +
          1
        ) %
        3;

      const verticalAxis =
        (
          axis +
          2
        ) %
        3;

      neighborOffset[0] =
        0;

      neighborOffset[1] =
        0;

      neighborOffset[2] =
        0;

      neighborOffset[
        axis
      ] =
        1;

      position[0] =
        0;

      position[1] =
        0;

      position[2] =
        0;

      for (
        position[
          axis
        ] = -1;
        position[
          axis
        ] <
        dimensions[
          axis
        ];
      ) {
        let maskIndex =
          0;

        for (
          position[
            verticalAxis
          ] = 0;
          position[
            verticalAxis
          ] <
          dimensions[
            verticalAxis
          ];
          position[
            verticalAxis
          ] += 1
        ) {
          for (
            position[
              horizontalAxis
            ] = 0;
            position[
              horizontalAxis
            ] <
            dimensions[
              horizontalAxis
            ];
            position[
              horizontalAxis
            ] += 1
          ) {
            const currentBlock =
              position[
                axis
              ] >=
              0
                ? getBlock(
                    position[
                      0
                    ],

                    position[
                      1
                    ],

                    position[
                      2
                    ],
                  )
                : 0;

            const adjacentBlock =
              position[
                axis
              ] <
              dimensions[
                axis
              ] -
                1
                ? getBlock(
                    position[
                      0
                    ] +
                      neighborOffset[
                        0
                      ],

                    position[
                      1
                    ] +
                      neighborOffset[
                        1
                      ],

                    position[
                      2
                    ] +
                      neighborOffset[
                        2
                      ],
                  )
                : 0;

            if (
              currentBlock !==
                0 &&
              adjacentBlock ===
                0
            ) {
              mask[
                maskIndex
              ] =
                currentBlock;
            } else if (
              currentBlock ===
                0 &&
              adjacentBlock !==
                0
            ) {
              mask[
                maskIndex
              ] =
                -adjacentBlock;
            } else {
              mask[
                maskIndex
              ] =
                0;
            }

            maskIndex +=
              1;
          }
        }

        position[
          axis
        ] += 1;

        maskIndex =
          0;

        for (
          let vertical = 0;
          vertical <
          dimensions[
            verticalAxis
          ];
          vertical += 1
        ) {
          for (
            let horizontal = 0;
            horizontal <
            dimensions[
              horizontalAxis
            ];
          ) {
            const maskValue =
              mask[
                maskIndex
              ] ??
              0;

            if (
              maskValue ===
              0
            ) {
              horizontal +=
                1;

              maskIndex +=
                1;

              continue;
            }

            let width =
              1;

            while (
              horizontal +
                width <
                dimensions[
                  horizontalAxis
                ] &&
              mask[
                maskIndex +
                  width
              ] ===
                maskValue
            ) {
              width +=
                1;
            }

            let height =
              1;

            heightSearch:
            while (
              vertical +
                height <
              dimensions[
                verticalAxis
              ]
            ) {
              for (
                let offset = 0;
                offset <
                width;
                offset += 1
              ) {
                const candidateIndex =
                  maskIndex +
                  offset +
                  height *
                    dimensions[
                      horizontalAxis
                    ];

                if (
                  mask[
                    candidateIndex
                  ] !==
                  maskValue
                ) {
                  break heightSearch;
                }
              }

              height +=
                1;
            }

            position[
              horizontalAxis
            ] =
              horizontal;

            position[
              verticalAxis
            ] =
              vertical;

            widthVector[0] =
              0;

            widthVector[1] =
              0;

            widthVector[2] =
              0;

            heightVector[0] =
              0;

            heightVector[1] =
              0;

            heightVector[2] =
              0;

            widthVector[
              horizontalAxis
            ] =
              width;

            heightVector[
              verticalAxis
            ] =
              height;

            const faceDirection =
              maskValue >
              0
                ? 1
                : -1;

            GreedyMesher
              .appendQuad(
                positions,
                normals,
                uvs,
                indices,

                vertexCounter,

                position,
                widthVector,
                heightVector,

                axis,
                faceDirection,

                width,
                height,
              );

            vertexCounter +=
              4;

            for (
              let row = 0;
              row <
              height;
              row += 1
            ) {
              for (
                let column = 0;
                column <
                width;
                column += 1
              ) {
                mask[
                  maskIndex +
                    column +
                    row *
                      dimensions[
                        horizontalAxis
                      ]
                ] =
                  0;
              }
            }

            horizontal +=
              width;

            maskIndex +=
              width;
          }
        }
      }
    }

    return {
      chunkCoord:
        coord,

      positions:
        new Float32Array(
          positions,
        ),

      normals:
        new Float32Array(
          normals,
        ),

      uvs:
        new Float32Array(
          uvs,
        ),

      indices:
        new Uint32Array(
          indices,
        ),
    };
  }

  private static appendQuad(
    positions:
      number[],
    normals:
      number[],
    uvs:
      number[],
    indices:
      number[],

    vertexCounter:
      number,

    origin:
      AxisVector,

    widthVector:
      AxisVector,

    heightVector:
      AxisVector,

    normalAxis:
      number,

    normalDirection:
      number,

    uvWidth:
      number,

    uvHeight:
      number,
  ): void {
    const x0 =
      origin[0];

    const y0 =
      origin[1];

    const z0 =
      origin[2];

    const x1 =
      x0 +
      widthVector[0];

    const y1 =
      y0 +
      widthVector[1];

    const z1 =
      z0 +
      widthVector[2];

    const x2 =
      x1 +
      heightVector[0];

    const y2 =
      y1 +
      heightVector[1];

    const z2 =
      z1 +
      heightVector[2];

    const x3 =
      x0 +
      heightVector[0];

    const y3 =
      y0 +
      heightVector[1];

    const z3 =
      z0 +
      heightVector[2];

    if (
      normalDirection >
      0
    ) {
      positions.push(
        x0,
        y0,
        z0,

        x1,
        y1,
        z1,

        x2,
        y2,
        z2,

        x3,
        y3,
        z3,
      );
    } else {
      positions.push(
        x0,
        y0,
        z0,

        x3,
        y3,
        z3,

        x2,
        y2,
        z2,

        x1,
        y1,
        z1,
      );
    }

    const normalX =
      normalAxis ===
      0
        ? normalDirection
        : 0;

    const normalY =
      normalAxis ===
      1
        ? normalDirection
        : 0;

    const normalZ =
      normalAxis ===
      2
        ? normalDirection
        : 0;

    for (
      let vertex = 0;
      vertex < 4;
      vertex += 1
    ) {
      normals.push(
        normalX,
        normalY,
        normalZ,
      );
    }

    uvs.push(
      0,
      0,

      uvWidth,
      0,

      uvWidth,
      uvHeight,

      0,
      uvHeight,
    );

    indices.push(
      vertexCounter,

      vertexCounter +
        1,

      vertexCounter +
        2,

      vertexCounter,

      vertexCounter +
        2,

      vertexCounter +
        3,
    );
  }
}