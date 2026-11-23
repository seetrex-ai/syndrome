# Validación del núcleo frente a PyMatching

> Generado por `npm run validate` (`tools/validate/compare.ts`); no editar a mano. Criterio en `docs/spec.md` §3 y §6; diseño en `tasks/plans/validation.md` y, para el modelo fenomenológico, `tasks/plans/phase2.md` D6–D9.

**Veredicto global: PASA** (2026-10-17T11:08:28.993Z).

- Modelo de fase 1: ruido independiente X/Z: **PASA** (max |z| = 1.55, Σz² = 18.51, pesos mínimos 10000/10000).
- Modelo de fase 2: ruido fenomenológico: **PASA** (max |z| = 2.17, Σz² = 20.34, pesos mínimos 10000/10000, paridad de veredictos 10000/10000).

## Modelo de fase 1: ruido independiente X/Z

**Veredicto: PASA**.

### Qué se compara

- Referencia: `docs/validacion/reference.json`, generada por `tools/reference/run.py` (name pymatching, version 2.4.0, python 3.12.10, numpy 2.5.4, batchShots 100000), semilla base 20261016.
- Núcleo: `docs/validacion/browser.json`, generado por `tools/validate/run.ts` (name syndrome-core, version 0.0.0, node 24), semilla base 20261016; esta ejecución con Node v24.14.1.
- Regla de parada por punto: ≥ 100 fallos y ≥ 100000 tiradas, tope 1000000 (idéntica en ambos ficheros: PASA en metadatos).
- Ruido independiente X/Z, *code-capacity*, un ciclo; pesos genéricos enteros compartidos (`weights`) y geometría de d = 3 y 5 (`geometry`) contrastadas con `src/core`.

### Tabla de la malla (24 puntos)

`z = (p̂_TS − p̂_ref) / √(σ_TS² + σ_ref²)` con `σ² = p̂(1 − p̂)/n`. Intervalos de Wilson al 95 %.

