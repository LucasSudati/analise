/*
 * NOTAS PARA REVISÃO METEOROLÓGICA
 *
 * Comentei este arquivo pensando na revisão do tratamento dos dados, não só na parte de programação.
 * Quero que a análise considere principalmente: qualidade e origem do dado, resolução espacial e temporal,
 * filtros e limiares adotados, hipóteses físicas, possíveis falsos positivos/negativos e até onde o resultado
 * pode ou não ser interpretado meteorologicamente.
 *
 * Quando o código faz uma classificação, associação ou estimativa, isso não deve ser entendido automaticamente
 * como observação ou alerta oficial. Minha intenção é justamente identificar com a revisão quais critérios
 * precisam ser recalibrados, documentados ou substituídos por métodos meteorologicamente mais robustos.
 */



const SUPABASE_FUNCTIONS =
  "https://whdymuqmzuwmrsqaqywd.supabase.co/functions/v1";

const STSC_URL =
  `${SUPABASE_FUNCTIONS}/stsc?anima=1`;

const RADAR_URL =
  `${SUPABASE_FUNCTIONS}/radar`;

const GLM_URL =
  `${SUPABASE_FUNCTIONS}/glm?minutes=15`;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers":
    "content-type, apikey, authorization",

  "Cache-Control":
    "public, max-age=60, s-maxage=60",
};

const GRID_STEP = 0.1;

const CLUSTER_DISTANCE_DEG = 0.16;

const MIN_CLUSTER_POINTS = 3;

const GLM_RADIUS_KM = 35;

const GLM_ACTIVE_COUNT = 2;

type Point = [
  number,
  number,
];

type LatLon = {
  lat: number;
  lon: number;
};

type Cluster = {
  id: string;

  center: LatLon;

  points: Point[];

  point_count: number;

  bounds: {
    south: number;
    west: number;
    north: number;
    east: number;
  };
};

type RadarImage = {
  radar?: string;
  area?: string;
  type?: string;
  timestamp?: string;
  image?: string;

  radius_km?: number;

  center?: {
    lat: number;
    lon: number;
  };

  bounds?: {
    south: number;
    west: number;
    north: number;
    east: number;
  };
};

type Flash = {
  lat: number;
  lon: number;
  time?: string;
};

function json(
  data: unknown,
  status = 200,
) {
  return Response.json(
    data,
    {
      status,
      headers: CORS,
    },
  );
}

async function fetchJson(
  url: string,
) {
  const response =
    await fetch(url);

  if (!response.ok) {
    throw new Error(
      `${url} -> HTTP ${response.status}`,
    );
  }

  return await response.json();
}

function distanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
) {
  const R = 6371;

  const dLat =
    (lat2 - lat1) *
    Math.PI /
    180;

  const dLon =
    (lon2 - lon1) *
    Math.PI /
    180;

  const a =
    Math.sin(dLat / 2) ** 2 +

    Math.cos(
      lat1 *
      Math.PI /
      180,
    ) *

    Math.cos(
      lat2 *
      Math.PI /
      180,
    ) *

    Math.sin(dLon / 2) ** 2;

  return (
    2 *
    R *
    Math.atan2(
      Math.sqrt(a),
      Math.sqrt(1 - a),
    )
  );
}

function gridDistance(
  a: Point,
  b: Point,
) {
  const dy =
    a[0] - b[0];

  const dx =
    a[1] - b[1];

  return Math.sqrt(
    dx * dx +
    dy * dy,
  );
}
// Aqui agrupo evidências próximas no espaço/tempo para procurar uma assinatura coerente.
// Quero avaliar se as escalas espacial e temporal escolhidas têm significado meteorológico e como elas afetam
// falsos agrupamentos em sistemas extensos ou a separação de células muito próximas.

