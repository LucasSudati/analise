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



import h5wasm from "npm:h5wasm@0.10.3";

const BUCKET = "https://noaa-goes19.s3.amazonaws.com/";
const PRODUCT = "GLM-L2-LCFA";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers":
    "content-type, apikey, authorization",

  "Cache-Control": "public, max-age=20, s-maxage=20",
};

type Flash = {
  lat: number;
  lon: number;
  time: string;
};

type CacheData = {
  at: number;

  flashes: Flash[];

  latest: string | null;

  filesFound: number;
  filesSelected: number;
  filesParsed: number;
  filesFailed: number;

  rawFlashes: number;
};

let memoryCache: CacheData | null = null;

function prefixFor(d: Date) {

  const y = d.getUTCFullYear();

  const start = Date.UTC(
    y,
    0,
    0,
  );

  const doy = Math.floor(
    (d.getTime() - start) / 86400000,
  );

  return (
    `${PRODUCT}/` +
    `${y}/` +
    `${String(doy).padStart(3, "0")}/` +
    `${String(d.getUTCHours()).padStart(2, "0")}/`
  );
}

function startFromKey(k: string) {

  const m = k.match(
    /_s(\d{4})(\d{3})(\d{2})(\d{2})(\d{2})/,
  );

  if (!m) {
    return null;
  }

  const [
    ,
    ys,
    ds,
    hs,
    ms,
    ss,
  ] = m;

  const y = Number(ys);
  const doy = Number(ds);

  return new Date(
    Date.UTC(
      y,
      0,
      doy,
      Number(hs),
      Number(ms),
      Number(ss),
    ),
  );
}
// Aqui seleciono os arquivos GLM disponíveis na janela de interesse.
// Quero conferir se a janela temporal e a ordenação garantem cobertura contínua, sem lacunas ou duplicação entre arquivos.

async function listKeys(d: Date) {

  const prefix = prefixFor(d);

  const url =
    `${BUCKET}` +
    `?list-type=2` +
    `&prefix=${encodeURIComponent(prefix)}`;

  const r = await fetch(url);

  if (!r.ok) {
    throw new Error(
      `NOAA list HTTP ${r.status}`,
    );
  }

  const xml = await r.text();

  return [
    ...xml.matchAll(
      /<Key>([^<]+\.nc)<\/Key>/g,
    ),
  ].map(
    (x) =>
      x[1].replaceAll(
        "&amp;",
        "&",
      ),
  );
}

function numeric(a: any): number[] {

  if (a == null) {
    return [];
  }

  if (ArrayBuffer.isView(a)) {
    return Array.from(
      a as any,
      Number,
    );
  }

  if (Array.isArray(a)) {
    return a.map(Number);
  }

  return [
    Number(a),
  ];
}

function datasetValues(
  f: any,
  name: string,
) {

  const d = f.get(name);

  if (!d) {
    return [];
  }

  let a = numeric(
    d.value,
  );

  const attrs =
    d.attrs || {};

  const sf = Number(
    attrs.scale_factor?.value ??
    attrs.scale_factor ??
    1,
  );

  const off = Number(
    attrs.add_offset?.value ??
    attrs.add_offset ??
    0,
  );

  if (
    Number.isFinite(sf) &&
    Number.isFinite(off) &&
    (
      sf !== 1 ||
      off !== 0
    )
  ) {

    a = a.map(
      (v) =>
        v * sf + off,
    );
  }

  return a;
}

type FileResult = {

  flashes: Flash[];

  rawCount: number;

  latCount: number;
  lonCount: number;
  timeCount: number;

  key: string;
};
// Aqui extraio as detecções do arquivo GLM.
// Quero validar quais variáveis do produto estão sendo usadas, quais filtros são aplicados e se estou tratando
// corretamente valores ausentes, qualidade do dado e diferenças entre flash, group e event.