| d | p | k_ref | N_ref | p̂_ref [Wilson 95 %] | k_TS | N_TS | p̂_TS [Wilson 95 %] | z |
|---|---|---|---|---|---|---|---|---|
| 3 | 0.03 | 2859 | 100000 | 0.02859 [0.02758, 0.02964] | 2892 | 100000 | 0.02892 [0.02790, 0.02998] | +0.44 |
| 3 | 0.05 | 7122 | 100000 | 0.07122 [0.06964, 0.07283] | 7138 | 100000 | 0.07138 [0.06980, 0.07299] | +0.14 |
| 3 | 0.07 | 12832 | 100000 | 0.12832 [0.12626, 0.13041] | 12952 | 100000 | 0.12952 [0.12745, 0.13162] | +0.80 |
| 3 | 0.09 | 19171 | 100000 | 0.19171 [0.18928, 0.19416] | 19281 | 100000 | 0.19281 [0.19038, 0.19527] | +0.62 |
| 3 | 0.10 | 22355 | 100000 | 0.22355 [0.22098, 0.22614] | 22569 | 100000 | 0.22569 [0.22311, 0.22829] | +1.15 |
| 3 | 0.11 | 25782 | 100000 | 0.25782 [0.25512, 0.26054] | 25612 | 100000 | 0.25612 [0.25342, 0.25883] | −0.87 |
| 3 | 0.13 | 32163 | 100000 | 0.32163 [0.31874, 0.32453] | 32294 | 100000 | 0.32294 [0.32005, 0.32584] | +0.63 |
| 3 | 0.15 | 38709 | 100000 | 0.38709 [0.38408, 0.39011] | 38868 | 100000 | 0.38868 [0.38566, 0.39171] | +0.73 |
| 5 | 0.03 | 1310 | 100000 | 0.01310 [0.01241, 0.01382] | 1247 | 100000 | 0.01247 [0.01180, 0.01318] | −1.25 |
| 5 | 0.05 | 4856 | 100000 | 0.04856 [0.04725, 0.04991] | 4935 | 100000 | 0.04935 [0.04802, 0.05071] | +0.82 |
| 5 | 0.07 | 11077 | 100000 | 0.11077 [0.10884, 0.11273] | 10954 | 100000 | 0.10954 [0.10762, 0.11149] | −0.88 |
| 5 | 0.09 | 19025 | 100000 | 0.19025 [0.18783, 0.19269] | 18876 | 100000 | 0.18876 [0.18635, 0.19120] | −0.85 |
| 5 | 0.10 | 23580 | 100000 | 0.23580 [0.23318, 0.23844] | 23430 | 100000 | 0.23430 [0.23169, 0.23694] | −0.79 |
| 5 | 0.11 | 27824 | 100000 | 0.27824 [0.27547, 0.28103] | 27691 | 100000 | 0.27691 [0.27415, 0.27969] | −0.66 |
| 5 | 0.13 | 36817 | 100000 | 0.36817 [0.36519, 0.37116] | 36611 | 100000 | 0.36611 [0.36313, 0.36910] | −0.96 |
| 5 | 0.15 | 44844 | 100000 | 0.44844 [0.44536, 0.45152] | 45015 | 100000 | 0.45015 [0.44707, 0.45324] | +0.77 |
| 7 | 0.03 | 539 | 100000 | 0.00539 [0.00495, 0.00586] | 578 | 100000 | 0.00578 [0.00533, 0.00627] | +1.17 |
| 7 | 0.05 | 3141 | 100000 | 0.03141 [0.03035, 0.03251] | 3146 | 100000 | 0.03146 [0.03040, 0.03256] | +0.06 |
| 7 | 0.07 | 9367 | 100000 | 0.09367 [0.09188, 0.09549] | 9223 | 100000 | 0.09223 [0.09045, 0.09404] | −1.11 |
| 7 | 0.09 | 18242 | 100000 | 0.18242 [0.18004, 0.18483] | 18488 | 100000 | 0.18488 [0.18249, 0.18730] | +1.42 |
| 7 | 0.10 | 23745 | 100000 | 0.23745 [0.23482, 0.24010] | 23822 | 100000 | 0.23822 [0.23559, 0.24087] | +0.40 |
| 7 | 0.11 | 29205 | 100000 | 0.29205 [0.28924, 0.29488] | 29266 | 100000 | 0.29266 [0.28985, 0.29549] | +0.30 |
| 7 | 0.13 | 40128 | 100000 | 0.40128 [0.39825, 0.40432] | 39946 | 100000 | 0.39946 [0.39643, 0.40250] | −0.83 |
| 7 | 0.15 | 49690 | 100000 | 0.49690 [0.49380, 0.50000] | 50036 | 100000 | 0.50036 [0.49726, 0.50346] | +1.55 |

### Criterios

| Criterio | Medido | Umbral | Veredicto |
|---|---|---|---|
| Por punto | max \|z\| = 1.55 | \|z\| ≤ 3 | PASA |
| Global | Σz² = 18.51 | < 43 (χ², 24 g.l., p > 0,01) | PASA |
| Referencia frente al exacto de d = 3 | max \|z\| = 1.58, Σz² = 6.14 | \|z\| ≤ 3 y Σz² < 20.1 (8 g.l.) | PASA |
| Pesos mínimos (`min-weights.json`) | 10000/10000 iguales | igualdad exacta | PASA |
| Metadatos (geometría, pesos, regla) | referencia 0 discrepancias, núcleo 0 | 0 | PASA |
| Coherencia interna (estimador, Wilson, X/Z, cota) | referencia 0 discrepancias, núcleo 0 | 0 | PASA |

Informativo: el núcleo frente al exacto de d = 3 da max |z| = 1.57, Σz² = 7.72 (lo cubre ya el test del núcleo).

#### Exacto de d = 3, punto a punto

| p | P_L exacta | p̂_ref | z_ref | p̂_TS | z_TS |
|---|---|---|---|---|---|
| 0.03 | 0.0285728 | 0.02859 | +0.03 | 0.02892 | +0.66 |
| 0.05 | 0.0723699 | 0.07122 | −1.40 | 0.07138 | −1.21 |
| 0.07 | 0.1286506 | 0.12832 | −0.31 | 0.12952 | +0.82 |
| 0.09 | 0.1920715 | 0.19171 | −0.29 | 0.19281 | +0.59 |
| 0.10 | 0.2250624 | 0.22355 | −1.15 | 0.22569 | +0.48 |
| 0.11 | 0.2582899 | 0.25782 | −0.34 | 0.25612 | −1.57 |
| 0.13 | 0.3239722 | 0.32163 | −1.58 | 0.32294 | −0.70 |
| 0.15 | 0.3867135 | 0.38709 | +0.24 | 0.38868 | +1.28 |