function clusterSTSC(
  points: Point[],
): Cluster[] {

  const visited =
    new Array(
      points.length,
    ).fill(false);

  const clusters:
    Cluster[] = [];

  for (
    let i = 0;
    i < points.length;
    i++
  ) {
    if (visited[i]) {
      continue;
    }

    const queue =
      [i];

    visited[i] =
      true;

    const members:
      Point[] = [];

    while (
      queue.length
    ) {
      const currentIndex =
        queue.pop()!;

      const current =
        points[currentIndex];

      members.push(
        current,
      );

      for (
        let j = 0;
        j < points.length;
        j++
      ) {
        if (
          visited[j]
        ) {
          continue;
        }

        if (
          gridDistance(
            current,
            points[j],
          ) <=
          CLUSTER_DISTANCE_DEG
        ) {
          visited[j] =
            true;

          queue.push(j);
        }
      }
    }

    if (
      members.length <
      MIN_CLUSTER_POINTS
    ) {
      continue;
    }

    let latSum = 0;
    let lonSum = 0;

    let south = 90;
    let north = -90;

    let west = 180;
    let east = -180;

    for (
      const [
        lat,
        lon,
      ] of members
    ) {
      latSum += lat;
      lonSum += lon;

      south =
        Math.min(
          south,
          lat,
        );

      north =
        Math.max(
          north,
          lat,
        );

      west =
        Math.min(
          west,
          lon,
        );

      east =
        Math.max(
          east,
          lon,
        );
    }

    const center = {
      lat:
        latSum /
        members.length,

      lon:
        lonSum /
        members.length,
    };

    clusters.push({
      id:
        `stsc-${clusters.length + 1}`,

      center,

      points:
        members,

      point_count:
        members.length,

      bounds: {
        south,
        west,
        north,
        east,
      },
    });
  }

  return clusters;
}
// Aqui procuro quais radares podem contribuir para a análise do ponto/célula.
// A distância ao radar não é apenas geométrica: quero que seja considerada também a altura do feixe, bloqueios,
// resolução e qualidade da observação conforme aumenta a distância.

function findRadars(
  cluster: Cluster,
  images: RadarImage[],
) {
  return images.filter(
    (radar) => {

      if (
        radar.bounds
      ) {
        const b =
          radar.bounds;

        return (
          cluster.center.lat >=
            b.south &&

          cluster.center.lat <=
            b.north &&

          cluster.center.lon >=
            b.west &&

          cluster.center.lon <=
            b.east
        );
      }

      if (
        radar.center &&
        radar.radius_km
      ) {
        return (
          distanceKm(
            cluster.center.lat,
            cluster.center.lon,

            radar.center.lat,
            radar.center.lon,
          ) <=
          radar.radius_km
        );
      }

      return false;
    },
  );
}
// Aqui associo atividade elétrica GLM à região analisada.
// Quero validar o raio e a janela temporal dessa associação e evitar interpretar proximidade de raios, sozinha,
// como evidência direta de granizo.

function findNearbyFlashes(
  cluster: Cluster,
  flashes: Flash[],
) {
  return flashes.filter(
    (flash) =>
      distanceKm(
        cluster.center.lat,
        cluster.center.lon,

        flash.lat,
        flash.lon,
      ) <=
      GLM_RADIUS_KM,
  );
}

