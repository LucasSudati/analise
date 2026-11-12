
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


## Equações matemáticas dos algoritmos

As expressões abaixo documentam operações identificadas no código. **Não são uma validação científica** dos limiares ou dos produtos. Constantes e heurísticas precisam ser confrontadas com observações independentes.

### 1. `radar.ts` — aquisição e normalização REDEMET

Esta função é um **proxy**, não um estimador físico de refletividade. Não calcula dBZ nem converte pixels: solicita os produtos, filtra radares e imagens, elimina caminhos repetidos e devolve metadados.

O parâmetro de quantidade de imagens é limitado por:

```math
N = \max\left(1,\min\left(15,\left\lfloor N_{\text{pedido}}\right\rfloor\right)\right)
```

Os limites geográficos, raio e horário são repassados a partir da fonte; **não se deve interpretar o horário de geração da resposta como horário da observação**.

### 2. `maxcappi-analyze.ts` — células, núcleos e nowcast

A função estima refletividade a partir das **cores de uma imagem PNG**, não de valores físicos brutos de radar. Por isso, `estimated_dbz` é uma aproximação dependente da paleta. Alguns trechos fazem interpolação linear entre valores definidos por classe:

```math
\widehat{Z}_{\text{dBZ}} = Z_0 + s\left(Z_1-Z_0\right), \qquad 0 \leq s \leq 1
```

Exemplos presentes na classificação: faixas aproximadas de 30–45, 45–55, 55–65 e 65–75 dBZ, conforme a cor. Os limiares operacionais de segmentação são:

```math
\widehat{Z}_{\text{dBZ}} \geq 30\ \text{dBZ}, \qquad N_{\text{pixels}} \geq 3
```

Para os núcleos convectivos:

```math
\widehat{Z}_{\text{dBZ}} \geq 50\ \text{dBZ}, \qquad N_{\text{pixels}} \geq 2
```

A média aritmética dos valores estimados de refletividade em dBZ, conforme o código, é:

```math
\overline{Z}_{\text{dBZ}} = \frac{1}{N}\sum_{i=1}^{N}\widehat{Z}_{\text{dBZ},i}
```

**Atenção:** a equação anterior representa a média aritmética dos valores estimados em dBZ, como implementado no código. Como dBZ é uma escala logarítmica, essa média não equivale à média física da refletividade. Para obter a média física, primeiro convertem-se os valores para a escala linear e, depois, retorna-se a dBZ:

```math
Z_i = 10^{\widehat{Z}_{\text{dBZ},i}/10}
```

```math
\overline{Z} = \frac{1}{N}\sum_{i=1}^{N} Z_i
```

```math
\overline{Z}_{\text{dBZ, físico}} = 10\log_{10}\left(\overline{Z}\right)
```

Aqui, $Z_i$ representa o fator de refletividade linear (em mm⁶/m³), $N$ é a quantidade de pixels e $\overline{Z}_{\text{dBZ, físico}}$ é o resultado convertido novamente para a escala logarítmica, usando a referência convencional de 1 mm⁶/m³. **Essas três equações descrevem uma alternativa fisicamente adequada para a média, mas não são o cálculo atualmente implementado na função.**

Para distância entre centros geográficos, o código usa a fórmula de Haversine, apresentada em duas etapas.

**Etapa 1 — calcular o parâmetro a:**

```math
a = \sin^2\left(\frac{\Delta\varphi}{2}\right) + \cos\left(\varphi_1\right)\cos\left(\varphi_2\right)\sin^2\left(\frac{\Delta\lambda}{2}\right)
```

**Etapa 2 — calcular a distância:**

```math
d = 2R\operatorname{atan2}\left(\sqrt{a},\sqrt{1-a}\right)
```

Onde $\Delta\varphi = \varphi_2-\varphi_1$, $\Delta\lambda = \lambda_2-\lambda_1$, $R = 6371\ \text{km}$ e os ângulos são expressos em radianos. A equação da distância corresponde à implementação com `Math.atan2` para $0 \leq a \leq 1$, respeitando as limitações de arredondamento numérico.

Nas equações, `φ` e `λ` representam latitude e longitude em radianos. A configuração usa distância de união de **20 km**, velocidade física máxima de **180 km/h** e horizontes de previsão de **15, 30, 45 e 60 minutos**. A extrapolação de posição pode ser expressa genericamente como:

```math
\widehat{\mathbf{p}}\left(t+\Delta t\right) = \mathbf{p}(t) + \widehat{\mathbf{v}}\,\Delta t
```

mas esta última é uma **representação conceitual** do nowcast, não a transcrição integral das regras de associação, suavização e qualidade do rastreamento.

### 3. `glm.ts` — flashes GOES-19

A função lê arquivos `GLM-L2-LCFA` e processa coordenadas e tempos dos flashes. O índice de dia do ano usado para construir os caminhos dos arquivos é:

```math
\mathrm{DOY} = 1 + \left\lfloor\frac{t_{\text{UTC}}-t_{\text{Jan 1, 00:00 UTC}}}{86\,400\,000\ \text{ms}}\right\rfloor
```

Para interpretar a idade de uma detecção no aplicativo, em segundos, usa-se:

```math
\Delta t_{\text{flash}} = \frac{t_{\text{agora}}-t_{\text{flash}}}{1000\ \text{ms/s}}
```

O arquivo GLM descreve **detecções ópticas**; a quantidade de flashes não deve ser interpretada automaticamente como número de descargas nuvem-solo, nem como prova isolada de granizo.

### 4. `hail.ts` — associação espacial STSC, radar e GLM

A distância entre dois pontos geográficos usa Haversine (equação anterior). A distância em uma grade de coordenadas é euclidiana:

```math
d_{\text{grade}} = \sqrt{\left(x_2-x_1\right)^2+\left(y_2-y_1\right)^2}
```

Parâmetros identificados: passo de grade **0,1°**, distância de agrupamento **0,16°**, mínimo de **3 pontos** por agrupamento, raio de associação GLM de **35 km** e limiar de atividade GLM de **2 flashes**. Graus de longitude não equivalem a distância constante em quilômetros: a escala varia aproximadamente com $\cos(\varphi)$.

Esses parâmetros definem **associações heurísticas**, não uma probabilidade calibrada de granizo. A simultaneidade das fontes e a defasagem de cada produto devem ser verificadas.

### 5. `app.js` — integração e visualização (não é Edge Function)

O frontend aplica distância de Haversine, projeção Web Mercator e heurísticas de risco. Na projeção Web Mercator:

```math
x = R\lambda, \qquad y = R\ln\left[\tan\left(\frac{\pi}{4}+\frac{\varphi}{2}\right)\right], \qquad R = 6\,378\,137\ \text{m}
```

Na fusão de evidências, o nível de risco pode ser o **máximo** dos níveis de fontes disponíveis; o índice de confiança apresentado combina suporte ponderado e diversidade de fontes:

```math
C = \min\left(1,\;0.72\cdot\frac{\displaystyle\sum_i w_i\left(\frac{L_i}{3}\right)}{1.8} + 0.28\cdot\min\left(1,\frac{n}{3}\right)\right)
```

Aqui `w_i` é o peso da fonte, `L_i` seu nível (0 a 3), e `n` o número de evidências disponíveis na combinação. **Esse índice é uma pontuação heurística, não uma probabilidade estatística de acerto.**

### 6. `maxcappi-vectorize.ts` — contornos vetoriais experimentais

Na branch `experimento/maxcappi-contornos-vetoriais`, a vetorização opcional transforma classes de pixels PNG em polígonos. O comprimento de uma curva fechada $C$ é expresso pela integral de linha:

```math
L = \\oint_C \\mathrm{d}s
```

Para os vértices consecutivos da borda digital, o perímetro aproximado é:

```math
L \\approx \\sum_{i=1}^{n} \\sqrt{\\left(\\Delta x_i\\,s_x\\right)^2 + \\left(\\Delta y_i\\,s_y\\right)^2}
```

Os fatores $s_x$ e $s_y$ convertem os deslocamentos em pixels para quilômetros, aproximadamente, a partir dos limites geográficos e da latitude média. O último vértice coincide com o primeiro para fechar cada anel. Buracos internos também contribuem para o comprimento total das fronteiras.

A área em pixels é obtida pela contagem dos pixels de cada classe:

```math
A_{\\text{px}} = \\sum_{i=1}^{WH} \\mathbb{1}\\left(c_i = k\\right)
```

Aqui, $W$ e $H$ são a largura e a altura da imagem, $c_i$ é a classe do pixel e $k$ é a classe selecionada. A área em pixels **não equivale automaticamente à área geográfica em km²**.

Esses contornos são aproximações geométricas das classes de cores. Não representam medições físicas independentes de refletividade. A implementação e os testes estão documentados em [MAXCAPPI_VETORIZACAO.md](MAXCAPPI_VETORIZACAO.md).

### Limitações e validação necessária

- Confirmar a relação entre cores PNG e refletividade física do produto MAXCAPPI; registrar versões de paleta.
- Validar área de pixel, distorção geográfica e distância ao radar antes de interpretar áreas em km².
- Avaliar sobreposição temporal entre radar, GLM e satélite; não confundir instante de consulta com instante de medição.
- Comparar detecções e nowcasts com eventos independentes, incluindo falsos positivos, falsos negativos e erro espacial.
- Manter separadas as categorias **observação**, **estimativa**, **heurística** e **alerta oficial**.


---

### Status e atualização do projeto

- **Situação:** Em revisão técnica; métodos meteorológicos ainda exigem validação.
- **Última revisão desta nota:** 12/11/2026.
- **Alteração experimental:** vetorização de contornos documentada nesta branch; testes com radares reais pendentes.

> Esta nota registra a revisão da documentação, não certifica testes nem uma versão estável.