### Cruce de curvas (informativo)

Interpolación lineal de `ln P_L` en el intervalo de la malla donde `P_L(d) − P_L(d')` cambia de signo. Esperado entre el 9 % y el 11 % (umbral asintótico ≈ 10,3 %; la malla no tiene resolución para décimas).

- Referencia (3, 5): p* ≈ 0.0913 en [0.09, 0.10] (cruce único)
- Referencia (3, 7): p* ≈ 0.0945 en [0.09, 0.10] (cruce único)
- Referencia (5, 7): p* ≈ 0.0986 en [0.09, 0.10] (cruce único)
- Núcleo (3, 5): p* ≈ 0.0936 en [0.09, 0.10] (cruce único)
- Núcleo (3, 7): p* ≈ 0.0944 en [0.09, 0.10] (cruce único)
- Núcleo (5, 7): p* ≈ 0.0956 en [0.09, 0.10] (cruce único)

### Las curvas no se tocan

Si esta sección dice FALLA, se arregla la simulación (o la referencia, si el fallo está en Python: lo delata el criterio del exacto), nunca los números: `compare.ts` no ajusta, excluye ni repondera ningún punto, y los JSON se regeneran, no se editan (la coherencia interna de cada punto con sus propios recuentos es criterio pasa/falla).

Ningún punto fuera de tolerancia.

### Tiempos

Simulación de la malla en Node v24.14.1: 29.1 s en total (d = 3: 0.6 s; d = 5: 4.2 s; d = 7: 24.3 s).

### Ficheros (sha256)

- `reference.json`: `9c8b09678289285df20062070e4394efdd846df5734b50d7c5a28a6d831d9d2e`
- `browser.json`: `6390b3f2f3c60d25d05176c3e7754cc72565bd9f7fe338a0b8df776d0ca9f98a`
- `min-weights.json`: `cf0e3468e39c52c5350c4207612ad36bfe19c061002d68a6b7f173d2fd856b73`

## Modelo de fase 2: ruido fenomenológico

**Veredicto: PASA**.

### Qué se compara

- Referencia: `docs/validacion/reference-phenomenological.json`, generada por `tools/reference/run.py` (name pymatching, version 2.4.0, python 3.12.10, numpy 2.5.4, batchShots 100000, stim 1.16.0), semilla base 20261016.
- Núcleo: `docs/validacion/browser-phenomenological.json`, generado por `tools/validate/run.ts` (name syndrome-core, version 0.0.0, node 24), semilla base 20261016; esta ejecución con Node v24.14.1.
- Regla de parada por punto: ≥ 100 fallos y ≥ 100000 tiradas, tope 1000000 (idéntica en ambos ficheros: PASA en metadatos).
- Ruido fenomenológico (`docs/spec.md` §3): `cycles = d` ciclos de ruido de datos X/Z con probabilidad `p` por cúbit y fallo de medición con `q = p` por estabilizador, lectura final perfecta, detectores por diferencia; MWPM sobre el grafo espacio-temporal con los pesos enteros por índice de arista (`weights`, con los índices 3D 81, 343, 511 y 1088) y la geometría de d = 3 y 5 contrastadas con `src/core`. La referencia comprueba con Stim que el grafo es el modelo de error del circuito (S1) y que su muestreador coincide con el de Stim (S2).

### Tabla de la malla (24 puntos)

`z = (p̂_TS − p̂_ref) / √(σ_TS² + σ_ref²)` con `σ² = p̂(1 − p̂)/n`. Intervalos de Wilson al 95 %.

