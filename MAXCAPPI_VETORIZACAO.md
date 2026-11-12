# MAXCAPPI — vetorização experimental de contornos

**Branch:** `experimento/maxcappi-contornos-vetoriais`  
**Situação:** protótipo, ainda não validado com imagens reais e sem deploy de produção.

## Objetivo

Gerar um conjunto de polígonos a partir da **classificação de cores do PNG** já feita em `maxcappi-analyze.ts`. O algoritmo não recupera refletividade física original, nem substitui a coleta PNG da REDEMET; a imagem continua a ser baixada e decodificada na Edge Function.

A representação retorna anéis de pixels em GeoJSON MultiPolygon; preservei contornos exteriores, regiões separadas e buracos. Com tolerância zero, os contornos são equivalentes à união dos quadrados de pixel por classe (antes de arredondar coordenadas geográficas a seis decimais). Com tolerância positiva, a geometria é aproximada e pode perder detalhes/topologia; usar somente para visualização.

## API

- Consulta original: `GET /functions/v1/maxcappi-analyze` — comportamento anterior mantido.
- Consulta experimental: `GET /functions/v1/maxcappi-analyze?vector=1&area=XX&limit=1`.
- Simplificação opcional: `vector_tolerance=0.5` (pixels, intervalo 0–1; padrão **0**).
- Com `vector=1`, cada item bem-sucedido de `radars[]` inclui `vector`, um objeto `FeatureCollection`.
- Em `vector.features[].properties`: `class_code`, `class_name`, `pixel_area`, `ring_count`, `perimeter_km_approx`, `radar`.
- Em `vector.features[].geometry`: polígonos GeoJSON com ordem **[longitude, latitude]**; buracos mantidos.
- Se a extração de um radar exceder limites de bordas/anéis, esse radar será sinalizado como erro, e os demais continuarão.

**Importante:** a vetorização ainda não é ativada pelo frontend. A função não grava os vetores no banco nem reduz o download do PNG de origem. Também não altera os snapshots `moni_maxcappi_state`. O benefício de tamanho será medido no **payload dos vetores**, comparando-o com PNG/GeoJSON após compressão HTTP. Como `vector=1` adiciona geometria à resposta original, a resposta total pode crescer; para diminuir tráfego será necessário um modo `vector-only` e adaptar o frontend após testes.

## Validação recomendada

1. Executar `deno test maxcappi-vectorize.test.ts` para testar rasterização por área, ilhas, buracos e limites.
2. Executar um radar real com `area` e `limit=1`; medir `processing_ms`, memória, `Content-Length` e bytes comprimidos.
3. Renderizar polígonos na imagem PNG de origem; comparar pixel a pixel e medir IoU por classe.
4. Testar pequenas células, sobreposição diagonal, buracos, áreas de fundo e contornos de imagem.
5. Confirmar projeção do radar e os `bounds`: o mapeamento linear de lat/lon utilizado aqui é uma **aproximação** já presente no analisador, não validação cartográfica.
6. Não usar simplificação > 0 para análise meteorológica sem verificar auto-interseções e erro espacial.

## Fundamento matemático

Contorno de uma região `C`:

```math
L = \\oint_C ds
```

Na grade de pixels, calculo o comprimento aproximado por soma de segmentos, com fator de escala geográfica dependente da latitude:

```math
L \\approx \\sum_{i=1}^{N} \\sqrt{(\\Delta x_i\\,s_x)^2+(\\Delta y_i\\,s_y)^2}
```

Os segmentos gerados originalmente são horizontais/verticais; o armazenamento é pelos vértices, **não** pelo escalar `L`. A área em `pixel_area` é contagem exata dos pixels classificados, não área geodésica.

## Segurança e compatibilidade

- Nenhuma nova credencial.
- Sem alteração de limiares de dBZ, identificação de células, núcleos, merge, tracking ou nowcast.
- Sem migração de banco de dados.
- `vector=1` tem custo adicional de CPU e pode produzir payloads maiores em imagens muito fragmentadas.
- Revisar tempo de execução das Edge Functions e definir tamanho máximo de saída antes de deploy público.
