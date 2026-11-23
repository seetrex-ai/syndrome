# Syndrome — especificación

Las secciones conservan su numeración §1–§8 porque el código las cita como `docs/spec.md §N`.

## 1. Qué es

- **Marca paraguas:** **SEEQuant** (siempre con esas mayúsculas).
- **Producto:** **Syndrome**. En comunicación: "Syndrome by SEEQuant". "Syndrome" es el
  término técnico para la señal que deja un error en un código de corrección.

Syndrome es un visualizador y juego interactivo en el navegador sobre **corrección cuántica
de errores (QEC)** con el **código de superficie rotado**. Mensaje central, el que Google
demostró con Willow (Nature, dic. 2024): **al añadir más cúbits, la tasa de error lógico
baja**, siempre que el hardware esté por debajo del umbral.

**Público:** curiosos, estudiantes, periodistas, formación corporativa y universitaria.
No es una herramienta de investigación (para eso existen Stim, PyMatching, PanQEC, Qsurface). Nada que instalar,
funciona en el móvil, se entiende en 30 segundos.

## 2. Reglas del repositorio

### i18n

- Inglés por defecto, español desde el día 1. Todas las cadenas en
  `src/locales/{en,es}.json` vía `i18next`; añadir un idioma = añadir un fichero.
- **Una URL indexable por idioma** (2026-10-20):
  `/syndrome/` = inglés y `x-default`, `/syndrome/es/` = español, cada una con su HTML
  generado en el build (título, description, canonical, `hreflang`, OG, JSON-LD y
  `<noscript>` desde `meta.*` de los locales). **La ruta manda**; en `/syndrome/`, la
  elección guardada (`syndrome.language`) y luego el idioma del navegador, sin redirigir
  nunca. La detección no guarda nada (`caches: []`): sólo el selector guarda, y cambia la
  URL a la del idioma con `history.replaceState`, sin recargar (se conservan consulta y
  fragmento). «Atrás»/«Adelante» vuelven a detectar. Tabla `LANGUAGE_DIRS` en
  `edge/paths.ts`, con copia atada por test en `src/locale-path.ts`.
- Un test recorre `src/ui` y falla si encuentra texto literal visible fuera de `t()`.

### Reglas duras

1. **Toda cadena de interfaz pasa por i18n.** Texto escrito a mano en un componente es
   un bug, aunque sea "temporal".
2. **El núcleo (`src/core/`) es TypeScript puro**: sin React, sin DOM, sin `window`.
   Debe ejecutarse igual en navegador, Web Worker y Node (tests y validación).
3. **Nada de física sin test.** Un cambio en `src/core/` sin test que lo cubra no se
   integra en `main`.
4. **Las curvas no se tocan.** Si la gráfica estrella no cruza donde dice la referencia,
   la simulación está mal y se arregla la simulación.

## 3. Glosario y convenciones físicas

Fijadas aquí para que código, tests y documentación hablen igual. Cambiarlas exige documentar la
decisión y actualizar tests.

### Vocabulario

- **Tirada** (`shot`): una ejecución Monte Carlo completa: ruido → síndrome →
  decodificación → éxito/fallo. Lo que cuenta el marcador.
- **Ciclo** (`cycle`): una ronda de medición de estabilizadores dentro de una tirada.
  Con ruido *code-capacity* hay un solo ciclo perfecto; con ruido fenomenológico, d ciclos
  con fallos de medición. **No usar "ronda" en código ni en documentación.**
- **Defecto** (`defect`): estabilizador cuyo resultado cambió respecto al esperado.
  **Síndrome**: el conjunto de defectos de una tirada.
- **Medición** (`measurement`, en el visor «lectura»): resultado `s_r` de un estabilizador
  en el ciclo `r` (`s_r = H·C_r ⊕ f_r`; la lectura final, perfecta, es `H·C_cycles`).
  **Detector**: `D_r = s_r ⊕ s_{r−1}` con `s_0 = 0`. En el modelo fenomenológico «defecto»
  = detector encendido; la medición `s_r` nunca se llama síndrome (2026-10-17).
- **Corrección** (`correction`): operador Pauli que propone el decodificador.
  **Operador residual**: error · corrección.
- **Error lógico X**: el operador residual anticommuta con `Z_L` (equivale a `X_L`
  módulo estabilizadores). **Error lógico Z**: anticommuta con `X_L`. **Error lógico**:
  cualquiera de los dos.