| d | p | k_ref | N_ref | p̂_ref [Wilson 95 %] | k_TS | N_TS | p̂_TS [Wilson 95 %] | z |
|---|---|---|---|---|---|---|---|---|
| 3 | 0.005 | 542 | 100000 | 0.00542 [0.00498, 0.00589] | 568 | 100000 | 0.00568 [0.00523, 0.00617] | +0.78 |
| 3 | 0.01 | 2123 | 100000 | 0.02123 [0.02035, 0.02214] | 2089 | 100000 | 0.02089 [0.02002, 0.02179] | −0.53 |
| 3 | 0.015 | 4404 | 100000 | 0.04404 [0.04279, 0.04533] | 4394 | 100000 | 0.04394 [0.04269, 0.04523] | −0.11 |
| 3 | 0.02 | 7297 | 100000 | 0.07297 [0.07137, 0.07460] | 7394 | 100000 | 0.07394 [0.07233, 0.07558] | +0.83 |
| 3 | 0.025 | 10646 | 100000 | 0.10646 [0.10456, 0.10839] | 10808 | 100000 | 0.10808 [0.10617, 0.11002] | +1.17 |
| 3 | 0.03 | 14338 | 100000 | 0.14338 [0.14122, 0.14557] | 14405 | 100000 | 0.14405 [0.14189, 0.14624] | +0.43 |
| 3 | 0.035 | 18291 | 100000 | 0.18291 [0.18053, 0.18532] | 18425 | 100000 | 0.18425 [0.18186, 0.18666] | +0.77 |
| 3 | 0.04 | 22312 | 100000 | 0.22312 [0.22055, 0.22571] | 22354 | 100000 | 0.22354 [0.22097, 0.22613] | +0.23 |
| 5 | 0.005 | 142 | 100000 | 0.00142 [0.00120, 0.00167] | 144 | 100000 | 0.00144 [0.00122, 0.00169] | +0.12 |
| 5 | 0.01 | 1022 | 100000 | 0.01022 [0.00962, 0.01086] | 1066 | 100000 | 0.01066 [0.01004, 0.01132] | +0.97 |
| 5 | 0.015 | 3159 | 100000 | 0.03159 [0.03052, 0.03269] | 3235 | 100000 | 0.03235 [0.03127, 0.03346] | +0.97 |
| 5 | 0.02 | 6632 | 100000 | 0.06632 [0.06479, 0.06788] | 6773 | 100000 | 0.06773 [0.06619, 0.06930] | +1.26 |
| 5 | 0.025 | 11756 | 100000 | 0.11756 [0.11558, 0.11957] | 11857 | 100000 | 0.11857 [0.11658, 0.12059] | +0.70 |
| 5 | 0.03 | 17920 | 100000 | 0.17920 [0.17684, 0.18159] | 17861 | 100000 | 0.17861 [0.17625, 0.18100] | −0.34 |
| 5 | 0.035 | 24526 | 100000 | 0.24526 [0.24260, 0.24794] | 24706 | 100000 | 0.24706 [0.24440, 0.24974] | +0.93 |
| 5 | 0.04 | 31358 | 100000 | 0.31358 [0.31071, 0.31646] | 31479 | 100000 | 0.31479 [0.31192, 0.31768] | +0.58 |
| 7 | 0.005 | 100 | 354045 | 0.00028 [0.00023, 0.00034] | 100 | 484872 | 0.00020 [0.00017, 0.00025] | −2.17 |
| 7 | 0.01 | 398 | 100000 | 0.00398 [0.00361, 0.00439] | 363 | 100000 | 0.00363 [0.00328, 0.00402] | −1.27 |
| 7 | 0.015 | 1797 | 100000 | 0.01797 [0.01716, 0.01881] | 1729 | 100000 | 0.01729 [0.01650, 0.01812] | −1.16 |
| 7 | 0.02 | 5039 | 100000 | 0.05039 [0.04905, 0.05176] | 5101 | 100000 | 0.05101 [0.04966, 0.05239] | +0.63 |
| 7 | 0.025 | 10623 | 100000 | 0.10623 [0.10434, 0.10815] | 10820 | 100000 | 0.10820 [0.10629, 0.11014] | +1.42 |
| 7 | 0.03 | 18745 | 100000 | 0.18745 [0.18504, 0.18988] | 18793 | 100000 | 0.18793 [0.18552, 0.19036] | +0.27 |
| 7 | 0.035 | 28156 | 100000 | 0.28156 [0.27878, 0.28436] | 28354 | 100000 | 0.28354 [0.28075, 0.28634] | +0.98 |
| 7 | 0.04 | 38235 | 100000 | 0.38235 [0.37934, 0.38537] | 38311 | 100000 | 0.38311 [0.38010, 0.38613] | +0.35 |

### Criterios