export default {

  async fetch(
    req: Request,
  ) {

    if (
      req.method ===
      "OPTIONS"
    ) {
      return new Response(
        null,
        {
          status: 204,
          headers: CORS,
        },
      );
    }

    if (
      req.method !==
      "GET"
    ) {
      return json(
        {
          ok: false,
          error:
            "method not allowed",
        },
        405,
      );
    }

    const started =
      Date.now();

    try {

      const url =
        new URL(
          req.url,
        );

      const debug =
        url.searchParams.get(
          "debug",
        ) === "1";

      const [
        stscResult,
        radarResult,
        glmResult,
      ] =
        await Promise.allSettled([
          fetchJson(
            STSC_URL,
          ),

          fetchJson(
            RADAR_URL,
          ),

          fetchJson(
            GLM_URL,
          ),
        ]);

      if (
        stscResult.status !==
        "fulfilled"
      ) {
        throw new Error(
          "STSC unavailable: " +
          stscResult.reason,
        );
      }

      const stsc =
        stscResult.value;

      const rawPoints =
        Array.isArray(
          stsc?.latest?.points,
        )
          ? stsc.latest.points
          : [];

      const stscPoints:
        Point[] =
        rawPoints.filter(
          (p: unknown) =>
            Array.isArray(p) &&
            p.length >= 2 &&
            Number.isFinite(
              Number(p[0]),
            ) &&
            Number.isFinite(
              Number(p[1]),
            ),
        ).map(
          (p: any) => [
            Number(p[0]),
            Number(p[1]),
          ],
        );

      let radarImages:
        RadarImage[] = [];

      if (
        radarResult.status ===
        "fulfilled"
      ) {
        radarImages =
          Array.isArray(
            radarResult.value
              ?.images,
          )
            ? radarResult.value.images
            : [];
      }

      let flashes:
        Flash[] = [];

      if (
        glmResult.status ===
        "fulfilled"
      ) {
        flashes =
          Array.isArray(
            glmResult.value
              ?.flashes,
          )
            ? glmResult.value.flashes
            : [];
      }

      const clusters =
        clusterSTSC(
          stscPoints,
        );

      const regions =
        clusters.map(
          (
            cluster,
            index,
          ) => {

            const radars =
              findRadars(
                cluster,
                radarImages,
              );

            const nearbyFlashes =
              findNearbyFlashes(
                cluster,
                flashes,
              );

            const radarAvailable =
              radars.length > 0;

            const lightningActive =
              nearbyFlashes.length >=
              GLM_ACTIVE_COUNT;

            let level =
              "convective";

            let hail =
              "not_assessed";

            if (
              lightningActive
            ) {
              level =
                "thunderstorm";
            }

            return {
              id:
                `moni-${index + 1}`,

              center:
                cluster.center,

              bounds:
                cluster.bounds,

              stsc: {
                active: true,

                points:
                  cluster.point_count,
              },

              radar: {
                available:
                  radarAvailable,

                count:
                  radars.length,

                sites:
                  radars.map(
                    (r) => ({
                      area:
                        r.area ??
                        null,

                      radar:
                        r.radar ??
                        null,

                      timestamp:
                        r.timestamp ??
                        null,
                    }),
                  ),
              },

              glm: {
                active:
                  lightningActive,

                count:
                  nearbyFlashes.length,
              },

              classification: {
                level,

                hail,

                hail_icon:
                  false,
              },
            };
          },
        );

      const activeRegions =
        regions.filter(
          (region) =>
            region.stsc.points >=
              MIN_CLUSTER_POINTS ||
            region.glm.active,
        );

      const result: any = {

        ok: true,

        engine:
          "MONI Hail Engine",

        version:
          "1.0.0",

        generated:
          new Date()
            .toISOString(),

        processing_ms:
          Date.now() -
          started,

        sources: {

          stsc: {
            ok: true,

            latest:
              stsc?.latest?.label ??
              null,

            points:
              stscPoints.length,
          },

          radar: {
            ok:
              radarResult.status ===
              "fulfilled",

            images:
              radarImages.length,
          },

          glm: {
            ok:
              glmResult.status ===
              "fulfilled",

            flashes:
              flashes.length,
          },
        },

        summary: {
          clusters:
            clusters.length,

          regions:
            activeRegions.length,

          thunderstorms:
            activeRegions.filter(
              (r) =>
                r.classification
                  .level ===
                "thunderstorm",
            ).length,

          hail_candidates:
            0,

          hail_probable:
            0,

          hail_confirmed:
            0,
        },

        regions:
          activeRegions,
      };

      if (debug) {
        result.debug = {

          config: {
            grid_step:
              GRID_STEP,

            cluster_distance_deg:
              CLUSTER_DISTANCE_DEG,

            min_cluster_points:
              MIN_CLUSTER_POINTS,

            glm_radius_km:
              GLM_RADIUS_KM,

            glm_active_count:
              GLM_ACTIVE_COUNT,
          },

          upstream: {

            stsc:
              stscResult.status,

            radar:
              radarResult.status,

            glm:
              glmResult.status,
          },
        };
      }

      return json(
        result,
      );

    } catch (
      error
    ) {

      console.error(
        "MONI HAIL ENGINE:",
        error,
      );

      return json(
        {
          ok: false,

          engine:
            "MONI Hail Engine",

          version:
            "1.0.0",

          generated:
            new Date()
              .toISOString(),

          error:
            String(error),
        },
        503,
      );
    }
  },
};