### Geometría del código de superficie rotado (distancia d)

- Cúbits de datos `(row, col)` con `row, col ∈ [0, d)`. Total `d²`. `row 0` es el
  borde superior en pantalla; `col 0`, el izquierdo.
- Los cúbits están en los vértices de la rejilla; los estabilizadores de peso 4 son las
  `(d − 1)²` plaquetas interiores. **Coloración fija:** la plaqueta entre filas
  `i, i+1` y columnas `j, j+1` es de tipo **Z si `(i + j)` es par, X si es impar**.
- Estabilizadores de peso 2: son las plaquetas del tablero extendido una fila por
  arriba y por abajo (`i = −1`, `i = d − 1`) que resultan de **tipo X**, y las de una
  columna por la izquierda y la derecha (`j = −1`, `j = d − 1`) que resultan de
  **tipo Z**, con la misma regla de paridad. Resultado: bordes X arriba y abajo, bordes
  Z a izquierda y derecha. Total `d² − 1` estabilizadores, `(d² − 1)/2` de cada tipo.
  Comprobación en d = 3: interiores Z en (0,0) y (1,1), X en (0,1) y (1,0); peso 2: X
  arriba sobre columnas (0,1), X abajo sobre (1,2), Z izquierda sobre filas (1,2), Z
  derecha sobre (0,1).
- **`X_L`**: cadena vertical de X (una columna completa). **`Z_L`**: cadena horizontal
  de Z (una fila completa). Se cruzan en un cúbit y por tanto anticommutan.
- Los estabilizadores Z detectan errores X; los X detectan errores Z. Cada tipo se
  decodifica de forma independiente sobre su propio grafo de defectos.
- **Grafo de defectos para errores X:** nodos = estabilizadores Z; la frontera son los
  bordes X (arriba y abajo), donde una cadena de X termina sin ser detectada. Simétrico
  para errores Z (nodos = estabilizadores X, frontera = bordes Z). En el código planar
  **cualquier subconjunto de estabilizadores es un síndrome válido**: la frontera absorbe
  la paridad.
- **Formulación para Blossom:** la frontera no es un nodo con capacidad 1. Para cada
  defecto `i` se crea un nodo virtual `b_i` con arista `(i, b_i)` de peso igual a la
  distancia mínima de `i` a la frontera; entre nodos virtuales, aristas `(b_i, b_j)` de
  peso 0; entre defectos, aristas de peso igual al camino mínimo en la rejilla (BFS con
  los pesos de abajo). Se empareja el grafo completo así construido.

### Pesos y desempate (afecta a `P_L`)

MWPM no es único: un síndrome puede tener varias correcciones de peso mínimo. **En el
modelo de fase 1 eso no afecta a `P_L`** (teorema de paridad,
2026-10-16): dos correcciones mínimas del mismo tipo difieren en un operador de peso par
con síndrome nulo, y como los estabilizadores tienen peso par y todo lógico puro peso
impar (d impar), difieren en un estabilizador; el veredicto es el mismo. Sí afecta en el
modelo fenomenológico (fase 2). Los pesos genéricos se fijan igualmente, porque hacen
único el emparejamiento que dibuja la interfaz, permiten comparar pesos mínimos con
PyMatching **exactamente** y hacen falta en fase 2. Para que el TS y la referencia Python
computen **el mismo decodificador** son **enteros** definidos sin ningún flotante,
idénticos en ambos lados:

- `top53_q = splitmix64(0x53594E44 + q) >> 11`, con `splitmix64(s)` la primera salida de
  `next()` con estado inicial `s` (es decir, `mix(s + 0x9E3779B97F4A7C15)`), implementado
  idénticamente en TS (`bigint`, sólo en construcción) y Python y cubierto por un vector
  de prueba literal (`q = 0 → 0x62DB0789E75F0E7A`).
- Escala `S = floor((2²⁴ − 1)·1000/1001) = 16 760 454` y peso del cúbit `q` (índice
  `row·d + col`): `W_q = S + floor(top53_q · S / (1000 · 2⁵³))`. Es `w_q = 1 + 10⁻³·u_q`
  con `u_q = top53_q / 2⁵³`, discretizado a 16 760 niveles y escalado para que
  `max W_q ≤ 16 777 215`, el techo de PyMatching (que usa los enteros tal cual y descarta
  en silencio cualquier arista por encima).