| Criterio | Medido | Umbral | Veredicto |
|---|---|---|---|
| Por punto | max \|z\| = 2.17 | \|z\| ≤ 3 | PASA |
| Global | Σz² = 20.34 | < 43 (χ², 24 g.l., p > 0,01) | PASA |
| Referencia frente al exacto de cycles = 1 (d = 3, 2¹³ patrones por tipo) | a_w iguales; max \|z\| = 0.90, Σz² = 1.37 | a_w idénticas, \|z\| ≤ 3 y Σz² < 11.3 (3 g.l.) | PASA |
| Pesos mínimos (`min-weights-phenomenological.json`) | 10000/10000 iguales | igualdad exacta | PASA |
| Veredictos (`verdicts-phenomenological.json`) | pesos 10000/10000, paridad lógica 10000/10000 | pesos iguales, paridad ≥ 9995/10000 | PASA |
| Metadatos (geometría, pesos, regla) | referencia 0 discrepancias, núcleo 0 | 0 | PASA |
| Coherencia interna (estimador, Wilson, X/Z, cota) | referencia 0 discrepancias, núcleo 0 | 0 | PASA |

Informativo: el núcleo frente al exacto de cycles = 1 da max |z| = 1.05, Σz² = 2.14 (lo cubre ya el test del núcleo).

#### Exacto de cycles = 1, d = 3 (un ciclo ruidoso y lectura perfecta): 2¹³ patrones por tipo

a_w de la referencia (PyMatching), w = 0 … 13: Z = [0, 0, 18, 128, 389, 705, 888, 828, 582, 326, 158, 60, 13, 1], X = [0, 0, 18, 128, 389, 705, 888, 828, 582, 326, 158, 60, 13, 1]; idénticas a las del núcleo.

| p | P_L exacta | p̂_ref | z_ref | p̂_TS | z_TS |
|---|---|---|---|---|---|
| 0.01 | 0.0034590 | 0.00349 | +0.17 | 0.00328 | −0.96 |
| 0.03 | 0.0285728 | 0.02810 | −0.90 | 0.02802 | −1.05 |
| 0.05 | 0.0723699 | 0.07297 | +0.73 | 0.07210 | −0.33 |

### Cruce de curvas (informativo)

Interpolación lineal de `ln P_L` en el intervalo de la malla donde `P_L(d) − P_L(d')` cambia de signo. Esperado entre el 2 % y el 3 % para estos tamaños (umbral asintótico ≈ 2,9 %; tamaño finito y bordes lo bajan; la malla no tiene resolución para décimas).

- Referencia (3, 5): p* ≈ 0.0225 en [0.02, 0.025] (cruce único)
- Referencia (3, 7): p* ≈ 0.0250 en [0.025, 0.03] (cruce único)
- Referencia (5, 7): p* ≈ 0.0285 en [0.025, 0.03] (cruce único)
- Núcleo (3, 5): p* ≈ 0.0224 en [0.02, 0.025] (cruce único)
- Núcleo (3, 7): p* ≈ 0.0250 en [0.02, 0.025] (cruce único)
- Núcleo (5, 7): p* ≈ 0.0282 en [0.025, 0.03] (cruce único)

### Las curvas no se tocan

Si esta sección dice FALLA, se arregla la simulación (o la referencia, si el fallo está en Python: lo delata el criterio del exacto), nunca los números: `compare.ts` no ajusta, excluye ni repondera ningún punto, y los JSON se regeneran, no se editan (la coherencia interna de cada punto con sus propios recuentos es criterio pasa/falla).

Ningún punto fuera de tolerancia.

### Tiempos

Simulación de la malla en Node v24.14.1: 320.9 s en total (d = 3: 2.6 s; d = 5: 28.7 s; d = 7: 289.2 s).

### Ficheros (sha256)

- `reference-phenomenological.json`: `aa590936ad1a5547b9d84476a5ac01937d65f13470931f09dc4404d7363137d0`
- `browser-phenomenological.json`: `40943800050284d34036006164657bb09077f7bffe7d3c7a10fd315e32594720`
- `min-weights-phenomenological.json`: `36978b974f4301e501c64143666397cda74c3e5026f66caad9214444b06d84ce`
- `verdicts-phenomenological.json`: `dd010d16c1c9ff776e65e6f95942f82cb85a7a67a19ebd925c32d45be3c20373`

