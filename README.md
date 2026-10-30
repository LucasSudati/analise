
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
N = \max\left(1,\min\left(15,\lfloor N_{\mathrm{pedido}}\rfloor\right)\right)
```

Os limites geográficos, raio e horário são repassados a partir da fonte; **não se deve interpretar o horário de geração da resposta como horário da observação**.

### 2. `maxcappi-analyze.ts` — células, núcleos e nowcast

A função estima refletividade a partir das **cores de uma imagem PNG**, não de valores físicos brutos de radar. Por isso, `estimated_dbz` é uma aproximação dependente da paleta. Alguns trechos fazem interpolação linear entre valores definidos por classe:

```math
\widehat Z_{\mathrm{dBZ}} = Z_0 + s\,(Z_1-Z_0), \qquad 0\leq s\leq1
```

Exemplos presentes na classificação: faixas aproximadas de 30–45, 45–55, 55–65 e 65–75 dBZ, conforme a cor. Os limiares operacionais de segmentação são:

```math
\mathrm{c\acute{e}lula}:\ \widehat Z\geq30\ \mathrm{dBZ},\ N_{px}\geq3;
\qquad
\mathrm{n\acute{u}cleo}:\ \widehat Z\geq50\ \mathrm{dBZ},\ N_{px}\geq2.
```

A média de refletividade estimada dos pixels de uma região é:

```math
\overline{Z}_{\mathrm{dBZ}}=\frac{1}{N}\sum_{i=1}^{N}\widehat Z_i.
```

**Atenção:** essa é uma média aritmética de valores em dBZ, não uma média física de refletividade linear. A conversão física usual seria `Z_i=10^(dBZ_i/10)`, seguida de média no domínio linear e reconversão por `10 log10`.

Para distância entre centros geográficos, o código usa a fórmula de Haversine:

```math
a=\sin^2\!\left(\frac{\Delta\varphi}{2}\right)+\cos\varphi_1\cos\varphi_2\sin^2\!\left(\frac{\Delta\lambda}{2}\right),
\qquad d=2R\operatorname{atan2}(\sqrt a,\sqrt{1-a}),\ R=6371\ \mathrm{km}.
```

`\varphi` e `\lambda` são latitude e longitude em radianos. A configuração usa distância de união de **20 km**, velocidade física máxima de **180 km/h** e horizontes de previsão de **15, 30, 45 e 60 minutos**. A extrapolação de posição pode ser expressa genericamente como:

```math
\widehat{\mathbf p}(t+\Delta t)=\mathbf p(t)+\widehat{\mathbf v}\,\Delta t,
```

mas esta última é uma **representação conceitual** do nowcast, não a transcrição integral das regras de associação, suavização e qualidade do rastreamento.

### 3. `glm.ts` — flashes GOES-19

A função lê arquivos `GLM-L2-LCFA` e processa coordenadas e tempos dos flashes. O índice de dia do ano usado para construir os caminhos dos arquivos é:

```math
\mathrm{DOY}=\left\lfloor\frac{t_{UTC}-t_{\mathrm{in\acute{i}cio\ do\ ano}}}{86400000\ \mathrm{ms}}\right\rfloor.
```

A idade de uma detecção, quando comparada ao relógio atual, é:

```math
\Delta t_{\mathrm{flash}}=\frac{t_{\mathrm{agora}}-t_{\mathrm{flash}}}{1000}\ \mathrm{s}.
```

O arquivo GLM descreve **detecções ópticas**; a quantidade de flashes não deve ser interpretada automaticamente como número de descargas nuvem-solo, nem como prova isolada de granizo.

### 4. `hail.ts` — associação espacial STSC, radar e GLM

A distância entre dois pontos geográficos usa Haversine (equação anterior). A distância em uma grade de coordenadas é euclidiana:

```math
d_{\mathrm{grade}}=\sqrt{(x_2-x_1)^2+(y_2-y_1)^2}.
```

Parâmetros identificados: passo de grade **0,1°**, distância de agrupamento **0,16°**, mínimo de **3 pontos** por agrupamento, raio de associação GLM de **35 km** e limiar de atividade GLM de **2 flashes**. Graus de longitude não equivalem a distância constante em quilômetros: a escala varia aproximadamente com `cos(latitude)`.

Esses parâmetros definem **associações heurísticas**, não uma probabilidade calibrada de granizo. A simultaneidade das fontes e a defasagem de cada produto devem ser verificadas.

### 5. `app.js` — integração e visualização (não é Edge Function)

O frontend aplica distância de Haversine, projeção Web Mercator e heurísticas de risco. Na projeção Web Mercator:

```math
x=R\lambda,\qquad y=R\ln\tan\left(\frac{\pi}{4}+\frac{\varphi}{2}\right),\quad R=6378137\ \mathrm{m}.
```

Na fusão de evidências, o nível de risco pode ser o **máximo** dos níveis de fontes disponíveis; o índice de confiança apresentado combina suporte ponderado e diversidade de fontes:

```math
C=\min\left(1,\;0.72\frac{\sum_i w_i(L_i/3)}{1.8}+0.28\min\left(1,\frac{n}{3}\right)\right).
```

Aqui `w_i` é o peso da fonte, `L_i` seu nível (0 a 3), e `n` o número de evidências disponíveis na combinação. **Esse índice é uma pontuação heurística, não uma probabilidade estatística de acerto.**

### Limitações e validação necessária

- Confirmar a relação entre cores PNG e refletividade física do produto MAXCAPPI; registrar versões de paleta.
- Validar área de pixel, distorção geográfica e distância ao radar antes de interpretar áreas em km².
- Avaliar sobreposição temporal entre radar, GLM e satélite; não confundir instante de consulta com instante de medição.
- Comparar detecções e nowcasts com eventos independentes, incluindo falsos positivos, falsos negativos e erro espacial.
- Manter separadas as categorias **observação**, **estimativa**, **heurística** e **alerta oficial**.


---

### Status e atualização do projeto

- **Situação:** Em revisão técnica; métodos meteorológicos ainda exigem validação.
- **Última revisão desta nota:** 29/10/2026.
- **Última alteração do código:** não verificada nesta revisão; consulte o histórico de commits para a data exata.

> Esta nota registra a revisão da documentação, não certifica testes nem uma versão estável.