- Con `121 · 16 760 < S` (la versión entera de `ε·(número de cúbits) < 1`), el mínimo bajo
  pesos perturbados es también un mínimo bajo pesos uniformes; los 121 `W_q` son distintos.
  Cambiar `S`, el divisor 1000 o la semilla cambia el decodificador: exige documentar la
  decisión, actualizar tests y nueva validación.
- **Pesos por índice de arista (fase 2, modelo fenomenológico; 2026-10-17).** El grafo espacio-temporal usa **la misma fórmula sobre un índice de
  arista**: `W_e = S + floor(top53_e · S / (1000 · 2⁵³))` con `top53_e = splitmix64(0x53594E44
  + e) >> 11` (`edgeWeight(e)` en `src/core/decoder/weights.ts`; `qubitWeight(q) ===
  edgeWeight(q)`). Índice de arista por `(code, cycles)`: espacial `(q, r) → q + n·(r − 1)`;
  temporal `(s, r) → n·cycles + (r − 1)·m + s`, con `s = typeIndex` (el mismo índice para
  los dos tipos: son grafos distintos). Con `cycles = 1` y sin temporales el índice es `q`:
  los pesos de fase 1 son el caso particular. Vector de prueba compartido con Python:
  `W_0 = 16 766 926`, `W_81 = 16 764 263`, `W_343 = 16 770 859`, `W_511 = 16 774 866`,
  `W_1088 = 16 773 412`. Aristas por tipo con `cycles = d`: 39 / 185 / 511 / 1 089 para
  d = 3 / 5 / 7 / 9. Consecuencias: `max W_e ≤ 2²⁴ − 1` sigue valiendo (medido 16 777 201
  sobre 1 089 índices); la garantía «mínimo perturbado = mínimo uniforme» exige `(aristas
  de la corrección)·16 760 < S`, es decir menos de 1 000 aristas: **incondicional hasta
  d = 7 y condicional en d = 9** (1 089 aristas; falla sólo para correcciones que usen
  ≥ 1 000, astronómicamente improbables; d = 9 se permite en el núcleo 3D y no entra en
  la gráfica); y **en 3D no se afirma que los pesos sean distintos** (colisiones medidas:
  0 en d = 3, 2 de 185 en d = 5, 7 de 511 en d = 7, 28 de 1 089 en d = 9): la identidad del
  decodificador TS/Python descansa en los enteros, no en su unicidad. En este modelo **el
  desempate SÍ puede afectar a `P_L`** (dos emparejamientos mínimos pueden diferir en un
  camino frontera-a-frontera con proyección espacial lógica); con pesos enteros casi todos
  distintos los empates exactos entre clases lógicas son raros (medido exhaustivo en d = 3:
  0 síndromes con empate entre clases para `cycles` = 1, 2 y 3; en d ≥ 5 lo acota el fixture
  de veredictos (`docs/validacion/verdicts-phenomenological.json`)) y la comparación con PyMatching sigue siendo estadística para `P_L`
  y exacta para los pesos mínimos.

### Modelo de ruido (fase 1)

**Ruido independiente X/Z, *code-capacity*:** cada cúbit de datos sufre X con
probabilidad `p` y, de forma independiente, Z con probabilidad `p`. Mediciones perfectas,
un ciclo. Es el modelo cuyo umbral MWPM es el ≈10,3 % de la literatura y, con los pesos
de desempate de arriba, el que la referencia Python reproduce con la misma distribución
de correcciones.

