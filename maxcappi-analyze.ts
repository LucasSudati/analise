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



import { decode } from "https://deno.land/x/pngs@0.1.1/mod.ts";

const FUNCTIONS = "https://whdymuqmzuwmrsqaqywd.supabase.co/functions/v1";
const RADAR_URL = `${FUNCTIONS}/radar`;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "content-type, apikey, authorization",
  "Cache-Control": "public, max-age=45, s-maxage=45",
};

const CELL_CONFIG = {

  cellMinDbz: 30,
  cellMinPixels: 3,

  coreMinDbz: 50,
  coreMinPixels: 2,

  mergeDistanceKm: 20,

  maxCellsPerRadar: 100,
  maxCoresPerCell: 50,
  batchSize: 1,
};

const TRACKING_CONFIG = {
  stateTable: "moni_maxcappi_state",
  stateId: "brasil",
  maxPreviousAgeMinutes: 90,
  maxPhysicalSpeedKmh: 180,
  baseDistanceToleranceKm: 8,
  maxMatchDistanceKm: 60,
  minimumMatchScore: 0.46,
  highConfidenceScore: 0.78,
  mediumConfidenceScore: 0.60,
  forecastMinutes: [15, 30, 45, 60],
  historyMaxPoints: 8,
  smoothingMaxSegments: 5,
  sharpDirectionChangeDeg: 55,
  sharpSpeedChangeKmh: 45,
  forecastGoodErrorKm: 12,
  forecastFairErrorKm: 30,

  predictedBaseToleranceKm: 6,
  predictedSpeedToleranceFactor: 0.45,
  maxPredictionErrorKm: 45,
  maxDirectionMismatchDeg: 95,
  maxSpeedMismatchKmh: 80,
  maxDbzJump: 25,
  maxAreaRatio: 5,
  maxCoreJump: 10,
  forecastMinMatchScore: 0.60,
  forecastMinHistoryPoints: 3,

  spatialBinDegrees: 1,
  spatialNeighborBins: 1,
  smallCellMaxPixels: 5,
  smallCellMaxMatchDistanceKm: 25,
  smallCellScorePenalty: 0.08,
  forecastMinTrackQualityScore: 0.58,

  forecastValidationToleranceMinutes: 6,
  forecastArchiveRetentionMinutes: 75,
  forecastArchiveMaxRuns: 8,
};

type Bounds = { south: number; west: number; north: number; east: number };
type RGB = { r: number; g: number; b: number; a: number };

type RadarImage = {
  radar: string;
  area: string;
  type: string;
  timestamp: string;
  image: string;
  radius_km?: number;
  center?: { lat: number; lon: number };
  bounds: Bounds;
};

type DecodedRadar = {
  radar: RadarImage;
  width: number;
  height: number;
  data: Uint8Array;
};

type IntensityClass =
  | "none"
  | "weak"
  | "moderate"
  | "strong"
  | "very_strong"
  | "severe"
  | "extreme";

type ColorClass =
  | "none"
  | "blue"
  | "cyan"
  | "green"
  | "yellow_orange"
  | "red"
  | "magenta";

type PixelAnalysis = {
  meteorological: boolean;
  estimated_dbz: number | null;
  intensity: IntensityClass;
  score: number;
  color_class: ColorClass;
};

type GridPixel = {
  dbz: number;
  score: number;
  intensity: IntensityClass;
  color_class: ColorClass;
  rgb: RGB;
};

type ComponentPixel = GridPixel & { x: number; y: number };

type CellCore = {
  id: string;
  pixel_count: number;
  approximate_area_km2: number;
  center: { lat: number; lon: number };
  peak: { lat: number; lon: number; x: number; y: number };
  max_estimated_dbz: number;
  mean_estimated_dbz: number;
  intensity: IntensityClass;
  red_pixels: number;
  magenta_pixels: number;
  has_magenta: boolean;
  red_fraction: number;
  magenta_fraction: number;
  bbox_pixels: { min_x: number; max_x: number; min_y: number; max_y: number };
  bbox_geo: { north: number; south: number; west: number; east: number };
  peak_rgb: RGB;
  peak_color_class: ColorClass;
};

type RadarCell = {
  radar: string;
  radar_name: string;
  timestamp: string;
  center: { lat: number; lon: number };
  peak: { lat: number; lon: number; x: number; y: number };
  pixel_count: number;
  approximate_area_km2: number;
  max_estimated_dbz: number;
  mean_estimated_dbz: number;
  intensity: IntensityClass;
  red_pixels: number;
  magenta_pixels: number;
  has_magenta: boolean;
  red_fraction: number;
  magenta_fraction: number;
  bbox_pixels: { min_x: number; max_x: number; min_y: number; max_y: number };
  bbox_geo: { north: number; south: number; west: number; east: number };
  peak_rgb: RGB;
  peak_color_class: ColorClass;

  core_count: number;
  convective_pixel_count: number;
  convective_fraction: number;
  cores: CellCore[];
};

type MergedCore = CellCore & {
  radar: string;
  radar_name: string;
  timestamp: string;
};

type MergedCell = {
  id: string;
  lat: number;
  lon: number;
  intensity: IntensityClass;
  max_estimated_dbz: number;
  mean_estimated_dbz: number;
  radar_count: number;
  radars: string[];
  pixel_count: number;
  approximate_area_km2: number;
  red_pixels: number;
  magenta_pixels: number;
  red_fraction: number;
  magenta_fraction: number;
  has_magenta: boolean;
  peak: { lat: number; lon: number; radar: string; rgb: RGB; color_class: ColorClass };

  core_count: number;
  convective_pixel_count: number;
  convective_fraction: number;
  cores: MergedCore[];

  observed_at: string;
  bbox_geo: { north: number; south: number; west: number; east: number };
  tracking_id?: string;
  tracking?: TrackingInfo;

  observations: RadarCell[];
};

type TrackingConfidence = "none" | "low" | "medium" | "high";
type TrendClass = "weakening" | "stable" | "intensifying" | "unknown";

type ForecastPoint = {
  minutes: number;
  lat: number;
  lon: number;
};

type ForecastRun = {
  source_observed_at: string;
  forecasts: ForecastPoint[];
};

type HistoryPoint = {
  observed_at: string;
  lat: number;
  lon: number;
  max_estimated_dbz: number;
  approximate_area_km2: number;
  core_count: number;
};

type ForecastValidation = {
  source_observed_at: string | null;
  target_minutes: number | null;
  actual_elapsed_minutes: number | null;
  error_km: number | null;
  quality: "unknown" | "good" | "fair" | "poor";
};

type TrackingInfo = {
  matched: boolean;
  confidence: TrackingConfidence;
  score: number | null;
  previous_observed_at: string | null;
  elapsed_minutes: number | null;
  distance_km: number | null;
  bearing_deg: number | null;
  direction: string | null;
  speed_kmh: number | null;
  rejected_physical_speed: boolean;
  trend: {
    classification: TrendClass;
    dbz_change: number | null;
    area_change_km2: number | null;
    area_change_percent: number | null;
    core_count_change: number | null;
  };
  forecast: ForecastPoint[];
  smoothed_speed_kmh: number | null;
  smoothed_bearing_deg: number | null;
  smoothed_direction: string | null;
  history_points: number;
  motion_quality: "unknown" | "low" | "medium" | "high";
  direction_change_deg: number | null;
  speed_change_kmh: number | null;
  abrupt_motion_change: boolean;
  forecast_validation: ForecastValidation;
  forecast_validations: ForecastValidation[];

  predicted_position: { lat: number; lon: number } | null;
  prediction_error_km: number | null;
  direction_consistency: number | null;
  speed_consistency: number | null;
  structural_consistency: number | null;
  match_rejection_reason: string | null;
  forecast_status: "available" | "blocked" | "insufficient_history";
  forecast_reason: string | null;

  track_quality_score: number | null;
  track_maturity: "new" | "developing" | "established";
  small_cell: boolean;
};

type StoredCell = {
  tracking_id: string;
  observed_at: string;
  lat: number;
  lon: number;
  max_estimated_dbz: number;
  mean_estimated_dbz: number;
  approximate_area_km2: number;
  pixel_count?: number;
  core_count: number;
  convective_fraction: number;
  radar_count: number;
  radars: string[];
  bbox_geo: { north: number; south: number; west: number; east: number };
  history?: HistoryPoint[];
  motion?: { speed_kmh: number | null; bearing_deg: number | null };
  forecast?: ForecastPoint[];
  forecast_archive?: ForecastRun[];
};

type TrackingState = {
  snapshot_at: string;
  cells: StoredCell[];
};

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: CORS });
}