async function readGlmFile(
  key: string,
): Promise<FileResult> {

  const r = await fetch(
    BUCKET + key,
  );

  if (!r.ok) {

    throw new Error(
      `NOAA file HTTP ${r.status}`,
    );
  }

  const bytes =
    new Uint8Array(
      await r.arrayBuffer(),
    );

  const mod =
    await h5wasm.ready;

  const { FS } = mod;

  const fn =
    `/tmp/glm-${crypto.randomUUID()}.nc`;

  FS.writeFile(
    fn,
    bytes,
  );

  try {

    const f =
      new h5wasm.File(
        fn,
        "r",
      );

    try {

      const lat =
        datasetValues(
          f,
          "flash_lat",
        );

      const lon =
        datasetValues(
          f,
          "flash_lon",
        );

      const sec =
        datasetValues(
          f,
          "flash_time_offset_of_last_event",
        );

      const q =
        datasetValues(
          f,
          "flash_quality_flag",
        );

      const base =
        startFromKey(
          key,
        );

      const rawCount =
        Math.max(
          lat.length,
          lon.length,
          sec.length,
        );

      if (!base) {

        return {
          flashes: [],
          rawCount,
          latCount: lat.length,
          lonCount: lon.length,
          timeCount: sec.length,
          key,
        };
      }

      const out: Flash[] =
        [];

      const n =
        Math.min(
          lat.length,
          lon.length,
          sec.length,
        );

      for (
        let i = 0;
        i < n;
        i++
      ) {

        if (
          q.length &&
          Number(q[i]) !== 0
        ) {
          continue;
        }

        const la =
          Number(lat[i]);

        const lo =
          Number(lon[i]);

        const s =
          Number(sec[i]);

        if (
          !Number.isFinite(la) ||
          !Number.isFinite(lo) ||
          !Number.isFinite(s)
        ) {
          continue;
        }

        if (
          la < -90 ||
          la > 90 ||
          lo < -180 ||
          lo > 180
        ) {
          continue;
        }

        const time =
          new Date(
            base.getTime() +
            s * 1000,
          ).toISOString();

        out.push({
          lat: la,
          lon: lo,
          time,
        });
      }

      return {

        flashes: out,

        rawCount,

        latCount:
          lat.length,

        lonCount:
          lon.length,

        timeCount:
          sec.length,

        key,
      };

    } finally {

      f.close();
    }

  } finally {

    try {
      FS.unlink(fn);
    } catch {

    }
  }
}
// Aqui junto a atividade elétrica recente que será entregue ao restante do MONI.
// A janela de tempo adotada influencia diretamente a percepção de atividade: quero avaliar se ela é adequada
// para monitoramento convectivo e se contagens de flashes podem ser comparadas de forma confiável no espaço.