- La inyección manual permite X, Z e Y (Y = X·Z) sobre un cúbit concreto.
- **Ruido fenomenológico** (fase 2, implementado en `src/core/noise/phenomenological.ts`
  y `src/core/sim/spacetime-shot.ts`; convención fijada el
  2026-10-17). Una tirada = `cycles` ciclos (por defecto `cycles = d`); en el ciclo
  `r = 1 … cycles`: (1) cada cúbit de datos sufre X con probabilidad `p` y, de forma
  independiente, Z con probabilidad `p`, y los errores se acumulan (`C_r = C_{r−1}·E_r`);
  (2) se miden todos los estabilizadores y cada resultado se invierte con probabilidad
  `q = p`, independiente por estabilizador y ciclo: `s_r = H·C_r ⊕ f_r`. Tras el último
  ciclo, **lectura final perfecta** de los cúbits de datos sin ruido adicional:
  `s_{cycles+1} = H·C_cycles`. Detectores por tipo: `D_r = s_r ⊕ s_{r−1}` con `s_0 = 0`,
  `r = 1 … cycles + 1`, es decir `m·(cycles + 1)` nodos por tipo con índice
  `(r − 1)·m + typeIndex`. Mecanismos de error = aristas del grafo 3D: un error de datos
  `(q, r)`, `r ≤ cycles`, une los ≤ 2 nodos `(r, checks(q))` de la **misma capa** (frontera
  si sólo hay uno); un fallo de medición `(s, r)`, `r ≤ cycles`, une `(r, s)` con
  `(r + 1, s)`. **La capa `cycles + 1` no tiene aristas espaciales** (no hay ruido de datos
  tras la lectura final) y **no hay frontera temporal** (la capa 1 se compara con `s_0 = 0`,
  conocido; la última es perfecta). Corrección = XOR de los cúbits de las aristas
  espaciales del emparejamiento, en cualquier capa, aplicada a `C_cycles`; residual
  `C_cycles·corrección`; veredicto como en fase 1. X y Z se decodifican por separado
  sobre grafos independientes y `P_L = 1 − (1 − P_X)(1 − P_Z)` sigue siendo exacta
  (ruido y fallos de medición independientes por tipo). **Orden de consumo del PRNG**,
  fijado para que `browser-phenomenological.json` sea reproducible: por ciclo, `2n`
  extracciones de datos (X, Z por cúbit, como `sampleNoise`), luego `m` fallos de los
  estabilizadores Z, luego `m` de los X. `q ≠ p` no es parámetro; `cycles ≠ d` sólo existe
  en la API del núcleo (test exacto con `cycles = 1`, que se reduce exactamente al
  decodificador de fase 1 porque la capa perfecta revela los fallos). Umbral asintótico
  ≈3 % (Wang–Harrington–Preskill ≈2,9 %); **para d = 3, 5, 7 los cruces medidos caen por
  debajo y dependen del par: (3, 5) ≈ 2,25 %, (3, 7) ≈ 2,50 %, (5, 7) ≈ 2,85 %**
  (`docs/validacion.md`, referencia PyMatching con 10⁵ tiradas por punto; el núcleo da
  2,24 / 2,50 / 2,82 %), y los textos deben decir «para estos tamaños», nunca el 3 % a secas. La
  convención es una entre varias legítimas (dónde cae el último ruido de datos); cambiarla
  exige documentar la decisión, cambiar `test_intent_spacetime_graph_is_the_error_model`
  y revalidar.
- **Despolarizante** (X, Y, Z con `p/3` cada uno): opcional, fase 2. Su umbral con
  decodificación X/Z independiente es ≈15,5 % de `p`, así que la gráfica debe
  etiquetar siempre qué modelo muestra.
- Ruido a nivel de circuito: fuera de alcance.

### Valores de referencia y tolerancias

- Umbral asintótico MWPM, ruido independiente, mediciones perfectas: **≈10,3 %**.
- **A d = 3, 5, 7 el cruce de curvas no cae exactamente en el umbral** (tamaño finito y
  bordes). Se espera entre el 9 % y el 11 %. El valor exacto para esta geometría lo dicta
  el script de referencia, no la intuición.
- **Criterio de validación estadística** (sección 6). Para cada punto `(d, p)` de la
  malla se calcula `z = (p̂_TS − p̂_ref) / √(σ_TS² + σ_ref²)` con `σ = √(p̂(1 − p̂)/n)`
  (Wald; con ≥ 100 fallos es adecuado). Pasa si **ningún punto tiene `|z| > 3`** y el
  estadístico global `Σz²` sobre los 24 puntos es `< 43` (chi-cuadrado, 24 g.l.,
  `p > 0,01`). Uno o dos puntos entre 2σ y 3σ son esperables, no síntoma. Un criterio
  "todos dentro de 2σ" fallaría dos de cada tres veces con dos simulaciones correctas.
- Willow (Nature 2025, online dic. 2024): factor de supresión Λ ≈ 2,14 entre
  d = 3 → 5 → 7. Es un modelo de ruido distinto al nuestro; se cita como narrativa, no
  como valor a reproducir.