async function fetchJson(url: string) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`);
  return await r.json();
}

function contains(radar: RadarImage, lat: number, lon: number) {
  const b = radar.bounds;
  return !!b && lat >= b.south && lat <= b.north && lon >= b.west && lon <= b.east;
}

function latLonToPixel(
  radar: RadarImage,
  width: number,
  height: number,
  lat: number,
  lon: number,
) {
  const b = radar.bounds;
  const xNorm = (lon - b.west) / (b.east - b.west);
  const yNorm = (b.north - lat) / (b.north - b.south);
  return {
    x: Math.max(0, Math.min(width - 1, Math.round(xNorm * (width - 1)))),
    y: Math.max(0, Math.min(height - 1, Math.round(yNorm * (height - 1)))),
  };
}

function pixelToLatLon(
  radar: RadarImage,
  width: number,
  height: number,
  x: number,
  y: number,
) {
  const b = radar.bounds;
  const lon = b.west + (x / Math.max(1, width - 1)) * (b.east - b.west);
  const lat = b.north - (y / Math.max(1, height - 1)) * (b.north - b.south);
  return { lat, lon };
}

function getPixel(decoded: DecodedRadar, x: number, y: number): RGB {
  const i = (y * decoded.width + x) * 4;
  return {
    r: decoded.data[i] ?? 0,
    g: decoded.data[i + 1] ?? 0,
    b: decoded.data[i + 2] ?? 0,
    a: decoded.data[i + 3] ?? 0,
  };
}
// Aqui eu transformo a imagem/produto de radar em dados que o restante da análise consegue percorrer.
// Quero conferir se essa leitura preserva corretamente a informação física do produto e se existe alguma
// conversão, transparência, paleta ou pixel sem dado que possa acabar sendo interpretado como eco válido.

async function decodeRadar(radar: RadarImage): Promise<DecodedRadar> {
  const r = await fetch(radar.image);
  if (!r.ok) throw new Error(`${radar.area} PNG HTTP ${r.status}`);

  const bytes = new Uint8Array(await r.arrayBuffer());
  const png = decode(bytes);
  const width = Number((png as any).width);
  const height = Number((png as any).height);
  const raw = (png as any).data ?? (png as any).image;

  if (!Number.isFinite(width) || !Number.isFinite(height) || !raw) {
    throw new Error(`PNG inválido: ${radar.area}`);
  }

  return {
    radar,
    width,
    height,
    data: raw instanceof Uint8Array ? raw : new Uint8Array(raw),
  };
}
// Esta etapa relaciona a representação visual do radar com intensidade/refletividade.
// É um ponto crítico da revisão: quero validar se a correspondência de cores/valores é válida para o produto
// MAXCAPPI usado pela fonte e se mudanças de paleta podem alterar silenciosamente a classificação.

function analyzeColor(p: RGB): PixelAnalysis {
  const { r, g, b, a } = p;

  if (a < 100) {
    return { meteorological: false, estimated_dbz: null, intensity: "none", score: 0, color_class: "none" };
  }

  const gray = Math.abs(r - g) < 8 && Math.abs(g - b) < 8;
  if (gray) {
    return { meteorological: false, estimated_dbz: null, intensity: "none", score: 0, color_class: "none" };
  }

  if (r >= 130 && b >= 120 && g < 80) {
    const progression = Math.max(0, Math.min(1, (((r + b) / 2) - 130) / 125));
    return {
      meteorological: true,
      estimated_dbz: Math.round(65 + progression * 10),
      intensity: "extreme",
      score: 6 + progression,
      color_class: "magenta",
    };
  }

  if (r >= 125 && g < 80 && b < 90) {
    const progression = Math.max(0, Math.min(1, (r - 125) / 130));
    const dbz = 55 + progression * 10;
    return {
      meteorological: true,
      estimated_dbz: Math.round(dbz),
      intensity: dbz >= 60 ? "extreme" : "severe",
      score: 5 + progression,
      color_class: "red",
    };
  }

  if (r >= 180 && g >= 50 && b < 100) {
    const severity = 1 - Math.max(0, Math.min(1, (g - 50) / 205));
    const dbz = 45 + severity * 10;
    return {
      meteorological: true,
      estimated_dbz: Math.round(dbz),
      intensity: dbz >= 50 ? "very_strong" : "strong",
      score: 3 + severity * 2,
      color_class: "yellow_orange",
    };
  }

  if (g >= 100 && g > r * 1.2 && g > b * 1.05) {
    const severity = Math.max(0, Math.min(1, r / 100));
    const dbz = 30 + severity * 15;
    return {
      meteorological: true,
      estimated_dbz: Math.round(dbz),
      intensity: dbz >= 40 ? "strong" : "moderate",
      score: 2 + severity,
      color_class: "green",
    };
  }

  if (b >= 150 && g >= 100 && r < 120) {
    const severity = Math.max(0, Math.min(1, g / 255));
    return {
      meteorological: true,
      estimated_dbz: Math.round(20 + severity * 10),
      intensity: "moderate",
      score: 1 + severity,
      color_class: "cyan",
    };
  }

  if (b >= 120 && b > r && b > g) {
    return {
      meteorological: true,
      estimated_dbz: 15,
      intensity: "weak",
      score: 1,
      color_class: "blue",
    };
  }

  return { meteorological: false, estimated_dbz: null, intensity: "none", score: 0, color_class: "none" };
}

function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
// Aqui eu converto/refino a interpretação da refletividade em uma classe de intensidade.
// Os cortes adotados precisam ser avaliados meteorologicamente; não quero assumir que um limiar isolado de dBZ
// seja suficiente para caracterizar severidade, granizo ou estrutura convectiva.

function intensityFromDbz(dbz: number): IntensityClass {
  if (dbz >= 65) return "extreme";
  if (dbz >= 60) return "severe";
  if (dbz >= 50) return "very_strong";
  if (dbz >= 40) return "strong";
  if (dbz >= 30) return "moderate";
  return "weak";
}
// Aqui estimo a área representada por cada pixel.
// Quero validar o erro dessa aproximação com latitude, projeção, geometria do radar e resolução real do produto,
// porque esse erro se propaga para área de célula, tamanho de núcleo e filtros mínimos.

function approximatePixelAreaKm2(
  radar: RadarImage,
  width: number,
  height: number,
  latitude: number,
) {
  const b = radar.bounds;
  const latSpan = Math.abs(b.north - b.south);
  const lonSpan = Math.abs(b.east - b.west);
  const kmPerDegreeLat = 111.32;
  const kmPerDegreeLon = 111.32 * Math.cos(latitude * Math.PI / 180);
  const pixelHeightKm = (latSpan / Math.max(1, height - 1)) * kmPerDegreeLat;
  const pixelWidthKm = (lonSpan / Math.max(1, width - 1)) * Math.abs(kmPerDegreeLon);
  return pixelHeightKm * pixelWidthKm;
}

const CLASS_CODE: Record<ColorClass, number> = {
  none: 0,
  blue: 1,
  cyan: 2,
  green: 3,
  yellow_orange: 4,
  red: 5,
  magenta: 6,
};

function codeToClass(code: number): ColorClass {
  switch (code) {
    case 1: return "blue";
    case 2: return "cyan";
    case 3: return "green";
    case 4: return "yellow_orange";
    case 5: return "red";
    case 6: return "magenta";
    default: return "none";
  }
}

type CompactGrid = {
  dbz: Uint8Array;
  klass: Uint8Array;
  statistics: {
    meteorological_pixels: number;
    cell_pixels: number;
    convective_pixels: number;
    red_pixels: number;
    magenta_pixels: number;
    estimated_max_dbz: number | null;
  };
};

type Accumulator = {
  count: number;
  sumX: number;
  sumY: number;
  sumDbz: number;
  maxDbz: number;
  peakX: number;
  peakY: number;
  peakClass: number;
  red: number;
  magenta: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

function emptyAccumulator(): Accumulator {
  return {
    count: 0,
    sumX: 0,
    sumY: 0,
    sumDbz: 0,
    maxDbz: -1,
    peakX: 0,
    peakY: 0,
    peakClass: 0,
    red: 0,
    magenta: 0,
    minX: Infinity,
    maxX: -Infinity,
    minY: Infinity,
    maxY: -Infinity,
  };
}

function addToAccumulator(
  acc: Accumulator,
  x: number,
  y: number,
  dbz: number,
  klass: number,
) {
  acc.count++;
  acc.sumX += x;
  acc.sumY += y;
  acc.sumDbz += dbz;

  if (dbz > acc.maxDbz) {
    acc.maxDbz = dbz;
    acc.peakX = x;
    acc.peakY = y;
    acc.peakClass = klass;
  }

  if (klass === CLASS_CODE.red) acc.red++;
  if (klass === CLASS_CODE.magenta) acc.magenta++;

  if (x < acc.minX) acc.minX = x;
  if (x > acc.maxX) acc.maxX = x;
  if (y < acc.minY) acc.minY = y;
  if (y > acc.maxY) acc.maxY = y;
}

function buildCompactGrid(decoded: DecodedRadar): CompactGrid {
  const total = decoded.width * decoded.height;
  const dbz = new Uint8Array(total);
  const klass = new Uint8Array(total);

  let meteorologicalPixels = 0;
  let cellPixels = 0;
  let convectivePixels = 0;
  let redPixels = 0;
  let magentaPixels = 0;
  let maxDbz: number | null = null;

  for (let i = 0, p = 0; i < total; i++, p += 4) {
    const analysis = analyzeColor({
      r: decoded.data[p] ?? 0,
      g: decoded.data[p + 1] ?? 0,
      b: decoded.data[p + 2] ?? 0,
      a: decoded.data[p + 3] ?? 0,
    });

    if (!analysis.meteorological || analysis.estimated_dbz === null) continue;

    const value = Math.max(0, Math.min(255, analysis.estimated_dbz));
    const code = CLASS_CODE[analysis.color_class] ?? 0;
    dbz[i] = value;
    klass[i] = code;

    meteorologicalPixels++;
    if (value >= CELL_CONFIG.cellMinDbz) cellPixels++;
    if (value >= CELL_CONFIG.coreMinDbz) convectivePixels++;
    if (code === CLASS_CODE.red) redPixels++;
    if (code === CLASS_CODE.magenta) magentaPixels++;
    if (maxDbz === null || value > maxDbz) maxDbz = value;
  }

  return {
    dbz,
    klass,
    statistics: {
      meteorological_pixels: meteorologicalPixels,
      cell_pixels: cellPixels,
      convective_pixels: convectivePixels,
      red_pixels: redPixels,
      magenta_pixels: magentaPixels,
      estimated_max_dbz: maxDbz,
    },
  };
}

function accumulatorGeometry(acc: Accumulator, decoded: DecodedRadar) {
  const centerX = acc.sumX / Math.max(1, acc.count);
  const centerY = acc.sumY / Math.max(1, acc.count);
  const center = pixelToLatLon(decoded.radar, decoded.width, decoded.height, centerX, centerY);
  const peak = pixelToLatLon(decoded.radar, decoded.width, decoded.height, acc.peakX, acc.peakY);
  const northWest = pixelToLatLon(decoded.radar, decoded.width, decoded.height, acc.minX, acc.minY);
  const southEast = pixelToLatLon(decoded.radar, decoded.width, decoded.height, acc.maxX, acc.maxY);
  const pixelArea = approximatePixelAreaKm2(decoded.radar, decoded.width, decoded.height, center.lat);
  const peakRgb = getPixel(decoded, acc.peakX, acc.peakY);

  return {
    center,
    peak,
    pixel_count: acc.count,
    approximate_area_km2: Number((pixelArea * acc.count).toFixed(2)),
    max_estimated_dbz: acc.maxDbz,
    mean_estimated_dbz: Number((acc.sumDbz / Math.max(1, acc.count)).toFixed(1)),
    intensity: intensityFromDbz(acc.maxDbz),
    red_pixels: acc.red,
    magenta_pixels: acc.magenta,
    has_magenta: acc.magenta > 0,
    red_fraction: Number((acc.red / Math.max(1, acc.count)).toFixed(4)),
    magenta_fraction: Number((acc.magenta / Math.max(1, acc.count)).toFixed(4)),
    bbox_pixels: {
      min_x: acc.minX,
      max_x: acc.maxX,
      min_y: acc.minY,
      max_y: acc.maxY,
    },
    bbox_geo: {
      north: northWest.lat,
      west: northWest.lon,
      south: southEast.lat,
      east: southEast.lon,
    },
    peak_rgb: peakRgb,
    peak_color_class: codeToClass(acc.peakClass),
  };
}
// Aqui começo a transformar pixels/grades em células meteorológicas.
// Gostaria de avaliar se conectividade, tamanho mínimo e demais filtros representam estruturas convectivas reais
// ou se podem juntar células distintas / fragmentar uma mesma célula.

function extractCells(
  decoded: DecodedRadar,
  compact: CompactGrid,
) {
  const width = decoded.width;
  const height = decoded.height;
  const total = width * height;
  const visited = new Uint8Array(total);
  const labels = new Int32Array(total);
  const queue = new Int32Array(total);

  const cells: Array<{ label: number; acc: Accumulator }> = [];
  let rawComponents = 0;
  let nextLabel = 1;

  for (let start = 0; start < total; start++) {
    if (visited[start]) continue;
    visited[start] = 1;
    if (compact.dbz[start] < CELL_CONFIG.cellMinDbz) continue;

    rawComponents++;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    const acc = emptyAccumulator();

    while (head < tail) {
      const idx = queue[head++];
      const y = Math.floor(idx / width);
      const x = idx - y * width;
      const value = compact.dbz[idx];
      if (value < CELL_CONFIG.cellMinDbz) continue;

      addToAccumulator(acc, x, y, value, compact.klass[idx]);

      const y0 = y > 0 ? y - 1 : y;
      const y1 = y + 1 < height ? y + 1 : y;
      const x0 = x > 0 ? x - 1 : x;
      const x1 = x + 1 < width ? x + 1 : x;

      for (let ny = y0; ny <= y1; ny++) {
        const row = ny * width;
        for (let nx = x0; nx <= x1; nx++) {
          if (nx === x && ny === y) continue;
          const ni = row + nx;
          if (visited[ni]) continue;
          visited[ni] = 1;
          if (compact.dbz[ni] < CELL_CONFIG.cellMinDbz) continue;
          queue[tail++] = ni;
        }
      }
    }

    if (acc.count < CELL_CONFIG.cellMinPixels) continue;

    const label = nextLabel++;

    for (let i = 0; i < tail; i++) labels[queue[i]] = label;
    cells.push({ label, acc });
  }

  return { cells, labels, rawComponents };
}
// Aqui identifico núcleos dentro das áreas detectadas.
// Quero revisar especialmente os limiares de refletividade e área: o objetivo é saber quais critérios têm
// justificativa meteorológica e quais são apenas heurísticas que ainda precisam de calibração.

function extractCores(
  decoded: DecodedRadar,
  compact: CompactGrid,
  labels: Int32Array,
  cellCount: number,
) {
  const width = decoded.width;
  const height = decoded.height;
  const total = width * height;
  const visited = new Uint8Array(total);
  const queue = new Int32Array(total);
  const coresByCell: CellCore[][] = Array.from({ length: cellCount + 1 }, () => []);

  for (let start = 0; start < total; start++) {
    if (visited[start]) continue;
    visited[start] = 1;

    const label = labels[start];
    if (label <= 0 || compact.dbz[start] < CELL_CONFIG.coreMinDbz) continue;

    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    const acc = emptyAccumulator();

    while (head < tail) {
      const idx = queue[head++];
      const y = Math.floor(idx / width);
      const x = idx - y * width;
      const value = compact.dbz[idx];
      if (labels[idx] !== label || value < CELL_CONFIG.coreMinDbz) continue;

      addToAccumulator(acc, x, y, value, compact.klass[idx]);

      const y0 = y > 0 ? y - 1 : y;
      const y1 = y + 1 < height ? y + 1 : y;
      const x0 = x > 0 ? x - 1 : x;
      const x1 = x + 1 < width ? x + 1 : x;

      for (let ny = y0; ny <= y1; ny++) {
        const row = ny * width;
        for (let nx = x0; nx <= x1; nx++) {
          if (nx === x && ny === y) continue;
          const ni = row + nx;
          if (visited[ni]) continue;

          if (labels[ni] !== label || compact.dbz[ni] < CELL_CONFIG.coreMinDbz) continue;
          visited[ni] = 1;
          queue[tail++] = ni;
        }
      }
    }

    if (acc.count < CELL_CONFIG.coreMinPixels) continue;

    const g = accumulatorGeometry(acc, decoded);
    const bucket = coresByCell[label];
    bucket.push({
      id: "",
      pixel_count: g.pixel_count,
      approximate_area_km2: g.approximate_area_km2,
      center: g.center,
      peak: { lat: g.peak.lat, lon: g.peak.lon, x: acc.peakX, y: acc.peakY },
      max_estimated_dbz: g.max_estimated_dbz,
      mean_estimated_dbz: g.mean_estimated_dbz,
      intensity: g.intensity,
      red_pixels: g.red_pixels,
      magenta_pixels: g.magenta_pixels,
      has_magenta: g.has_magenta,
      red_fraction: g.red_fraction,
      magenta_fraction: g.magenta_fraction,
      bbox_pixels: g.bbox_pixels,
      bbox_geo: g.bbox_geo,
      peak_rgb: g.peak_rgb,
      peak_color_class: g.peak_color_class,
    });
  }

  for (let label = 1; label < coresByCell.length; label++) {
    const cores = coresByCell[label];
    cores.sort((a, b) =>
      b.max_estimated_dbz - a.max_estimated_dbz ||
      b.pixel_count - a.pixel_count
    );
    if (cores.length > CELL_CONFIG.maxCoresPerCell) {
      cores.length = CELL_CONFIG.maxCoresPerCell;
    }
    cores.forEach((core, i) => {
      core.id = `core-${String(i + 1).padStart(2, "0")}`;
    });
  }

  return coresByCell;
}
// Esta é uma das etapas centrais do tratamento do MAXCAPPI.
// Quero verificar se a redução/compactação mantém informação suficiente para análise de células e se não apaga
// máximos locais, gradientes ou estruturas pequenas relevantes para tempo severo.

function scanRadarCompact(decoded: DecodedRadar) {
  const compact = buildCompactGrid(decoded);
  const extracted = extractCells(decoded, compact);
  const coresByCell = extractCores(
    decoded,
    compact,
    extracted.labels,
    extracted.cells.length,
  );

  const cells: RadarCell[] = extracted.cells.map(({ label, acc }) => {
    const g = accumulatorGeometry(acc, decoded);
    const cores = coresByCell[label] ?? [];
    const convectivePixelCount = cores.reduce((sum, core) => sum + core.pixel_count, 0);

    return {
      radar: decoded.radar.area,
      radar_name: decoded.radar.radar,
      timestamp: decoded.radar.timestamp,
      center: g.center,
      peak: { lat: g.peak.lat, lon: g.peak.lon, x: acc.peakX, y: acc.peakY },
      pixel_count: g.pixel_count,
      approximate_area_km2: g.approximate_area_km2,
      max_estimated_dbz: g.max_estimated_dbz,
      mean_estimated_dbz: g.mean_estimated_dbz,
      intensity: g.intensity,
      red_pixels: g.red_pixels,
      magenta_pixels: g.magenta_pixels,
      has_magenta: g.has_magenta,
      red_fraction: g.red_fraction,
      magenta_fraction: g.magenta_fraction,
      bbox_pixels: g.bbox_pixels,
      bbox_geo: g.bbox_geo,
      peak_rgb: g.peak_rgb,
      peak_color_class: g.peak_color_class,
      core_count: cores.length,
      convective_pixel_count: convectivePixelCount,
      convective_fraction: g.pixel_count > 0
        ? Number((convectivePixelCount / g.pixel_count).toFixed(4))
        : 0,
      cores,
    };
  });

  cells.sort((a, b) =>
    b.max_estimated_dbz - a.max_estimated_dbz ||
    b.core_count - a.core_count ||
    b.pixel_count - a.pixel_count
  );
  if (cells.length > CELL_CONFIG.maxCellsPerRadar) cells.length = CELL_CONFIG.maxCellsPerRadar;

  return {
    ...compact.statistics,
    raw_components: extracted.rawComponents,
    cells: cells.length,
    detected_cores: cells.reduce((sum, cell) => sum + cell.core_count, 0),
    cells_with_cores: cells.filter((cell) => cell.core_count > 0).length,
    cells_with_magenta: cells.filter((cell) => cell.has_magenta).length,
    detected_cells: cells,
  };
}

function samplePosition(
  decoded: DecodedRadar,
  lat: number,
  lon: number,
  radiusPx: number,
) {
  const center = latLonToPixel(decoded.radar, decoded.width, decoded.height, lat, lon);
  const samples: any[] = [];
  let strongest: any = null;

  for (let dy = -radiusPx; dy <= radiusPx; dy++) {
    for (let dx = -radiusPx; dx <= radiusPx; dx++) {
      const x = center.x + dx;
      const y = center.y + dy;
      if (x < 0 || y < 0 || x >= decoded.width || y >= decoded.height) continue;

      const rgb = getPixel(decoded, x, y);
      const analysis = analyzeColor(rgb);
      const sample = {
        x,
        y,
        rgb,
        ...analysis,
        in_cell_threshold:
          analysis.estimated_dbz !== null && analysis.estimated_dbz >= CELL_CONFIG.cellMinDbz,
        in_core_threshold:
          analysis.estimated_dbz !== null && analysis.estimated_dbz >= CELL_CONFIG.coreMinDbz,
      };
      samples.push(sample);

      if (analysis.meteorological && (!strongest || analysis.score > strongest.score)) {
        strongest = sample;
      }
    }
  }

  return {
    pixel: center,
    radius_px: radiusPx,
    sampled_pixels: samples.length,
    strongest,
    samples,
  };
}
// Aqui tento combinar detecções provenientes de radares diferentes.
// A revisão deve considerar sobreposição de cobertura, diferenças de distância/altura do feixe, horários dos
// volumes e possibilidade de duplicar ou fundir incorretamente uma mesma tempestade.

function mergeRadarCells(cells: RadarCell[]): MergedCell[] {
  const ordered = [...cells].sort((a, b) =>
    b.max_estimated_dbz - a.max_estimated_dbz ||
    b.core_count - a.core_count ||
    b.pixel_count - a.pixel_count
  );

  type Group = { lat: number; lon: number; observations: RadarCell[] };
  const groups: Group[] = [];

  for (const cell of ordered) {
    let target: Group | null = null;
    let nearestDistance = Infinity;

    for (const group of groups) {

      if (group.observations.some((observation) => observation.radar === cell.radar)) continue;

      const d = distanceKm(cell.center.lat, cell.center.lon, group.lat, group.lon);
      if (d <= CELL_CONFIG.mergeDistanceKm && d < nearestDistance) {
        nearestDistance = d;
        target = group;
      }
    }

    if (!target) {
      groups.push({ lat: cell.center.lat, lon: cell.center.lon, observations: [cell] });
      continue;
    }

    target.observations.push(cell);
    target.lat = target.observations.reduce((s, o) => s + o.center.lat, 0) / target.observations.length;
    target.lon = target.observations.reduce((s, o) => s + o.center.lon, 0) / target.observations.length;
  }

  const merged: MergedCell[] = groups.map((group, index) => {
    const observations = group.observations;
    const radars = [...new Set(observations.map((o) => o.radar))];
    const strongest = observations.reduce((best, o) =>
      o.max_estimated_dbz > best.max_estimated_dbz ? o : best
    );

    const pixelCount = observations.reduce((s, o) => s + o.pixel_count, 0);
    const convectivePixelCount = observations.reduce((s, o) => s + o.convective_pixel_count, 0);
    const redPixels = observations.reduce((s, o) => s + o.red_pixels, 0);
    const magentaPixels = observations.reduce((s, o) => s + o.magenta_pixels, 0);
    const totalArea = observations.reduce((s, o) => s + o.approximate_area_km2, 0);

    const weightedMean = pixelCount > 0
      ? observations.reduce((s, o) => s + o.mean_estimated_dbz * o.pixel_count, 0) / pixelCount
      : strongest.mean_estimated_dbz;

    const cores: MergedCore[] = observations
      .flatMap((observation) => observation.cores.map((core) => ({
        ...core,
        radar: observation.radar,
        radar_name: observation.radar_name,
        timestamp: observation.timestamp,
      })))
      .sort((a, b) => b.max_estimated_dbz - a.max_estimated_dbz || b.pixel_count - a.pixel_count);

    return {
      id: `cell-${String(index + 1).padStart(3, "0")}`,
      lat: group.lat,
      lon: group.lon,
      intensity: strongest.intensity,
      max_estimated_dbz: strongest.max_estimated_dbz,
      mean_estimated_dbz: Number(weightedMean.toFixed(1)),
      radar_count: radars.length,
      radars,
      pixel_count: pixelCount,
      approximate_area_km2: Number(totalArea.toFixed(2)),
      red_pixels: redPixels,
      magenta_pixels: magentaPixels,
      red_fraction: pixelCount > 0 ? Number((redPixels / pixelCount).toFixed(4)) : 0,
      magenta_fraction: pixelCount > 0 ? Number((magentaPixels / pixelCount).toFixed(4)) : 0,
      has_magenta: magentaPixels > 0,
      peak: {
        lat: strongest.peak.lat,
        lon: strongest.peak.lon,
        radar: strongest.radar,
        rgb: strongest.peak_rgb,
        color_class: strongest.peak_color_class,
      },
      core_count: cores.length,
      convective_pixel_count: convectivePixelCount,
      convective_fraction: pixelCount > 0
        ? Number((convectivePixelCount / pixelCount).toFixed(4))
        : 0,
      cores,
      observed_at: latestTimestamp(observations.map((o) => o.timestamp)),
      bbox_geo: unionBbox(observations.map((o) => o.bbox_geo)),
      observations,
    };
  });

  merged.sort((a, b) =>
    b.max_estimated_dbz - a.max_estimated_dbz ||
    b.core_count - a.core_count ||
    b.magenta_pixels - a.magenta_pixels ||
    b.pixel_count - a.pixel_count
  );

  merged.forEach((cell, i) => cell.id = `cell-${String(i + 1).padStart(3, "0")}`);
  return merged;
}

function parseTime(value: string | null | undefined) {
  if (!value) return NaN;

  const normalized = value.includes("T") ? value : value.replace(" ", "T") + "Z";
  return Date.parse(normalized);
}

function latestTimestamp(values: string[]) {
  let best = values[0] ?? new Date().toISOString();
  let bestMs = parseTime(best);
  for (const value of values) {
    const ms = parseTime(value);
    if (Number.isFinite(ms) && (!Number.isFinite(bestMs) || ms > bestMs)) {
      best = value;
      bestMs = ms;
    }
  }
  return best;
}

function unionBbox(boxes: Array<{ north: number; south: number; west: number; east: number }>) {
  if (!boxes.length) return { north: 0, south: 0, west: 0, east: 0 };
  return {
    north: Math.max(...boxes.map((b) => b.north)),
    south: Math.min(...boxes.map((b) => b.south)),
    west: Math.min(...boxes.map((b) => b.west)),
    east: Math.max(...boxes.map((b) => b.east)),
  };
}

function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number) {
  const toRad = (v: number) => v * Math.PI / 180;
  const toDeg = (v: number) => v * 180 / Math.PI;
  const p1 = toRad(lat1);
  const p2 = toRad(lat2);
  const dl = toRad(lon2 - lon1);
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function compassDirection(deg: number) {
  const names = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return names[Math.round(deg / 22.5) % 16];
}

function destinationPoint(lat: number, lon: number, bearing: number, distance: number) {
  const R = 6371;
  const d = distance / R;
  const br = bearing * Math.PI / 180;
  const p1 = lat * Math.PI / 180;
  const l1 = lon * Math.PI / 180;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(br));
  const l2 = l1 + Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return {
    lat: Number((p2 * 180 / Math.PI).toFixed(5)),
    lon: Number((((l2 * 180 / Math.PI + 540) % 360) - 180).toFixed(5)),
  };
}

function bboxIoU(a: StoredCell["bbox_geo"], b: MergedCell["bbox_geo"]) {
  const west = Math.max(a.west, b.west);
  const east = Math.min(a.east, b.east);
  const south = Math.max(a.south, b.south);
  const north = Math.min(a.north, b.north);
  if (east <= west || north <= south) return 0;
  const midLat = (south + north) / 2 * Math.PI / 180;
  const scaleX = Math.max(0.15, Math.cos(midLat));
  const inter = (east - west) * scaleX * (north - south);
  const areaA = Math.max(0, (a.east - a.west) * scaleX * (a.north - a.south));
  const areaB = Math.max(0, (b.east - b.west) * scaleX * (b.north - b.south));
  const union = areaA + areaB - inter;
  return union > 0 ? Math.max(0, Math.min(1, inter / union)) : 0;
}

function similarityRatio(a: number, b: number) {
  const hi = Math.max(Math.abs(a), Math.abs(b), 1e-6);
  return Math.max(0, 1 - Math.abs(a - b) / hi);
}
// Este score decide quão compatíveis duas detecções são ao longo do tempo.
// Os pesos e tolerâncias são heurísticos e precisam ser avaliados: quero saber se distância, área, forma e
// intensidade estão recebendo importância coerente com a evolução real de células convectivas.

function trackingScore(previous: StoredCell, current: MergedCell) {
  const currentMs = parseTime(current.observed_at);
  const previousMs = parseTime(previous.observed_at);
  const elapsedMinutes = (currentMs - previousMs) / 60000;
  const distance = distanceKm(previous.lat, previous.lon, current.lat, current.lon);

  const effectiveMinutes = elapsedMinutes > 0 ? elapsedMinutes : 5;
  let physicalLimit = Math.min(
    TRACKING_CONFIG.maxMatchDistanceKm,
    TRACKING_CONFIG.baseDistanceToleranceKm +
      TRACKING_CONFIG.maxPhysicalSpeedKmh * effectiveMinutes / 60,
  );

  const previousPixels = previous.pixel_count ?? Number.POSITIVE_INFINITY;
  const smallCell =
    current.pixel_count <= TRACKING_CONFIG.smallCellMaxPixels ||
    previousPixels <= TRACKING_CONFIG.smallCellMaxPixels;
  if (smallCell) {
    physicalLimit = Math.min(physicalLimit, TRACKING_CONFIG.smallCellMaxMatchDistanceKm);
  }

  const rejected = (reason: string) => ({
    score: -1,
    elapsedMinutes,
    distance,
    physicalLimit,
    predictedPosition: null as { lat: number; lon: number } | null,
    predictionError: null as number | null,
    directionConsistency: null as number | null,
    speedConsistency: null as number | null,
    structuralConsistency: 0,
    rejectionReason: reason,
  });

  if (!Number.isFinite(elapsedMinutes)) return rejected("invalid_time");
  if (elapsedMinutes > TRACKING_CONFIG.maxPreviousAgeMinutes) return rejected("previous_too_old");
  if (elapsedMinutes < -1) return rejected("current_older_than_previous");
  if (distance > physicalLimit) return rejected("distance_over_physical_limit");

  const areaRatio =
    Math.max(previous.approximate_area_km2, current.approximate_area_km2) /
    Math.max(0.01, Math.min(previous.approximate_area_km2, current.approximate_area_km2));
  const dbzJump = Math.abs(previous.max_estimated_dbz - current.max_estimated_dbz);
  const coreJump = Math.abs(previous.core_count - current.core_count);

  if (areaRatio > TRACKING_CONFIG.maxAreaRatio && distance > 4) {
    return rejected("area_ratio_incompatible");
  }
  if (dbzJump > TRACKING_CONFIG.maxDbzJump && distance > 6) {
    return rejected("dbz_jump_incompatible");
  }
  if (coreJump > TRACKING_CONFIG.maxCoreJump && distance > 6) {
    return rejected("core_jump_incompatible");
  }

  const distanceScore = Math.max(0, 1 - distance / Math.max(1, physicalLimit));
  const areaScore = similarityRatio(previous.approximate_area_km2, current.approximate_area_km2);
  const dbzScore = Math.max(0, 1 - dbzJump / 30);
  const coreScore = Math.max(
    0,
    1 - coreJump / Math.max(3, previous.core_count, current.core_count),
  );
  const overlapScore = bboxIoU(previous.bbox_geo, current.bbox_geo);
  const radarOverlap = previous.radars.some((r) => current.radars.includes(r)) ? 1 : 0;

  let predictedPosition: { lat: number; lon: number } | null = null;
  let predictionError: number | null = null;
  let predictionScore = distanceScore;
  let directionConsistency: number | null = null;
  let speedConsistency: number | null = null;

  const previousSpeed = previous.motion?.speed_kmh;
  const previousBearing = previous.motion?.bearing_deg;

  if (
    elapsedMinutes > 0.25 &&
    previousSpeed !== null && previousSpeed !== undefined &&
    previousBearing !== null && previousBearing !== undefined &&
    previousSpeed >= 0 &&
    previousSpeed <= TRACKING_CONFIG.maxPhysicalSpeedKmh
  ) {
    predictedPosition = destinationPoint(
      previous.lat,
      previous.lon,
      previousBearing,
      previousSpeed * elapsedMinutes / 60,
    );

    predictionError = distanceKm(
      predictedPosition.lat,
      predictedPosition.lon,
      current.lat,
      current.lon,
    );

    const predictedTolerance = Math.min(
      TRACKING_CONFIG.maxPredictionErrorKm,
      TRACKING_CONFIG.predictedBaseToleranceKm +
        Math.max(4, previousSpeed * elapsedMinutes / 60) *
          TRACKING_CONFIG.predictedSpeedToleranceFactor,
    );

    predictionScore = Math.max(
      0,
      1 - predictionError / Math.max(1, predictedTolerance),
    );

    const observedBearing =
      distance > 0.05
        ? bearingDeg(previous.lat, previous.lon, current.lat, current.lon)
        : previousBearing;

    const directionMismatch = angularDifference(previousBearing, observedBearing);
    directionConsistency = Math.max(0, 1 - directionMismatch / 180);

    const observedSpeed =
      elapsedMinutes > 0.25 ? distance / (elapsedMinutes / 60) : previousSpeed;
    const speedMismatch = Math.abs(observedSpeed - previousSpeed);
    speedConsistency = Math.max(
      0,
      1 - speedMismatch / TRACKING_CONFIG.maxPhysicalSpeedKmh,
    );

    if (
      predictionError > TRACKING_CONFIG.maxPredictionErrorKm &&
      distance > TRACKING_CONFIG.baseDistanceToleranceKm
    ) {
      return rejected("prediction_error_too_large");
    }

    if (
      directionMismatch > TRACKING_CONFIG.maxDirectionMismatchDeg &&
      distance > TRACKING_CONFIG.baseDistanceToleranceKm
    ) {
      return rejected("direction_incompatible");
    }

    if (
      speedMismatch > TRACKING_CONFIG.maxSpeedMismatchKmh &&
      distance > TRACKING_CONFIG.baseDistanceToleranceKm
    ) {
      return rejected("speed_incompatible");
    }
  }

  const structuralConsistency =
    areaScore * 0.40 +
    dbzScore * 0.30 +
    coreScore * 0.20 +
    radarOverlap * 0.10;

  let score =
    distanceScore * 0.25 +
    predictionScore * 0.25 +
    areaScore * 0.12 +
    dbzScore * 0.10 +
    coreScore * 0.06 +
    overlapScore * 0.08 +
    radarOverlap * 0.05 +
    (directionConsistency ?? distanceScore) * 0.05 +
    (speedConsistency ?? distanceScore) * 0.04;

  if (areaRatio > 3) score -= 0.10;
  else if (areaRatio > 2) score -= 0.05;

  if (dbzJump > 18) score -= 0.08;
  else if (dbzJump > 12) score -= 0.04;

  if (coreJump > 6) score -= 0.08;
  else if (coreJump > 3) score -= 0.04;

  if (smallCell) score -= TRACKING_CONFIG.smallCellScorePenalty;

  score = Math.max(0, Math.min(1, score));

  return {
    score,
    elapsedMinutes,
    distance,
    physicalLimit,
    predictedPosition,
    predictionError,
    directionConsistency,
    speedConsistency,
    structuralConsistency,
    rejectionReason: null as string | null,
  };
}

function confidenceFromScore(score: number): TrackingConfidence {
  if (score >= TRACKING_CONFIG.highConfidenceScore) return "high";
  if (score >= TRACKING_CONFIG.mediumConfidenceScore) return "medium";
  if (score >= TRACKING_CONFIG.minimumMatchScore) return "low";
  return "none";
}

function trendClass(dbzChange: number, areaPercent: number): TrendClass {
  if (dbzChange >= 5 || areaPercent >= 25) return "intensifying";
  if (dbzChange <= -5 || areaPercent <= -25) return "weakening";
  return "stable";
}

function newTrackingId(cell: MergedCell) {
  const t = Number.isFinite(parseTime(cell.observed_at)) ? parseTime(cell.observed_at) : Date.now();
  const area = cell.radars[0] ?? "xx";
  const random = crypto.randomUUID().replaceAll("-", "").slice(0, 8);
  return `storm-${area}-${Math.floor(t / 1000).toString(36)}-${random}`;
}

function noMatchTracking(cell?: MergedCell): TrackingInfo {
  return {
    matched: false,
    confidence: "none",
    score: null,
    previous_observed_at: null,
    elapsed_minutes: null,
    distance_km: null,
    bearing_deg: null,
    direction: null,
    speed_kmh: null,
    rejected_physical_speed: false,
    trend: {
      classification: "unknown",
      dbz_change: null,
      area_change_km2: null,
      area_change_percent: null,
      core_count_change: null,
    },
    forecast: [],
    smoothed_speed_kmh: null,
    smoothed_bearing_deg: null,
    smoothed_direction: null,
    history_points: 0,
    motion_quality: "unknown",
    direction_change_deg: null,
    speed_change_kmh: null,
    abrupt_motion_change: false,
    forecast_validation: {
      source_observed_at: null, target_minutes: null, actual_elapsed_minutes: null,
      error_km: null, quality: "unknown",
    },
    forecast_validations: [],
    predicted_position: null,
    prediction_error_km: null,
    direction_consistency: null,
    speed_consistency: null,
    structural_consistency: null,
    match_rejection_reason: null,
    forecast_status: "insufficient_history",
    forecast_reason: "new_track",
    track_quality_score: null,
    track_maturity: "new",
    small_cell: cell ? cell.pixel_count <= TRACKING_CONFIG.smallCellMaxPixels : false,
  };
}

function angularDifference(a: number, b: number) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

function circularMean(degrees: number[]) {
  if (!degrees.length) return null;
  let x = 0, y = 0;
  for (const d of degrees) {
    const r = d * Math.PI / 180; x += Math.cos(r); y += Math.sin(r);
  }
  if (Math.abs(x) < 1e-9 && Math.abs(y) < 1e-9) return null;
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}
// Aqui estimo movimento usando o histórico das detecções.
// Quero validar o intervalo temporal necessário, sensibilidade a células que se dividem/fundem e até que ponto
// deslocamento do centroide representa o movimento real da tempestade.

function motionFromHistory(points: HistoryPoint[]) {
  const ordered = [...points].sort((a,b) => parseTime(a.observed_at)-parseTime(b.observed_at));
  const segments: Array<{speed:number;bearing:number}> = [];
  for (let i=1;i<ordered.length;i++) {
    const dt=(parseTime(ordered[i].observed_at)-parseTime(ordered[i-1].observed_at))/60000;
    if (!(dt>0.25)) continue;
    const d=distanceKm(ordered[i-1].lat,ordered[i-1].lon,ordered[i].lat,ordered[i].lon);
    const speed=d/(dt/60);
    if (speed>TRACKING_CONFIG.maxPhysicalSpeedKmh) continue;
    segments.push({speed,bearing:bearingDeg(ordered[i-1].lat,ordered[i-1].lon,ordered[i].lat,ordered[i].lon)});
  }
  const recent=segments.slice(-TRACKING_CONFIG.smoothingMaxSegments);
  if (!recent.length) return {speed:null,bearing:null,segments:0};
  const speed=recent.reduce((a,b)=>a+b.speed,0)/recent.length;
  return {speed, bearing:circularMean(recent.map(x=>x.bearing)), segments:recent.length};
}
// Aqui comparo previsões anteriores com observações posteriores.
// Esta parte pode servir para medir erro do próprio sistema; quero avaliar quais métricas seriam adequadas para
// separar erro de posição, velocidade, evolução de intensidade e nascimento/dissipação de células.

function validatePreviousForecasts(old: StoredCell, current: MergedCell): ForecastValidation[] {

  const legacyRuns: ForecastRun[] = old.forecast?.length
    ? [{ source_observed_at: old.observed_at, forecasts: old.forecast }]
    : [];
  const runs = old.forecast_archive?.length ? old.forecast_archive : legacyRuns;
  const out: ForecastValidation[] = [];

  for (const run of runs) {
    const elapsed = (parseTime(current.observed_at) - parseTime(run.source_observed_at)) / 60000;
    if (!(elapsed > 0) || !Number.isFinite(elapsed)) continue;
    for (const candidate of run.forecasts ?? []) {
      if (Math.abs(candidate.minutes - elapsed) > TRACKING_CONFIG.forecastValidationToleranceMinutes) continue;
      const error = distanceKm(candidate.lat, candidate.lon, current.lat, current.lon);
      const quality = error <= TRACKING_CONFIG.forecastGoodErrorKm
        ? "good"
        : error <= TRACKING_CONFIG.forecastFairErrorKm
        ? "fair"
        : "poor";
      out.push({
        source_observed_at: run.source_observed_at,
        target_minutes: candidate.minutes,
        actual_elapsed_minutes: Number(elapsed.toFixed(2)),
        error_km: Number(error.toFixed(2)),
        quality,
      });
    }
  }
  return out;
}
// Aqui faço a associação temporal das células e produzo continuidade/trajetória.
// É importante revisar casos de split/merge, células novas e desaparecidas para evitar uma trajetória aparentemente
// contínua que na verdade esteja ligando estruturas meteorológicas diferentes.

function applyTemporalTracking(currentCells: MergedCell[], previousState: TrackingState | null) {
  const previous = previousState?.cells ?? [];

  type Candidate = {
    currentIndex: number;
    previousIndex: number;
    score: number;
    elapsedMinutes: number;
    distance: number;
    predictedPosition: { lat: number; lon: number } | null;
    predictionError: number | null;
    directionConsistency: number | null;
    speedConsistency: number | null;
    structuralConsistency: number;
    rejectionReason: string | null;
  };

  const candidates: Candidate[] = [];
  let rejectedCandidates = 0;

  const spatialBin = TRACKING_CONFIG.spatialBinDegrees;
  const spatialIndex = new Map<string, number[]>();
  const binKey = (lat: number, lon: number) =>
    `${Math.floor(lat / spatialBin)}:${Math.floor(lon / spatialBin)}`;

  for (let pi = 0; pi < previous.length; pi++) {
    const key = binKey(previous[pi].lat, previous[pi].lon);
    const bucket = spatialIndex.get(key);
    if (bucket) bucket.push(pi);
    else spatialIndex.set(key, [pi]);
  }

  let spatialCandidatesConsidered = 0;
  let spatialPairsSkipped = 0;

  for (let ci = 0; ci < currentCells.length; ci++) {
    const cell = currentCells[ci];
    const bx = Math.floor(cell.lat / spatialBin);
    const by = Math.floor(cell.lon / spatialBin);
    const nearby = new Set<number>();

    for (let dx = -TRACKING_CONFIG.spatialNeighborBins; dx <= TRACKING_CONFIG.spatialNeighborBins; dx++) {
      for (let dy = -TRACKING_CONFIG.spatialNeighborBins; dy <= TRACKING_CONFIG.spatialNeighborBins; dy++) {
        for (const pi of spatialIndex.get(`${bx + dx}:${by + dy}`) ?? []) nearby.add(pi);
      }
    }

    spatialPairsSkipped += Math.max(0, previous.length - nearby.size);

    for (const pi of nearby) {
      spatialCandidatesConsidered++;
      const c = trackingScore(previous[pi], cell);

      if (c.score >= TRACKING_CONFIG.minimumMatchScore) {
        candidates.push({
          currentIndex: ci,
          previousIndex: pi,
          score: c.score,
          elapsedMinutes: c.elapsedMinutes,
          distance: c.distance,
          predictedPosition: c.predictedPosition,
          predictionError: c.predictionError,
          directionConsistency: c.directionConsistency,
          speedConsistency: c.speedConsistency,
          structuralConsistency: c.structuralConsistency,
          rejectionReason: c.rejectionReason,
        });
      } else if (c.rejectionReason) {
        rejectedCandidates++;
      }
    }
  }

  candidates.sort((a, b) =>
    b.score - a.score ||
    (a.predictionError ?? Infinity) - (b.predictionError ?? Infinity) ||
    a.distance - b.distance
  );

  const usedCurrent = new Set<number>();
  const usedPrevious = new Set<number>();
  const matches = new Map<number, Candidate>();

  for (const c of candidates) {
    if (usedCurrent.has(c.currentIndex) || usedPrevious.has(c.previousIndex)) continue;
    usedCurrent.add(c.currentIndex);
    usedPrevious.add(c.previousIndex);
    matches.set(c.currentIndex, c);
  }

  let matched = 0;
  let newTracks = 0;
  let rejectedPhysicalSpeed = 0;
  let validatedForecasts = 0;
  let goodForecasts = 0;
  let abruptMotionChanges = 0;
  let blockedForecasts = 0;
  let availableForecasts = 0;
  let lowConfidenceMatches = 0;
  const validationErrors: number[] = [];
  const validationByHorizon = new Map<number, number[]>();
  const validationQualityCounts = { good: 0, fair: 0, poor: 0, unknown: 0 };
  let smallCellMatches = 0;
  let smallCellForecastBlocks = 0;

  for (let i = 0; i < currentCells.length; i++) {
    const cell = currentCells[i];
    const match = matches.get(i);

    if (!match) {
      cell.tracking_id = newTrackingId(cell);
      cell.tracking = noMatchTracking(cell);
      newTracks++;
      continue;
    }

    const old = previous[match.previousIndex];
    cell.tracking_id = old.tracking_id;
    matched++;

    const elapsed = match.elapsedMinutes;
    const distance = match.distance;
    const bearing =
      distance > 0.05 ? bearingDeg(old.lat, old.lon, cell.lat, cell.lon) : null;

    let speed = elapsed > 0.25 ? distance / (elapsed / 60) : null;
    let rejected = false;

    if (speed !== null && speed > TRACKING_CONFIG.maxPhysicalSpeedKmh) {
      speed = null;
      rejected = true;
      rejectedPhysicalSpeed++;
    }

    const dbzChange = Number(
      (cell.max_estimated_dbz - old.max_estimated_dbz).toFixed(1),
    );
    const areaChange = Number(
      (cell.approximate_area_km2 - old.approximate_area_km2).toFixed(2),
    );
    const areaPercent =
      old.approximate_area_km2 > 0
        ? Number((areaChange / old.approximate_area_km2 * 100).toFixed(1))
        : 0;

    const currentPoint: HistoryPoint = {
      observed_at: cell.observed_at,
      lat: cell.lat,
      lon: cell.lon,
      max_estimated_dbz: cell.max_estimated_dbz,
      approximate_area_km2: cell.approximate_area_km2,
      core_count: cell.core_count,
    };

    const oldPoint: HistoryPoint = {
      observed_at: old.observed_at,
      lat: old.lat,
      lon: old.lon,
      max_estimated_dbz: old.max_estimated_dbz,
      approximate_area_km2: old.approximate_area_km2,
      core_count: old.core_count,
    };

    const history = [...(old.history ?? []), oldPoint, currentPoint]
      .filter(
        (p, idx, a) =>
          a.findIndex(
            (q) =>
              q.observed_at === p.observed_at &&
              Math.abs(q.lat - p.lat) < 1e-6 &&
              Math.abs(q.lon - p.lon) < 1e-6,
          ) === idx,
      )
      .slice(-TRACKING_CONFIG.historyMaxPoints);

    const smooth = motionFromHistory(history);
    const motionSpeed = smooth.speed ?? speed;
    const motionBearing = smooth.bearing ?? bearing;

    const validations = validatePreviousForecasts(old, cell);
    const validation: ForecastValidation = validations.length
      ? validations.reduce((best, v) =>
          Math.abs((v.target_minutes ?? 0) - (v.actual_elapsed_minutes ?? 0)) <
          Math.abs((best.target_minutes ?? 0) - (best.actual_elapsed_minutes ?? 0)) ? v : best
        )
      : {
          source_observed_at: old.observed_at,
          target_minutes: null,
          actual_elapsed_minutes: Number(elapsed.toFixed(2)),
          error_km: null,
          quality: "unknown",
        };

    if (validations.length) {
      for (const v of validations) {
        if (v.error_km === null) continue;
        validatedForecasts++;
        validationErrors.push(v.error_km);
        validationQualityCounts[v.quality]++;
        if (v.target_minutes !== null) {
          const bucket = validationByHorizon.get(v.target_minutes) ?? [];
          bucket.push(v.error_km);
          validationByHorizon.set(v.target_minutes, bucket);
        }
        if (v.quality === "good") goodForecasts++;
      }
    } else {
      validationQualityCounts.unknown++;
    }

    const directionChange =
      bearing !== null &&
      old.motion?.bearing_deg !== null &&
      old.motion?.bearing_deg !== undefined
        ? angularDifference(old.motion.bearing_deg, bearing)
        : null;

    const speedChange =
      speed !== null &&
      old.motion?.speed_kmh !== null &&
      old.motion?.speed_kmh !== undefined
        ? Math.abs(speed - old.motion.speed_kmh)
        : null;

    const abrupt =
      (directionChange !== null &&
        directionChange >= TRACKING_CONFIG.sharpDirectionChangeDeg) ||
      (speedChange !== null &&
        speedChange >= TRACKING_CONFIG.sharpSpeedChangeKmh);

    if (abrupt) abruptMotionChanges++;

    let motionQuality: "unknown" | "low" | "medium" | "high" = "unknown";
    if (smooth.segments >= 4 && !abrupt) {
      motionQuality = "high";
    } else if (smooth.segments >= 2 && !abrupt) {
      motionQuality = "medium";
    } else if (smooth.segments >= 1) {
      motionQuality = "low";
    }

    let confidence = confidenceFromScore(match.score);
    if (
      abrupt ||
      rejected ||
      (match.predictionError !== null &&
        match.predictionError > TRACKING_CONFIG.forecastFairErrorKm)
    ) {
      if (confidence === "high") confidence = "medium";
      else if (confidence === "medium") confidence = "low";
    }

    if (
      match.directionConsistency !== null &&
      match.directionConsistency < 0.50
    ) {
      confidence = "low";
    }

    if (
      match.structuralConsistency < 0.35 &&
      confidence !== "none"
    ) {
      confidence = "low";
    }

    if (confidence === "low") lowConfidenceMatches++;

    const smallCell = cell.pixel_count <= TRACKING_CONFIG.smallCellMaxPixels ||
      (old.pixel_count ?? Number.POSITIVE_INFINITY) <= TRACKING_CONFIG.smallCellMaxPixels;
    if (smallCell) smallCellMatches++;

    const maturityScore = Math.min(1, history.length / TRACKING_CONFIG.historyMaxPoints);
    const directionScore = match.directionConsistency ?? (smooth.segments >= 2 ? 0.65 : 0.45);
    const speedScore = match.speedConsistency ?? (smooth.segments >= 2 ? 0.65 : 0.45);
    const validationScore = validation.quality === "good" ? 1
      : validation.quality === "fair" ? 0.65
      : validation.quality === "poor" ? 0.20
      : 0.55;
    let trackQualityScore =
      maturityScore * 0.20 +
      Math.max(0, match.score) * 0.20 +
      directionScore * 0.18 +
      speedScore * 0.12 +
      match.structuralConsistency * 0.15 +
      validationScore * 0.15;
    if (abrupt) trackQualityScore -= 0.18;
    if (smallCell) trackQualityScore -= 0.08;
    trackQualityScore = Math.max(0, Math.min(1, trackQualityScore));
    const trackMaturity: "new" | "developing" | "established" =
      history.length >= 6 ? "established" : history.length >= 3 ? "developing" : "new";

    const forecast: ForecastPoint[] = [];
    let forecastStatus: "available" | "blocked" | "insufficient_history";
    let forecastReason: string | null = null;

    const enoughHistory =
      history.length >= TRACKING_CONFIG.forecastMinHistoryPoints &&
      smooth.segments >= 2;

    if (!enoughHistory) {
      forecastStatus = "insufficient_history";
      forecastReason = "need_more_consistent_observations";
    } else if (smallCell) {
      forecastStatus = "blocked";
      forecastReason = "cell_too_small_for_reliable_motion";
      smallCellForecastBlocks++;
    } else if (trackQualityScore < TRACKING_CONFIG.forecastMinTrackQualityScore) {
      forecastStatus = "blocked";
      forecastReason = "track_quality_too_low";
    } else if (rejected) {
      forecastStatus = "blocked";
      forecastReason = "physical_speed_rejected";
    } else if (abrupt) {
      forecastStatus = "blocked";
      forecastReason = "abrupt_motion_change";
    } else if (match.score < TRACKING_CONFIG.forecastMinMatchScore) {
      forecastStatus = "blocked";
      forecastReason = "match_score_too_low";
    } else if (confidence === "none" || confidence === "low") {
      forecastStatus = "blocked";
      forecastReason = "tracking_confidence_too_low";
    } else if (motionQuality === "unknown" || motionQuality === "low") {
      forecastStatus = "blocked";
      forecastReason = "motion_quality_too_low";
    } else if (
      validations.some((v) => v.quality === "poor" && v.error_km !== null)
    ) {
      forecastStatus = "blocked";
      forecastReason = "previous_forecast_validation_poor";
    } else if (
      match.predictionError !== null &&
      match.predictionError > TRACKING_CONFIG.forecastFairErrorKm
    ) {
      forecastStatus = "blocked";
      forecastReason = "prediction_error_too_large";
    } else if (
      motionSpeed === null ||
      motionBearing === null ||
      !(elapsed > 0)
    ) {
      forecastStatus = "blocked";
      forecastReason = "motion_unavailable";
    } else {
      forecastStatus = "available";
      for (const minutes of TRACKING_CONFIG.forecastMinutes) {
        forecast.push({
          minutes,
          ...destinationPoint(
            cell.lat,
            cell.lon,
            motionBearing,
            motionSpeed * minutes / 60,
          ),
        });
      }
    }

    if (forecastStatus === "available") availableForecasts++;
    else blockedForecasts++;

    cell.tracking = {
      matched: true,
      confidence,
      score: Number(match.score.toFixed(3)),
      previous_observed_at: old.observed_at,
      elapsed_minutes: Number(elapsed.toFixed(2)),
      distance_km: Number(distance.toFixed(2)),
      bearing_deg: bearing === null ? null : Number(bearing.toFixed(1)),
      direction: bearing === null ? null : compassDirection(bearing),
      speed_kmh: speed === null ? null : Number(speed.toFixed(1)),
      rejected_physical_speed: rejected,
      trend: {
        classification: trendClass(dbzChange, areaPercent),
        dbz_change: dbzChange,
        area_change_km2: areaChange,
        area_change_percent: areaPercent,
        core_count_change: cell.core_count - old.core_count,
      },
      forecast,
      smoothed_speed_kmh:
        motionSpeed === null ? null : Number(motionSpeed.toFixed(1)),
      smoothed_bearing_deg:
        motionBearing === null ? null : Number(motionBearing.toFixed(1)),
      smoothed_direction:
        motionBearing === null ? null : compassDirection(motionBearing),
      history_points: history.length,
      motion_quality: motionQuality,
      direction_change_deg:
        directionChange === null ? null : Number(directionChange.toFixed(1)),
      speed_change_kmh:
        speedChange === null ? null : Number(speedChange.toFixed(1)),
      abrupt_motion_change: abrupt,
      forecast_validation: validation,
      forecast_validations: validations,

      predicted_position: match.predictedPosition,
      prediction_error_km:
        match.predictionError === null
          ? null
          : Number(match.predictionError.toFixed(2)),
      direction_consistency:
        match.directionConsistency === null
          ? null
          : Number(match.directionConsistency.toFixed(3)),
      speed_consistency:
        match.speedConsistency === null
          ? null
          : Number(match.speedConsistency.toFixed(3)),
      structural_consistency:
        Number(match.structuralConsistency.toFixed(3)),
      match_rejection_reason: null,
      forecast_status: forecastStatus,
      forecast_reason: forecastReason,
      track_quality_score: Number(trackQualityScore.toFixed(3)),
      track_maturity: trackMaturity,
      small_cell: smallCell,
    };
  }

  const sortedErrors = [...validationErrors].sort((a, b) => a - b);
  const percentile = (values: number[], p: number) => {
    if (!values.length) return null;
    const i = Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * p) - 1));
    return Number(values[i].toFixed(2));
  };
  const mean = (values: number[]) => values.length
    ? Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(2))
    : null;
  const byHorizon = Object.fromEntries(
    [...validationByHorizon.entries()].sort((a, b) => a[0] - b[0]).map(([minutes, values]) => {
      const sorted = [...values].sort((a, b) => a - b);
      return [String(minutes), { count: values.length, mean_error_km: mean(values), median_error_km: percentile(sorted, 0.5), p90_error_km: percentile(sorted, 0.9) }];
    }),
  );

  return {
    matched,
    newTracks,
    rejectedPhysicalSpeed,
    previousCells: previous.length,
    validatedForecasts,
    goodForecasts,
    abruptMotionChanges,
    rejectedCandidates,
    blockedForecasts,
    availableForecasts,
    lowConfidenceMatches,
    spatialCandidatesConsidered,
    spatialPairsSkipped,
    smallCellMatches,
    smallCellForecastBlocks,
    validationStats: {
      count: validationErrors.length,
      quality: validationQualityCounts,
      mean_error_km: mean(validationErrors),
      median_error_km: percentile(sortedErrors, 0.5),
      p90_error_km: percentile(sortedErrors, 0.9),
      by_horizon_minutes: byHorizon,
    },
  };
}

function compactState(cells: MergedCell[], previousState: TrackingState | null): TrackingState {
  const previousById = new Map((previousState?.cells ?? []).map((c) => [c.tracking_id, c]));
  return {
    snapshot_at: new Date().toISOString(),
    cells: cells.map((cell) => {
      const id = cell.tracking_id ?? newTrackingId(cell);
      const old = previousById.get(id);
      const point: HistoryPoint = {
        observed_at: cell.observed_at,
        lat: cell.lat,
        lon: cell.lon,
        max_estimated_dbz: cell.max_estimated_dbz,
        approximate_area_km2: cell.approximate_area_km2,
        core_count: cell.core_count,
      };
      const oldPoint: HistoryPoint | null = old ? {
        observed_at: old.observed_at,
        lat: old.lat,
        lon: old.lon,
        max_estimated_dbz: old.max_estimated_dbz,
        approximate_area_km2: old.approximate_area_km2,
        core_count: old.core_count,
      } : null;
      const history = [...(old?.history ?? []), ...(oldPoint ? [oldPoint] : []), point]
        .filter((p, idx, a) => a.findIndex((q) => q.observed_at === p.observed_at) === idx)
        .slice(-TRACKING_CONFIG.historyMaxPoints);

      const nowMs = parseTime(cell.observed_at);
      const priorArchive: ForecastRun[] = old?.forecast_archive?.length
        ? old.forecast_archive
        : (old?.forecast?.length ? [{ source_observed_at: old.observed_at, forecasts: old.forecast }] : []);
      const archive: ForecastRun[] = [];
      for (const run of priorArchive) {
        const elapsed = (nowMs - parseTime(run.source_observed_at)) / 60000;
        if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed > TRACKING_CONFIG.forecastArchiveRetentionMinutes) continue;
        const remaining = (run.forecasts ?? []).filter((f) =>
          elapsed < f.minutes - TRACKING_CONFIG.forecastValidationToleranceMinutes
        );
        if (remaining.length) archive.push({ source_observed_at: run.source_observed_at, forecasts: remaining });
      }
      if (cell.tracking?.forecast?.length) {
        archive.push({ source_observed_at: cell.observed_at, forecasts: cell.tracking.forecast });
      }
      const forecastArchive = archive.slice(-TRACKING_CONFIG.forecastArchiveMaxRuns);

      return {
        tracking_id: id,
        observed_at: cell.observed_at,
        lat: cell.lat,
        lon: cell.lon,
        max_estimated_dbz: cell.max_estimated_dbz,
        mean_estimated_dbz: cell.mean_estimated_dbz,
        approximate_area_km2: cell.approximate_area_km2,
        pixel_count: cell.pixel_count,
        core_count: cell.core_count,
        convective_fraction: cell.convective_fraction,
        radar_count: cell.radar_count,
        radars: cell.radars,
        bbox_geo: cell.bbox_geo,
        history,
        motion: {
          speed_kmh: cell.tracking?.smoothed_speed_kmh ?? cell.tracking?.speed_kmh ?? null,
          bearing_deg: cell.tracking?.smoothed_bearing_deg ?? cell.tracking?.bearing_deg ?? null,
        },
        forecast: cell.tracking?.forecast ?? [],
        forecast_archive: forecastArchive,
      };
    }),
  };
}

function supabaseCredentials() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  return { url, key };
}

async function loadTrackingState(): Promise<TrackingState | null> {
  const credentials = supabaseCredentials();
  if (!credentials) return null;
  const endpoint = `${credentials.url}/rest/v1/${TRACKING_CONFIG.stateTable}?id=eq.${encodeURIComponent(TRACKING_CONFIG.stateId)}&select=snapshot_at,cells&limit=1`;
  const response = await fetch(endpoint, {
    headers: {
      apikey: credentials.key,
      Authorization: `Bearer ${credentials.key}`,
      Accept: "application/json",
    },
  });
  if (!response.ok) throw new Error(`tracking state read HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const rows = await response.json();
  if (!Array.isArray(rows) || !rows.length) return null;
  return {
    snapshot_at: rows[0].snapshot_at,
    cells: Array.isArray(rows[0].cells) ? rows[0].cells : [],
  };
}