async function loadRecent():
  Promise<CacheData> {

  if (
    memoryCache &&
    Date.now() -
        memoryCache.at <
      20000
  ) {

    return memoryCache;
  }

  const now =
    new Date();

  const prev =
    new Date(
      now.getTime() -
      3600000,
    );

  const currentKeys =
    await listKeys(now);

  const previousKeys =
    await listKeys(prev);

  const allKeys = [
    ...currentKeys,
    ...previousKeys,
  ];

  const uniqueKeys =
    [...new Set(allKeys)];

  const cutoff =
    Date.now() -
    20 * 60000;

  const recent =
    uniqueKeys
      .map(
        (k) => ({
          k,
          d:
            startFromKey(k),
        }),
      )

      .filter(
        (x) =>
          x.d &&
          x.d.getTime() >=
            cutoff,
      )

      .sort(
        (a, b) =>
          a.d!.getTime() -
          b.d!.getTime(),
      )

      .slice(-60);

  const flashes: Flash[] =
    [];

  let filesParsed = 0;
  let filesFailed = 0;

  let rawFlashes = 0;

  for (
    let i = 0;
    i < recent.length;
    i += 6
  ) {

    const group =
      recent.slice(
        i,
        i + 6,
      );

    const batch =
      await Promise.allSettled(
        group.map(
          (x) =>
            readGlmFile(
              x.k,
            ),
        ),
      );

    for (
      const result
      of batch
    ) {

      if (
        result.status ===
        "fulfilled"
      ) {

        filesParsed++;

        rawFlashes +=
          result.value.rawCount;

        flashes.push(
          ...result.value.flashes,
        );

      } else {

        filesFailed++;

        console.error(
          "Falha ao processar arquivo GLM:",
          result.reason,
        );
      }
    }
  }

  const latest =
    flashes.reduce<
      string | null
    >(
      (m, x) =>
        !m ||
        x.time > m
          ? x.time
          : m,
      null,
    );

  memoryCache = {

    at:
      Date.now(),

    flashes,

    latest,

    filesFound:
      uniqueKeys.length,

    filesSelected:
      recent.length,

    filesParsed,

    filesFailed,

    rawFlashes,
  };

  return memoryCache;
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

      return Response.json(
        {
          error:
            "method not allowed",
        },
        {
          status: 405,
          headers: CORS,
        },
      );
    }

    try {

      const u =
        new URL(
          req.url,
        );

      const south =
        Math.max(
          -54,
          Number(
            u.searchParams.get(
              "south",
            ) ?? -54,
          ),
        );

      const north =
        Math.min(
          54,
          Number(
            u.searchParams.get(
              "north",
            ) ?? 15,
          ),
        );

      const west =
        Number(
          u.searchParams.get(
            "west",
          ) ?? -90,
        );

      const east =
        Number(
          u.searchParams.get(
            "east",
          ) ?? -30,
        );

      const minutes =
        Math.max(
          5,
          Math.min(
            20,
            Number(
              u.searchParams.get(
                "minutes",
              ) ?? 15,
            ),
          ),
        );

      const data =
        await loadRecent();

      const cutoff =
        Date.now() -
        minutes * 60000;

      const validFlashes =
        data.flashes.filter(
          (f) =>
            Number.isFinite(
              f.lat,
            ) &&
            Number.isFinite(
              f.lon,
            ) &&
            f.lat >= -90 &&
            f.lat <= 90 &&
            f.lon >= -180 &&
            f.lon <= 180,
        );

      const timeFlashes =
        validFlashes.filter(
          (f) =>
            Date.parse(
              f.time,
            ) >= cutoff,
        );

      const southAmerica =
        timeFlashes.filter(
          (f) =>
            f.lat >= -60 &&
            f.lat <= 15 &&
            f.lon >= -90 &&
            f.lon <= -30,
        );

      const flashes =
        timeFlashes.filter(
          (f) =>
            f.lat >= south &&
            f.lat <= north &&
            f.lon >= west &&
            f.lon <= east,
        );

      const sample =
        timeFlashes
          .slice(0, 10)
          .map(
            (f) => ({
              lat: f.lat,
              lon: f.lon,
              time: f.time,
            }),
          );

      return Response.json(
        {

          source:
            "NOAA GOES-19 GLM-L2-LCFA",

          source_ok:
            true,

          latest:
            data.latest,

          generated:
            new Date()
              .toISOString(),

          diagnostic: {

            files_found:
              data.filesFound,

            files_selected:
              data.filesSelected,

            files_parsed:
              data.filesParsed,

            files_failed:
              data.filesFailed,

            raw_flashes:
              data.rawFlashes,

            valid_coordinates:
              validFlashes.length,

            time_window_flashes:
              timeFlashes.length,

            south_america_flashes:
              southAmerica.length,

            bbox_flashes:
              flashes.length,

            bbox: {
              south,
              west,
              north,
              east,
            },

            minutes,

            sample,
          },

          flashes,
        },
        {
          headers: CORS,
        },
      );

    } catch (e) {

      console.error(
        "MONI GLM ERROR:",
        e,
      );

      return Response.json(
        {

          source:
            "NOAA GOES-19 GLM-L2-LCFA",

          source_ok:
            false,

          error:
            String(e),

          generated:
            new Date()
              .toISOString(),

          flashes: [],
        },
        {
          status: 503,

          headers: {
            ...CORS,
            "Cache-Control":
              "no-store",
          },
        },
      );
    }
  },
};