### Métrica del marcador

- `P_L(d, p)` = fracción de tiradas con error lógico (X **o** Z). Es la curva de la
  gráfica estrella. Las curvas X y Z por separado están disponibles como detalle.
- **Eje `P_L` logarítmico.** En lineal la separación sub-umbral, que es el mensaje del
  producto, es invisible por debajo del 5 %.
- Cada punto lleva **intervalo de confianza de Wilson al 95 %**. Un punto con cero
  fallos se dibuja como cota superior (marcador abierto con flecha), nunca como cero.
- **Muestreo adaptativo:** para cada `(d, p)` se simulan tiradas hasta acumular `k ≥ 100`
  fallos lógicos o alcanzar el tope de tiradas del punto. Con parada en `k` fallos el
  estimador `k/N` tiene sesgo ≈ `1/k`; se usa `(k − 1)/(N − 1)` cuando la parada es por
  fallos. Topes: validación en Node, `≥ 100` fallos **y** `≥ 10⁵` tiradas, tope `10⁶`
  (misma regla que la referencia); navegador, lo que quepa en el presupuesto de tiempo
  de la sección 7, mostrando siempre el intervalo real.
- **Curvas base precomputadas:** la app sirve de inicio las curvas ya validadas
  (`docs/validacion/browser.json`), visibles al instante, y las refina en vivo con las
  tiradas del Worker. El usuario nunca mira una gráfica vacía.
- Λ se muestra como `P_L(d) / P_L(d+2)` en el `p` elegido por el usuario, con su
  intervalo propagado.

## 4. Requisitos por fase

### Fase 1 — Prototipo

1. Código de superficie rotado d = 3, 5, 7 (d = 9 si el rendimiento lo permite), con
   detección de errores lógicos X y Z.
2. Inyección de ruido manual y aleatoria (control deslizante de `p`). Manual: cada
   cúbit tiene un estado Pauli `I, X, Z, Y`; **clic alterna la componente X**
   (`I↔X`, `Z↔Y`), **clic largo o clic con modificador alterna la componente Z**
   (`I↔Z`, `X↔Y`). El estado es el producto de ambas componentes.
3. Decodificador MWPM en el navegador en tiempo real, con la corrección mostrada
   visualmente (aristas del emparejamiento y cadenas de corrección).
4. Gráfica estrella: `P_L` frente a `p` para d = 3, 5, 7 en un mismo gráfico, eje
   logarítmico, intervalos de confianza, curvas base precomputadas más refinado en vivo,
   y el modelo de ruido etiquetado.
5. Modo paso a paso: errores → defectos → emparejamiento → corrección → veredicto. Con
   pausa, atrás y repetir.

**Hecho cuando:** todos los tests de la sección 6 pasan; `docs/validacion.md` muestra la
comparación con PyMatching dentro de tolerancia; la gráfica se genera en un móvil de gama
media sin congelar la interfaz; interfaz completa en inglés y español.

### Fase 2 — Versión compartible

6. **Modo reto:** el usuario es el decodificador. Dado un síndrome, dibuja la corrección
   `C` contra reloj; después se muestra la respuesta del algoritmo superpuesta. **Se
   acepta cualquier `C` cuyo residual `E·C` esté en el grupo de estabilizadores**: test
   operativo, `síndrome(E·C) = 0` y `E·C` conmuta con `X_L` y `Z_L`. No se exige
   coincidir con MWPM (varias correcciones de peso mínimo son equivalentes).
   Bonificación si iguala el peso de MWPM. Puntuación, racha, compartir por imagen o por
   URL con el puzle codificado: `d`, modelo y **siempre la máscara de errores** (`2·d²`
   bits en base64url, ≤ 27 caracteres en d = 9); nunca una semilla, que rompería los
   enlaces al cambiar el PRNG.
7. Explicaciones breves y en contexto (qué es un cúbit, qué mide un estabilizador, por
   qué funciona el emparejamiento). Sin muros de texto. Pueden simplificar, nunca mentir.
8. Pulido: animaciones, tema claro/oscuro, *mobile-first*, carga rápida, imagen
   OpenGraph, PWA que funciona sin conexión tras la primera carga.
9. Ruido fenomenológico como modelo seleccionable.

### Fuera de alcance (todas las fases actuales)

