
Este pacote contém os mesmos arquivos enviados para revisão, com comentários
voltados a explicar o funcionamento do código.

## Arquivos

- `app.js` — interface principal, integração das fontes e heurísticas do ponto.
- `radar.ts` — proxy/normalização dos produtos REDEMET.
- `maxcappi-analyze.ts` — leitura da paleta MAXCAPPI, células, núcleos, merge,
  tracking e nowcast.
- `hail.ts` — correlação STSC + radar + GLM.
- `glm.ts` — leitura dos flashes GOES-19 GLM.


# Revisão meteorológica

Comentei os arquivos para facilitar. Não quero que os comentários sejam
tomados como justificativa dos métodos: eles marcam justamente os pontos em que preciso de avaliação meteorológica.

## O que eu gostaria que fosse revisado

- se os produtos/fontes estão sendo interpretados corretamente;
- resolução e defasagem temporal entre radar, GLM, satélite e modelo;
- resolução espacial, projeções, área de pixel e distância ao radar;
- limiares de refletividade, área, distância e tempo;
- identificação, união e rastreamento de células;
- associação entre atividade elétrica e células;
- critérios usados na estimativa de granizo;
- combinação de evidências no indicador de risco;
- situações que podem produzir falso positivo ou falso negativo;
- quais resultados podem ser mostrados como observação, estimativa, tendência ou apenas heurística experimental.

A prioridade é identificar onde o método precisa de calibração, validação com casos reais ou mudança de abordagem.