async function saveTrackingState(state: TrackingState) {
  const credentials = supabaseCredentials();
  if (!credentials) return false;
  const endpoint = `${credentials.url}/rest/v1/${TRACKING_CONFIG.stateTable}?on_conflict=id`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      apikey: credentials.key,
      Authorization: `Bearer ${credentials.key}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify({
      id: TRACKING_CONFIG.stateId,
      snapshot_at: state.snapshot_at,
      cells: state.cells,
      updated_at: new Date().toISOString(),
    }),
  });
  if (!response.ok) throw new Error(`tracking state write HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  return true;
}

export default {
  async fetch(req: Request) {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (req.method !== "GET") {
      return json({ ok: false, error: "method not allowed" }, 405);
    }

    const started = Date.now();

    try {
      const url = new URL(req.url);
      const latRaw = url.searchParams.get("lat");
      const lonRaw = url.searchParams.get("lon");
      const hasPosition =
        latRaw !== null && lonRaw !== null &&
        Number.isFinite(Number(latRaw)) && Number.isFinite(Number(lonRaw));

      const lat = hasPosition ? Number(latRaw) : null;
      const lon = hasPosition ? Number(lonRaw) : null;
      const radiusRaw = Number(url.searchParams.get("radius") ?? "3");
      const radius = Math.max(0, Math.min(10, Number.isFinite(radiusRaw) ? Math.floor(radiusRaw) : 3));

      const area = (url.searchParams.get("area") ?? "").trim().toLowerCase();
      const limitRaw = Number(url.searchParams.get("limit") ?? "0");
      const limit = Number.isFinite(limitRaw) ? Math.max(0, Math.min(50, Math.floor(limitRaw))) : 0;

      const payload = await fetchJson(RADAR_URL);
      let images: RadarImage[] = Array.isArray(payload?.images) ? payload.images : [];
      const totalRadarImages = images.length;

      if (area) images = images.filter((radar) => radar.area.toLowerCase() === area);
      if (limit > 0) images = images.slice(0, limit);

      if (hasPosition && lat !== null && lon !== null) {
        const selected = images.filter((radar) => contains(radar, lat, lon));
        const results: any[] = [];

        for (const radar of selected) {
          try {
            const decoded = await decodeRadar(radar);
            results.push({
              ok: true,
              area: radar.area,
              radar: radar.radar,
              timestamp: radar.timestamp,
              bounds: radar.bounds,
              width: decoded.width,
              height: decoded.height,
              position: { lat, lon },
              sample: samplePosition(decoded, lat, lon, radius),
            });
          } catch (error) {
            results.push({
              ok: false,
              area: radar.area,
              radar: radar.radar,
              error: String(error),
            });
          }
        }

        return json({
          ok: true,
          engine: "MONI MAXCAPPI Analyzer",
          version: "5.4.0",
          generated: new Date().toISOString(),
          processing_ms: Date.now() - started,
          mode: "position",
          radar_images: totalRadarImages,
          processed_radar_images: images.length,
          selected_radars: selected.length,
          thresholds: {
            cell_min_estimated_dbz: CELL_CONFIG.cellMinDbz,
            core_min_estimated_dbz: CELL_CONFIG.coreMinDbz,
          },
          position: { lat, lon, radius_px: radius },
          results,
        });
      }

      const radarResults: any[] = [];
      const allRadarCells: RadarCell[] = [];

      for (const radar of images) {
        const radarStarted = Date.now();
        try {
          const decoded = await decodeRadar(radar);
          const scan = scanRadarCompact(decoded);

          radarResults.push({
            ok: true,
            area: radar.area,
            radar: radar.radar,
            timestamp: radar.timestamp,
            width: decoded.width,
            height: decoded.height,
            processing_ms: Date.now() - radarStarted,
            meteorological_pixels: scan.meteorological_pixels,
            cell_pixels: scan.cell_pixels,
            convective_pixels: scan.convective_pixels,
            red_pixels: scan.red_pixels,
            magenta_pixels: scan.magenta_pixels,
            estimated_max_dbz: scan.estimated_max_dbz,
            raw_components: scan.raw_components,
            detected_cells: scan.cells,
            detected_cores: scan.detected_cores,
            cells_with_cores: scan.cells_with_cores,
            cells_with_magenta: scan.cells_with_magenta,
            cells: scan.detected_cells,
          });

          allRadarCells.push(...scan.detected_cells);

        } catch (error) {
          radarResults.push({
            ok: false,
            area: radar.area,
            radar: radar.radar,
            processing_ms: Date.now() - radarStarted,
            error: String(error),
          });
        }
      }

      const cells = mergeRadarCells(allRadarCells);

      const trackingEnabled = !area && limit === 0;
      let trackingStateAvailable = false;
      let trackingStateSaved = false;
      let trackingStateError: string | null = null;
      let trackingStats = {
        matched: 0,
        newTracks: cells.length,
        rejectedPhysicalSpeed: 0,
        previousCells: 0,
        validatedForecasts: 0,
        goodForecasts: 0,
        abruptMotionChanges: 0,
        rejectedCandidates: 0,
        blockedForecasts: 0,
        availableForecasts: 0,
        lowConfidenceMatches: 0,
        spatialCandidatesConsidered: 0,
        spatialPairsSkipped: 0,
        smallCellMatches: 0,
        smallCellForecastBlocks: 0,
        validationStats: {
          count: 0,
          quality: { good: 0, fair: 0, poor: 0, unknown: 0 },
          mean_error_km: null,
          median_error_km: null,
          p90_error_km: null,
          by_horizon_minutes: {},
        },
      };

      if (trackingEnabled) {
        try {
          const previousState = await loadTrackingState();
          trackingStateAvailable = previousState !== null;
          trackingStats = applyTemporalTracking(cells, previousState);
          trackingStateSaved = await saveTrackingState(compactState(cells, previousState));
        } catch (error) {
          trackingStateError = String(error);
          console.error("MONI TRACKING STATE:", error);

          for (const cell of cells) {
            if (!cell.tracking_id) cell.tracking_id = newTrackingId(cell);
            if (!cell.tracking) cell.tracking = noMatchTracking(cell);
          }
        }
      } else {
        for (const cell of cells) {
          cell.tracking_id = newTrackingId(cell);
          cell.tracking = noMatchTracking(cell);
        }
      }

      const successful = radarResults.filter((result) => result.ok);
      const failed = radarResults.filter((result) => !result.ok);
      const cellsWithMagenta = cells.filter((cell) => cell.has_magenta);
      const cellsWithCores = cells.filter((cell) => cell.core_count > 0);
      const multiRadarCells = cells.filter((cell) => cell.radar_count > 1);
      const totalCores = cells.reduce((sum, cell) => sum + cell.core_count, 0);

      return json({
        ok: true,
        engine: "MONI MAXCAPPI Analyzer",
        version: "5.4.0",
        generated: new Date().toISOString(),
        processing_ms: Date.now() - started,
        mode: "scan",
        optimization: "compact-typed-arrays-sequential-radars-spatial-gated-quality-tracking-multihorizon-validation",
        radar_images: totalRadarImages,
        processed_radar_images: images.length,
        successful_radars: successful.length,
        failed_radars: failed.length,
        raw_radar_cells: allRadarCells.length,
        detected_cells: cells.length,
        detected_cores: totalCores,
        cells_with_cores: cellsWithCores.length,
        cells_with_magenta: cellsWithMagenta.length,
        multi_radar_cells: multiRadarCells.length,

        tracking: {
          enabled: trackingEnabled,
          state_available: trackingStateAvailable,
          state_saved: trackingStateSaved,
          state_error: trackingStateError,
          previous_cells: trackingStats.previousCells,
          matched_cells: trackingStats.matched,
          new_tracks: trackingStats.newTracks,
          rejected_physical_speed: trackingStats.rejectedPhysicalSpeed,
          validated_forecasts: trackingStats.validatedForecasts,
          good_forecasts: trackingStats.goodForecasts,
          abrupt_motion_changes: trackingStats.abruptMotionChanges,
          rejected_candidates: trackingStats.rejectedCandidates,
          spatial_candidates_considered: trackingStats.spatialCandidatesConsidered,
          spatial_pairs_skipped: trackingStats.spatialPairsSkipped,
          small_cell_matches: trackingStats.smallCellMatches,
          small_cell_forecast_blocks: trackingStats.smallCellForecastBlocks,
          low_confidence_matches: trackingStats.lowConfidenceMatches,
          available_forecasts: trackingStats.availableForecasts,
          blocked_forecasts: trackingStats.blockedForecasts,
          history_max_points: TRACKING_CONFIG.historyMaxPoints,
          max_physical_speed_kmh: TRACKING_CONFIG.maxPhysicalSpeedKmh,
          minimum_match_score: TRACKING_CONFIG.minimumMatchScore,
          forecast_minutes: TRACKING_CONFIG.forecastMinutes,
          forecast_min_track_quality_score: TRACKING_CONFIG.forecastMinTrackQualityScore,
          forecast_validation_tolerance_minutes: TRACKING_CONFIG.forecastValidationToleranceMinutes,
          forecast_archive_retention_minutes: TRACKING_CONFIG.forecastArchiveRetentionMinutes,
          validation_stats: trackingStats.validationStats,
          note: "Nowcast é extrapolação linear do deslocamento observado; não é previsão numérica de tempo.",
        },

        methodology: {
          segmentation: "8-connected components",
          memory_model: "Uint8Array dBZ/class + Int32Array labels/queue; one radar at a time",
          estimated_dbz: true,
          note: "Refletividade estimada pela paleta MAXCAPPI; não é valor bruto fornecido pela API.",
          cell_definition: `Componente conectado com pixels >= ${CELL_CONFIG.cellMinDbz} dBZ estimados.`,
          core_definition: `Componente conectado interno à célula com pixels >= ${CELL_CONFIG.coreMinDbz} dBZ estimados.`,
          cell_minimum_estimated_dbz: CELL_CONFIG.cellMinDbz,
          core_minimum_estimated_dbz: CELL_CONFIG.coreMinDbz,
          cell_minimum_component_pixels: CELL_CONFIG.cellMinPixels,
          core_minimum_component_pixels: CELL_CONFIG.coreMinPixels,
          merge_distance_km: CELL_CONFIG.mergeDistanceKm,
          core_merge_note: "Núcleos não são fundidos entre radares; são preservados com proveniência da observação.",
          temporal_tracking: "Associação 1:1 preditiva com spatial gating antes do score completo; usa distância observada, posição prevista, coerência vetorial, área, dBZ, núcleos, bbox e radares em comum.",
          spatial_gating_note: "O snapshot anterior é indexado em grade geográfica; somente bins vizinhos são avaliados no matching completo.",
          small_cell_note: `Células com <= ${TRACKING_CONFIG.smallCellMaxPixels} pixels recebem matching mais conservador e não geram nowcast até ganharem estrutura espacial confiável.`,
          track_quality_note: "track_quality_score combina maturidade, score de associação, consistência de direção/velocidade, estrutura e validação anterior.",
          motion_note: "Velocidade instantânea usa duas observações; smoothed_speed/bearing usam múltiplos segmentos recentes quando disponíveis.",
          validation_note: "v5.4 preserva múltiplas gerações de forecast e valida separadamente os horizontes 15/30/45/60 min quando a observação entra na janela temporal configurada.",
          nowcast_note: "Projeções 15/30/45/60 min só são emitidas quando tracking e movimento passam pelos filtros de qualidade; continuam sendo extrapolação linear, não previsão determinística.",
          area_note: "A área é aproximada. Em células observadas por múltiplos radares, approximate_area_km2 soma as observações e não representa necessariamente área física exclusiva.",
        },

        summary: {
          extreme: cells.filter((cell) => cell.intensity === "extreme").length,
          severe: cells.filter((cell) => cell.intensity === "severe").length,
          very_strong: cells.filter((cell) => cell.intensity === "very_strong").length,
          strong: cells.filter((cell) => cell.intensity === "strong").length,
          moderate: cells.filter((cell) => cell.intensity === "moderate").length,
          with_cores: cellsWithCores.length,
          total_cores: totalCores,
          with_magenta: cellsWithMagenta.length,
          observed_by_multiple_radars: multiRadarCells.length,
          tracked: cells.filter((cell) => cell.tracking?.matched).length,
          moving_tracks: cells.filter((cell) => cell.tracking?.speed_kmh !== null && cell.tracking?.speed_kmh !== undefined).length,
          intensifying: cells.filter((cell) => cell.tracking?.trend.classification === "intensifying").length,
          weakening: cells.filter((cell) => cell.tracking?.trend.classification === "weakening").length,
        },

        cells,
        radars: radarResults,
      });
    } catch (error) {
      console.error("MAXCAPPI ANALYZER V5.3:", error);
      return json({
        ok: false,
        engine: "MONI MAXCAPPI Analyzer",
        version: "5.4.0",
        generated: new Date().toISOString(),
        processing_ms: Date.now() - started,
        error: String(error),
      }, 503);
    }
  },
};