Hardware cuántico real; backend y bases de datos; otros códigos (quizá código de repetición
como nivel introductorio, más adelante); ruido a nivel de circuito.

## 5. Arquitectura y stack

### Decisiones cerradas

| Tema | Decisión | Motivo |
|---|---|---|
| Lenguaje y bundler | TypeScript estricto, Vite | Estándar, rápido, sitio estático |
| Interfaz | React 18+ con hooks, sin librería de estado global | Lo más conocido; estado pequeño |
| Núcleo | `src/core/` TS puro, sin dependencias de UI | Testeable y reutilizable en Node y Worker |
| Renderizado | SVG | Interacción y animación fáciles; d = 9 son ~160 nodos, sin problema |
| Simulación masiva | Web Worker con `postMessage` tipado | La interfaz nunca se congela |
| Decodificador | MWPM exacto (Blossom) en TS | Es lo que valida contra PyMatching y lo que da el umbral de la literatura |
| Oráculo del decodificador | DP exacto por máscara de bits para ≤ 12 defectos, sólo en tests | Verifica Blossom sin depender de otra librería |
| Plan B del decodificador | Union-find | Si Blossom no cumple rendimiento; umbral ≈9,9 %, se documentaría |
| Estadística | Wilson 95 %, muestreo adaptativo | La zona sub-umbral exige muchas tiradas |
| i18n | `i18next` + `react-i18next`, `src/locales/{en,es}.json` | Estándar; añadir idioma = añadir fichero |
| PWA | `vite-plugin-pwa` | Sin conexión tras la primera carga |
| Tests | Vitest + `fast-check` (propiedades) | Las invariantes físicas son propiedades, no casos |
| Lint y formato | ESLint + Prettier, configuración por defecto | No se discute estilo |
| Despliegue | **Worker de Cloudflare `syndrome`** con activos estáticos por ruta completa (`dist/syndrome/` = `/syndrome/…`, se sirven antes que el Worker) y un Worker mínimo (`edge/worker.ts`) sólo para lo que no tiene activo: `/syndrome` → `/syndrome/`, `/syndrome/es` → `/syndrome/es/` y `/syndrome/en{,/}` → `/syndrome/` (301; `run_worker_first` = `/syndrome` y `/syndrome/es`), 404 y el origen viejo. Dos rutas en `wrangler.jsonc`: `seequant.app/syndrome*` y el dominio propio `syndrome.seequant.app` (la raíz es de la web de marca desde el 2026-10-20). Previews por rama (2026-10-19) | Cero backend, cero coste, URL por cambio; activos sin invocar el Worker (sin `run_worker_first: true`, que gastaría invocaciones y saltaría `_headers`). El token necesita «Workers Routes: Edit» en la zona. Sustituye a Vercel (2026-10-16) y al sitio en subdominio (2026-10-19) |
| Referencia científica | Python con `uv`, PyMatching + Stim, en `tools/reference/` | Implementaciones canónicas |

Licencia: **AGPL-3.0-only** para todo el repo (`LICENSE`, `package.json`).

Alternativas evaluadas y descartadas: compilar PyMatching a WebAssembly (decodificador
idéntico a la referencia, pero toolchain pesada y sin acceso cómodo a las aristas del
emparejamiento para visualizarlas); Canvas para la rejilla (innecesario a estas
escalas); Svelte (válido, pero React tiene más material).

### Estructura

```
src/
  core/                 # TS puro. Sin imports de React ni DOM.
    lattice/            # Geometría del código rotado, estabilizadores, operadores lógicos
    noise/              # Modelos de ruido (independiente X/Z; fenomenológico en fase 2)
    decoder/            # Grafo de defectos, Blossom, oráculo DP (test only)
    sim/                # Tirada, muestreo adaptativo, estadística (Wilson)
    index.ts            # API pública del núcleo
  worker/               # Envoltorio Web Worker sobre src/core/sim
  ui/                   # React: rejilla SVG, controles, gráfica, modo paso a paso, reto
  locales/              # en.json, es.json
tools/
  reference/            # Python: PyMatching/Stim, genera docs/validacion/*.json
  validate/             # Node: ejecuta src/core en la misma malla y compara con la referencia
docs/                   # Español: spec.md, validacion.md
```

### Marca en el código

Nombre del paquete y título de la app: `syndrome`. "Syndrome by SEEQuant" en pie de
página, OpenGraph y README. Prefijo de claves i18n por pantalla (`grid.`, `chart.`,
`challenge.`, `steps.`).

## 6. La corrección científica no es negociable

Es el principal riesgo. Un error aquí sería vergonzoso en público.

### Tests del código (propiedades, `src/core/lattice`)

Para d ∈ {3, 5, 7} (y 9):

- Hay `d² − 1` estabilizadores, `(d² − 1)/2` de cada tipo.
- Todos los estabilizadores conmutan entre sí.
- `X_L` y `Z_L` conmutan con todos los estabilizadores y anticommutan entre sí.
- El peso mínimo de un operador lógico es exactamente `d` (búsqueda exhaustiva en d = 3,
  comprobación de cota en d ≥ 5).
- Un error dado produce exactamente el síndrome que predice la conmutación.

### Tests del decodificador (`src/core/decoder`)

- Cualquier error de peso 1 se corrige.
- Cualquier error de peso `≤ (d − 1)/2` se corrige (exhaustivo en d = 3 y 5; muestreo
  aleatorio con `fast-check` en d = 7). Garantía válida para MWPM exacto con
  independencia del desempate.
- **Blossom frente al oráculo DP:** para síndromes aleatorios con ≤ 12 defectos
  (cualquier subconjunto de estabilizadores vale como síndrome), el peso del
  emparejamiento de Blossom es igual al del DP exacto por máscara de bits con frontera
  (`f(S) = min[f(S∖i) + b_i, f(S∖{i,j}) + w_ij]`), usando los pesos genéricos. Mil casos
  por distancia.
- **Pesos mínimos frente a PyMatching:** fixture `docs/validacion/min-weights.json` con
  10⁴ síndromes y su peso mínimo según PyMatching con los mismos pesos genéricos; el TS
  debe igualarlo exactamente. Esta comparación no tiene ruido estadístico.
- **Exacto en d = 3:** `P_L` calculada por enumeración de los `2¹⁸` patrones de error
  con el propio decodificador; el estimador Monte Carlo debe caer dentro de su intervalo.
- Una muestra fija de errores de peso mayor que `(d − 1)/2` produce los veredictos
  esperados (algunos corregidos, algunos lógicos), guardada como fixture.
- El emparejamiento devuelto es válido: cada defecto emparejado exactamente una vez o
  con la frontera.
- Vector de prueba de `splitmix64` y de los pesos `w_q` compartido con Python.

### Validación contra la referencia (`tools/`)

1. `tools/reference/run.py` construye la misma geometría y coloración, aplica el mismo
   modelo de ruido y decodifica con PyMatching **con los pesos genéricos de la sección 3**
   para la **malla de validación**: `d ∈ {3, 5, 7}`,
   `p ∈ {0,03; 0,05; 0,07; 0,09; 0,10; 0,11; 0,13; 0,15}`; regla de parada por punto:
   `≥ 100` fallos **y** `≥ 10⁵` tiradas, tope `10⁶`. Escribe
   `docs/validacion/reference.json` (tasa, fallos, tiradas, intervalo, versión de
   PyMatching, semilla) y `min-weights.json`.
2. `tools/validate/run.ts` ejecuta `src/core` en Node sobre la misma malla **con la
   misma regla de parada** y escribe `docs/validacion/browser.json`.
3. `tools/validate/compare.ts` aplica el criterio estadístico de la sección 3
   (`|z| ≤ 3` por punto y `Σz² < 43`), más la igualdad exacta de `min-weights.json`;
   imprime tabla y la vuelca en `docs/validacion.md` con fecha.
4. El cruce de curvas se estima por ajuste local en ambos ficheros y se **documenta**
   como dato informativo (esperado entre 9 % y 11 %); no es criterio pasa/falla, porque
   la malla no tiene resolución para fijarlo a décimas.

5. **Modelo fenomenológico (fase 2).** Los mismos tres
   pasos con `--model phenomenological` en ambos lados, sobre la malla
   `d ∈ {3, 5, 7}`, `p ∈ {0,005; 0,01; 0,015; 0,02; 0,025; 0,03; 0,035; 0,04}`, `cycles = d`
   y la misma regla de parada (aquí `d = 7, p = 0,005` para por fallos y ejercita
   `(k − 1)/(N − 1)` en los dos lados). La referencia decodifica con PyMatching sobre el
   grafo espacio-temporal explícito con los mismos enteros `W_e` y usa **Stim** sólo como
   comprobación: S1, el modelo de error de un circuito escrito desde el texto de la
   sección 3 tiene exactamente las aristas del grafo; S2, su muestreador de detectores
   coincide con el propio; S3, enumeración de los `2¹³` patrones de `cycles = 1`, d = 3
   (`exactProbe.counts`), que el TS debe igualar **exactamente**. Ficheros:
   `{reference,browser,min-weights,verdicts}-phenomenological.json`; los tres de fase 1 no
   se regeneran (sha256 pinzados en `tests/validation/validation-files.test.ts`). Tres
   comparaciones: pesos mínimos 3D exactos (10⁴/10⁴), **veredictos** (10⁴ síndromes
   muestreados por Python: peso igual en todos y paridad lógica de la corrección igual en
   ≥ 9 995, porque el desempate sí afecta aquí; las discrepancias se listan una a una) y
   `P_L` estadística con el criterio de la sección 3. Cruce informativo esperado entre
   2 % y 3 % (medido: (3, 5) ≈ 2,2 %, (3, 7) ≈ 2,5 %, (5, 7) ≈ 2,8 %).

Se repite la validación cada vez que cambie algo en `src/core/`. El comando es uno:
`npm run validate` (los dos modelos; `-- --model independent|phenomenological` para uno).
`validate.yml` lo repite en CI en una matriz por modelo.

### Terminología

Estándar y en inglés en código y UI por defecto: `data qubit`, `ancilla`, `stabilizer`,
`syndrome`, `defect`, `logical operator`, `distance`, `threshold`, `matching`. En las
explicaciones se puede simplificar; nunca decir algo falso.

## 7. Rendimiento

- **Objetivo:** 1 000 tiradas a d = 7 y `p = 0,10` en **< 2 s** en un móvil de gama
  media, dentro del Worker; en portátil, < 300 ms.
- **Medición:** `npm run bench` ejecuta `src/core` en Node y devuelve tiradas/segundo
  por distancia. Se documenta cada vez que cambie el decodificador.
- **Presupuesto de la gráfica estrella en móvil medio:** curvas base precomputadas
  visibles al instante; refinado en vivo con las tres curvas actualizándose en < 10 s y
  completo (todos los puntos con intervalo estrecho o tope alcanzado) en < 60 s. Cada
  punto se dibuja en cuanto tiene datos. El usuario nunca espera a una barra de progreso
  vacía.
- Presupuesto de carga inicial: < 200 kB de JavaScript comprimido antes de la rejilla
  interactiva. La gráfica y el Worker pueden cargarse en diferido.

## 8. Material de referencia

- Google Quantum AI, "Quantum error correction below the surface code threshold",
  Nature 638, 920–926 (2025; online 9 dic. 2024). Λ ≈ 2,14 por salto de distancia. El
  experimento Willow.
- Fowler, Mariantoni, Martinis, Cleland, "Surface codes: Towards practical large-scale
  quantum computation", Phys. Rev. A 86, 032324 (2012). Tutorial canónico.
- Dennis, Kitaev, Landahl, Preskill, "Topological quantum memory", J. Math. Phys. 43,
  4452 (2002). Introduce el decodificador MWPM para el código de superficie y la conexión
  con el modelo de Ising con desorden (umbral óptimo ≈10,9 %).
- Wang, Harrington, Preskill, "Confinement-Higgs transition in a disordered gauge theory
  and the accuracy threshold for quantum memory", Ann. Phys. 303, 31 (2003). Umbrales
  numéricos de MWPM: ≈10,3 % con mediciones perfectas, ≈2,9 % fenomenológico.
- Higgott, "PyMatching: a Python package for decoding quantum codes with minimum-weight
  perfect matching", ACM TQC 3, 16 (2022); Higgott & Gidney, "Sparse Blossom", Quantum 9,
  1600 (2025). Gidney, "Stim: a fast stabilizer circuit simulator", Quantum 5, 497
  (2021).
- Delfosse & Nickerson, "Almost-linear time decoding algorithm for topological codes",
  Quantum 5, 595 (2021; arXiv 2017). Decodificador union-find, plan B.
- Wootton, Decodoku (2016): precedente de "el humano como decodificador".
