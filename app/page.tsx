"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { getAllItems } from "./data/items"
import type { Item } from "./data/items"

type ApiRow = {
  item_id: string
  city: string
  sell_price_min: number
  sell_price_min_date?: string
  buy_price_max: number
  buy_price_max_date?: string
}

type Confidence = "Alta" | "Media" | "Baja"

type ResultItem = {
  id: string
  displayName: string
  buy: number
  city: string
  cityUpdated?: string

  bmRaw: number
  bmSafe: number
  bmUpdated?: string

  grossProfit: number
  safeProfit: number

  score: number
  confidence: Confidence
  suspicious: boolean

  tier: number
  enchant: number
}

type Filters = {
  category: string
  minTier: number
  maxTier: number
  maxEnchant: number
  maxBuyPrice: number
  minProfit: number
}

const TAX_RATE = 0.065
const MAX_PRICE_AGE_MINUTES = 12
const AUTO_REFRESH_MS = 120000
const CHUNK_SIZE = 35
const TOP_LIMIT = 30
const SEARCH_LIMIT = 50
const CACHE_TTL_MS = 60000
const BM_SAFETY_FACTOR = 1

export default function Home() {
  const [items, setItems] = useState<Item[]>([])
  const [query, setQuery] = useState("")
  const [topResults, setTopResults] = useState<ResultItem[]>([])
  const [searchResults, setSearchResults] = useState<ResultItem[]>([])
  const [loadingTop, setLoadingTop] = useState(false)
  const [loadingSearch, setLoadingSearch] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [apiWarning, setApiWarning] = useState("")

  const [filters, setFilters] = useState<Filters>({
    category: "all",
    minTier: 4,
    maxTier: 6,
    maxEnchant: 2,
    maxBuyPrice: 1500000,
    minProfit: 20000,
  })

  const refreshRef = useRef<NodeJS.Timeout | null>(null)
  const cacheRef = useRef<Record<string, { timestamp: number; data: ResultItem[] }>>({})

  useEffect(() => {
    async function load() {
      try {
        const all = await getAllItems()
        setItems(all)
      } catch (error) {
        console.error("Error cargando items:", error)
      } finally {
        setLoaded(true)
      }
    }

    load()
  }, [])

  const itemMap = useMemo(() => {
    const map: Record<string, Item> = {}
    for (const item of items) {
      map[item.id] = item
    }
    return map
  }, [items])

  function normalizeText(text: string) {
    return text
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
  }

  function getTierFromId(id: string) {
    const match = id.match(/^T(\d+)_/)
    return match ? Number(match[1]) : 0
  }

  function getEnchantFromId(fullId: string) {
    const [, enchantPart] = fullId.split("@")
    return Number(enchantPart || "0")
  }

  function getDisplayName(fullId: string) {
    const [baseId, enchantPart] = fullId.split("@")
    const enchant = Number(enchantPart || "0")
    const item = itemMap[baseId]
    const baseName = item?.name || baseId
    return enchant > 0 ? `${baseName} .${enchant}` : baseName
  }

  function getCategoryFromId(id: string) {
    if (id.includes("SWORD")) return "swords"
    if (id.includes("AXE")) return "axes"
    if (id.includes("MACE")) return "maces"
    if (id.includes("HAMMER")) return "hammers"
    if (id.includes("DAGGER")) return "daggers"
    if (id.includes("BOW")) return "bows"
    if (id.includes("CROSSBOW")) return "crossbows"
    if (id.includes("SPEAR")) return "spears"
    if (id.includes("QUARTERSTAFF")) return "quarterstaffs"
    if (id.includes("FIRESTAFF")) return "fire"
    if (id.includes("FROSTSTAFF")) return "frost"
    if (id.includes("HOLYSTAFF")) return "holy"
    if (id.includes("ARCANESTAFF")) return "arcane"
    if (id.includes("CURSEDSTAFF")) return "cursed"
    if (id.includes("NATURESTAFF")) return "nature"
    if (id.includes("OFF_")) return "offhands"
    return "other"
  }

  function isRecent(dateString?: string, maxMinutes = MAX_PRICE_AGE_MINUTES) {
    if (!dateString) return false
    const updatedAt = new Date(dateString).getTime()
    if (Number.isNaN(updatedAt)) return false
    const diffMinutes = (Date.now() - updatedAt) / 1000 / 60
    return diffMinutes <= maxMinutes
  }

  function minutesAgo(dateString?: string) {
    if (!dateString) return "sin fecha"
    const updatedAt = new Date(dateString).getTime()
    if (Number.isNaN(updatedAt)) return "sin fecha"
    const diff = Math.floor((Date.now() - updatedAt) / 1000 / 60)
    return diff <= 0 ? "hace 0 min" : `hace ${diff} min`
  }

  function formatCompact(n: number) {
    return n.toLocaleString()
  }

  function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  async function safeFetchPrices(ids: string[]): Promise<ApiRow[]> {
    const url = `https://west.albion-online-data.com/api/v2/stats/prices/${ids.join(",")}?locations=Black%20Market,Bridgewatch,Fort%20Sterling,Lymhurst,Martlock,Thetford&qualities=1`

    try {
      const res = await fetch(url, { cache: "no-store" })
      const text = await res.text()

      if (!res.ok) {
        setApiWarning("La API devolvió un error temporal. Intenta de nuevo en unos segundos.")
        return []
      }

      const trimmed = text.trim()
      if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) {
        setApiWarning("La API de Albion está limitando peticiones. Espera unos segundos.")
        return []
      }

      const parsed = JSON.parse(trimmed)
      return Array.isArray(parsed) ? parsed : []
    } catch (error) {
      console.error("Error consultando API:", error)
      setApiWarning("No se pudo consultar la API en este momento.")
      return []
    }
  }

  function buildIds(baseItems: Item[], maxEnchant: number) {
    const ids: string[] = []

    for (const item of baseItems) {
      for (let ench = 0; ench <= maxEnchant; ench++) {
        ids.push(`${item.id}${ench > 0 ? `@${ench}` : ""}`)
      }
    }

    return ids
  }

  function itemMatchesFilters(item: Item, currentFilters: Filters) {
    const tier = getTierFromId(item.id)
    const category = getCategoryFromId(item.id)

    if (tier < currentFilters.minTier || tier > currentFilters.maxTier) {
      return false
    }

    if (currentFilters.category !== "all" && category !== currentFilters.category) {
      return false
    }

    return true
  }

  function getBmReferencePrice(bm: ApiRow) {
  return bm.buy_price_max && bm.buy_price_max > 0 ? bm.buy_price_max : 0
  }

  function isSuspicious(args: {
    buy: number
    bmRaw: number
    grossProfit: number
    safeProfit: number
    tier: number
    enchant: number
  }) {
    if (args.buy <= 0 || args.bmRaw <= 0) return true
    if (args.bmRaw > args.buy * 2.2) return true
    if (args.grossProfit > args.buy * 0.8) return true
    if (args.tier >= 7 && args.enchant >= 2) return true
    if (args.enchant >= 3) return true
    if (args.safeProfit <= 0) return true
    return false
  }

  function computeScore(args: {
    safeProfit: number
    buy: number
    tier: number
    enchant: number
    cityFresh: boolean
    bmFresh: boolean
    suspicious: boolean
  }) {
    let score = 0

    score += args.safeProfit / 1000

    if (args.buy <= 300000) score += 35
    else if (args.buy <= 700000) score += 25
    else if (args.buy <= 1500000) score += 10
    else score -= 20

    if (args.tier === 4) score += 20
    else if (args.tier === 5) score += 18
    else if (args.tier === 6) score += 12
    else if (args.tier === 7) score -= 10
    else if (args.tier === 8) score -= 20

    if (args.enchant === 0) score += 25
    else if (args.enchant === 1) score += 16
    else if (args.enchant === 2) score += 6
    else if (args.enchant === 3) score -= 20
    else if (args.enchant === 4) score -= 35

    if (args.cityFresh) score += 12
    if (args.bmFresh) score += 12

    if (args.suspicious) score -= 80

    return Math.round(score)
  }

  function getConfidence(score: number, safeProfit: number, suspicious: boolean): Confidence {
    if (suspicious) return "Baja"
    if (score >= 140 && safeProfit >= 80000) return "Alta"
    if (score >= 80 && safeProfit >= 40000) return "Media"
    return "Baja"
  }

  function getCacheKey(kind: string, payload: object) {
    return `${kind}:${JSON.stringify(payload)}`
  }

  async function fetchBestProfits(baseItems: Item[], currentFilters: Filters) {
    const cacheKey = getCacheKey("scan", {
      ids: baseItems.map((i) => i.id),
      currentFilters,
    })

    const cached = cacheRef.current[cacheKey]
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return cached.data
    }

    const ids = buildIds(baseItems, currentFilters.maxEnchant)
    const bestByItem: Record<string, ResultItem> = {}
    let hadThrottle = false

    for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
      const chunk = ids.slice(i, i + CHUNK_SIZE)
      const data = await safeFetchPrices(chunk)

      if (data.length === 0) {
        hadThrottle = true
        await sleep(2000)
        continue
      }

      const grouped: Record<string, ApiRow[]> = {}

      for (const row of data) {
        if (!grouped[row.item_id]) {
          grouped[row.item_id] = []
        }
        grouped[row.item_id].push(row)
      }

      for (const itemID in grouped) {
        const rows = grouped[itemID]
        const tier = getTierFromId(itemID)
        const enchant = getEnchantFromId(itemID)

        const bm = rows.find(
          (r) =>
            r.city === "Black Market" &&
            getBmReferencePrice(r) > 0 &&
            isRecent(r.buy_price_max_date || r.sell_price_min_date)
        )

        if (!bm) continue

        const bmRaw = getBmReferencePrice(bm)
        const bmSafe = Math.floor(bmRaw * BM_SAFETY_FACTOR)

        let bestCandidate: ResultItem | null = null

        for (const row of rows) {
          if (row.city === "Black Market") continue
          if (row.sell_price_min <= 0) continue
          if (!isRecent(row.sell_price_min_date)) continue
          if (row.sell_price_min > currentFilters.maxBuyPrice) continue

          const grossTax = bmRaw * TAX_RATE
          const grossProfit = Math.round(bmRaw - row.sell_price_min - grossTax)

          const safeTax = bmSafe * TAX_RATE
          const safeProfit = Math.round(bmSafe - row.sell_price_min - safeTax)

          if (safeProfit < currentFilters.minProfit) continue

          const suspicious = isSuspicious({
            buy: row.sell_price_min,
            bmRaw,
            grossProfit,
            safeProfit,
            tier,
            enchant,
          })

          const score = computeScore({
            safeProfit,
            buy: row.sell_price_min,
            tier,
            enchant,
            cityFresh: isRecent(row.sell_price_min_date),
            bmFresh: isRecent(bm.buy_price_max_date || bm.sell_price_min_date),
            suspicious,
          })

          const confidence = getConfidence(score, safeProfit, suspicious)

          const candidate: ResultItem = {
            id: itemID,
            displayName: getDisplayName(itemID),
            buy: row.sell_price_min,
            city: row.city,
            cityUpdated: row.sell_price_min_date,

            bmRaw,
            bmSafe,
            bmUpdated: bm.buy_price_max_date || bm.sell_price_min_date,

            grossProfit,
            safeProfit,

            score,
            confidence,
            suspicious,

            tier,
            enchant,
          }

          if (!bestCandidate || candidate.score > bestCandidate.score) {
            bestCandidate = candidate
          }
        }

        if (!bestCandidate) continue

        const current = bestByItem[itemID]
        if (!current || bestCandidate.score > current.score) {
          bestByItem[itemID] = bestCandidate
        }
      }

      await sleep(600)
    }

    const finalData = Object.values(bestByItem).sort((a, b) => {
      const confidenceOrder = { Alta: 3, Media: 2, Baja: 1 }
      if (confidenceOrder[b.confidence] !== confidenceOrder[a.confidence]) {
        return confidenceOrder[b.confidence] - confidenceOrder[a.confidence]
      }
      if (b.score !== a.score) return b.score - a.score
      return b.safeProfit - a.safeProfit
    })

    cacheRef.current[cacheKey] = {
      timestamp: Date.now(),
      data: finalData,
    }

    if (!hadThrottle) {
      setApiWarning("")
    }

    return finalData
  }

  async function loadSafeTop() {
    if (items.length === 0) return

    setLoadingTop(true)
    setApiWarning("")

    try {
      const filteredItems = items.filter((item) => itemMatchesFilters(item, filters))
      const limitedItems = filteredItems.slice(0, 200)
      const profits = await fetchBestProfits(limitedItems, filters)

      setTopResults(profits.slice(0, TOP_LIMIT))
      setLastUpdated(new Date())
    } catch (error) {
      console.error("Error cargando top seguro:", error)
      setTopResults([])
    } finally {
      setLoadingTop(false)
    }
  }

  async function handleSearch() {
    const q = normalizeText(query)

    if (q.length < 2) {
      setSearchResults([])
      return
    }

    setLoadingSearch(true)
    setApiWarning("")

    try {
      const matched = items.filter((item) => {
        const byName = normalizeText(item.name).includes(q)
        const byFilters = itemMatchesFilters(item, filters)
        return byName && byFilters
      })

      if (matched.length === 0) {
        setSearchResults([])
        return
      }

      const limitedItems = matched.slice(0, 120)
      const profits = await fetchBestProfits(limitedItems, filters)

      setSearchResults(profits.slice(0, SEARCH_LIMIT))
      setLastUpdated(new Date())
    } catch (error) {
      console.error("Error en búsqueda:", error)
      setSearchResults([])
    } finally {
      setLoadingSearch(false)
    }
  }

  useEffect(() => {
    if (!loaded || items.length === 0) return
    loadSafeTop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, items])

  useEffect(() => {
    if (!loaded || items.length === 0) return
    loadSafeTop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters])

  useEffect(() => {
    if (refreshRef.current) {
      clearInterval(refreshRef.current)
      refreshRef.current = null
    }

    if (!loaded || items.length === 0) return

    refreshRef.current = setInterval(() => {
      loadSafeTop()
    }, AUTO_REFRESH_MS)

    return () => {
      if (refreshRef.current) {
        clearInterval(refreshRef.current)
        refreshRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, items, filters])

  const totalShown = topResults.length
  const highConfidence = topResults.filter((r) => r.confidence === "Alta").length
  const avgSafeProfit =
    totalShown > 0
      ? Math.round(topResults.reduce((acc, r) => acc + r.safeProfit, 0) / totalShown)
      : 0

  function renderConfidenceBadge(confidence: Confidence) {
    const styles: Record<Confidence, React.CSSProperties> = {
      Alta: {
        background: "rgba(34,197,94,0.16)",
        color: "#86efac",
        border: "1px solid rgba(34,197,94,0.28)",
      },
      Media: {
        background: "rgba(250,204,21,0.14)",
        color: "#fde68a",
        border: "1px solid rgba(250,204,21,0.24)",
      },
      Baja: {
        background: "rgba(239,68,68,0.14)",
        color: "#fca5a5",
        border: "1px solid rgba(239,68,68,0.24)",
      },
    }

    return (
      <span style={{ ...pillBase, ...styles[confidence] }}>
        {confidence}
      </span>
    )
  }

  function renderList(list: ResultItem[]) {
    return list.map((r) => {
      const [baseId] = r.id.split("@")

      return (
        <div
          key={r.id + r.city}
          style={rowCard}
        >
          <div style={leftZone}>
            <div style={iconWrap}>
              <img
                src={`https://render.albiononline.com/v1/item/${baseId}.png`}
                alt={r.displayName}
                width={42}
                height={42}
              />
            </div>

            <div style={{ minWidth: 0 }}>
              <div style={titleRow}>
                <span style={itemName}>{r.displayName}</span>
                {renderConfidenceBadge(r.confidence)}
                {r.suspicious && (
                  <span style={{ ...pillBase, ...warningPill }}>
                    Riesgo
                  </span>
                )}
              </div>

              <div style={metaRow}>
                <span>Comprar en <b>{r.city}</b></span>
                <span>Ciudad: {minutesAgo(r.cityUpdated)}</span>
                <span>BM: {minutesAgo(r.bmUpdated)}</span>
                <span>T{r.tier}</span>
                <span>.{r.enchant}</span>
              </div>
            </div>
          </div>

          <div style={rightZone}>
            <Metric label="Score" value={String(r.score)} />
            <Metric label="Buy ciudad" value={formatCompact(r.buy)} />
            <Metric label="BM estimado" value={formatCompact(r.bmRaw)} />
            <Metric label="BM seguro" value={formatCompact(r.bmSafe)} />
            <Metric label="Profit bruto" value={formatCompact(r.grossProfit)} tone="neutral" />
            <Metric label="Profit seguro" value={formatCompact(r.safeProfit)} tone="profit" />
          </div>
        </div>
      )
    })
  }

  return (
    <div style={pageShell}>
      <div style={pageGlowTop} />
      <div style={pageGlowBottom} />

      <div style={container}>
        <section style={heroCard}>
          <div style={heroTopRow}>
            <div>
              <div style={brandBadge}>Primacy</div>
              <h1 style={heroTitle}>Primacy BM</h1>
              <p style={heroSubtitle}>
                Scanner de Black Market optimizado para profit real y ejecución segura.
              </p>
            </div>

            <div style={heroSideCard}>
              <div style={heroSideTitle}>Modo actual</div>
              <div style={heroSideMain}>Profit Seguro</div>
              <div style={heroSideSub}>
                Strict BM · venta instantánea
              </div>
            </div>
          </div>

          <div style={statsGrid}>
            <StatCard label="Top mostrados" value={String(totalShown)} />
            <StatCard label="Confianza alta" value={String(highConfidence)} />
            <StatCard label="Profit seguro prom." value={avgSafeProfit > 0 ? formatCompact(avgSafeProfit) : "0"} />
            <StatCard label="Última actualización" value={lastUpdated ? lastUpdated.toLocaleTimeString() : "--:--:--"} />
          </div>
        </section>

        <section style={panelCard}>
          <div style={panelHeader}>
            <div>
              <h2 style={sectionTitle}>Filtros</h2>
              <p style={sectionText}>
                Busca oportunidades más ejecutables y reduce riesgos de datos inflados.
              </p>
            </div>
          </div>

          <div style={filtersGrid}>
            <select
              value={filters.category}
              onChange={(e) => setFilters((prev) => ({ ...prev, category: e.target.value }))}
              style={selectStyle}
            >
              <option value="all">Todas las categorías</option>
              <option value="swords">Espadas</option>
              <option value="axes">Hachas</option>
              <option value="maces">Mazas</option>
              <option value="hammers">Martillos</option>
              <option value="daggers">Dagas</option>
              <option value="bows">Arcos</option>
              <option value="crossbows">Ballestas</option>
              <option value="spears">Lanzas</option>
              <option value="quarterstaffs">Bastones</option>
              <option value="fire">Fuego</option>
              <option value="frost">Hielo</option>
              <option value="holy">Holy</option>
              <option value="arcane">Arcano</option>
              <option value="cursed">Maldición</option>
              <option value="nature">Naturaleza</option>
              <option value="offhands">Offhands</option>
            </select>

            <select
              value={filters.minTier}
              onChange={(e) => setFilters((prev) => ({ ...prev, minTier: Number(e.target.value) }))}
              style={selectStyle}
            >
              <option value={4}>Tier mín T4</option>
              <option value={5}>Tier mín T5</option>
              <option value={6}>Tier mín T6</option>
              <option value={7}>Tier mín T7</option>
              <option value={8}>Tier mín T8</option>
            </select>

            <select
              value={filters.maxTier}
              onChange={(e) => setFilters((prev) => ({ ...prev, maxTier: Number(e.target.value) }))}
              style={selectStyle}
            >
              <option value={4}>Tier máx T4</option>
              <option value={5}>Tier máx T5</option>
              <option value={6}>Tier máx T6</option>
              <option value={7}>Tier máx T7</option>
              <option value={8}>Tier máx T8</option>
            </select>

            <select
              value={filters.maxEnchant}
              onChange={(e) => setFilters((prev) => ({ ...prev, maxEnchant: Number(e.target.value) }))}
              style={selectStyle}
            >
              <option value={0}>Solo .0</option>
              <option value={1}>Hasta .1</option>
              <option value={2}>Hasta .2</option>
              <option value={3}>Hasta .3</option>
              <option value={4}>Hasta .4</option>
            </select>

            <select
              value={filters.maxBuyPrice}
              onChange={(e) => setFilters((prev) => ({ ...prev, maxBuyPrice: Number(e.target.value) }))}
              style={selectStyle}
            >
              <option value={300000}>Buy máx 300k</option>
              <option value={500000}>Buy máx 500k</option>
              <option value={1000000}>Buy máx 1m</option>
              <option value={1500000}>Buy máx 1.5m</option>
              <option value={3000000}>Buy máx 3m</option>
              <option value={5000000}>Buy máx 5m</option>
            </select>

            <select
              value={filters.minProfit}
              onChange={(e) => setFilters((prev) => ({ ...prev, minProfit: Number(e.target.value) }))}
              style={selectStyle}
            >
              <option value={20000}>Profit seguro mín 20k</option>
              <option value={50000}>Profit seguro mín 50k</option>
              <option value={80000}>Profit seguro mín 80k</option>
              <option value={100000}>Profit seguro mín 100k</option>
              <option value={150000}>Profit seguro mín 150k</option>
            </select>
          </div>

          <div style={searchRow}>
            <input
              placeholder="Buscar item específico"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSearch()
              }}
              style={inputStyle}
            />

            <button onClick={handleSearch} disabled={loadingSearch || !loaded} style={buttonBlue}>
              {loadingSearch ? "Buscando..." : "Buscar"}
            </button>

            <button onClick={loadSafeTop} disabled={loadingTop || !loaded} style={buttonGreen}>
              {loadingTop ? "Actualizando..." : "Recargar"}
            </button>
          </div>

          <div style={infoRow}>
            <span>Impuesto BM: {(TAX_RATE * 100).toFixed(1)}%</span>
            <span>BM seguro: {(BM_SAFETY_FACTOR * 100).toFixed(0)}%</span>
            <span>Antigüedad máx: {MAX_PRICE_AGE_MINUTES} min</span>
            <span>Auto refresh: {AUTO_REFRESH_MS / 1000}s</span>
            <span>Cache: {CACHE_TTL_MS / 1000}s</span>
          </div>

          {apiWarning && <div style={warningBox}>{apiWarning}</div>}
          {!loaded && <p style={mutedText}>Cargando items...</p>}
        </section>

        <section style={panelCard}>
          <div style={panelHeader}>
            <div>
              <h2 style={sectionTitle}>Top Profit Seguro</h2>
              <p style={sectionText}>
                Ordenado por confianza, score y profit seguro. Esta lista ya no prioriza profits locos.
              </p>
            </div>
          </div>

          {loadingTop && <p style={mutedText}>Escaneando mercado...</p>}
          {!loadingTop && topResults.length === 0 && (
            <p style={mutedText}>No se encontraron flips seguros con esos filtros.</p>
          )}

          <div style={listWrap}>{renderList(topResults)}</div>
        </section>

        <section style={panelCard}>
          <div style={panelHeader}>
            <div>
              <h2 style={sectionTitle}>Resultados del Buscador</h2>
              <p style={sectionText}>
                Ideal para revisar un item concreto con la misma lógica conservadora.
              </p>
            </div>
          </div>

          {loadingSearch && <p style={mutedText}>Buscando item...</p>}

          {!loadingSearch && query.trim().length >= 2 && searchResults.length === 0 && (
            <p style={mutedText}>No se encontraron resultados para esa búsqueda con esos filtros.</p>
          )}

          {!loadingSearch && query.trim().length < 2 && (
            <p style={mutedText}>Escribe al menos 2 letras para buscar un item concreto.</p>
          )}

          <div style={listWrap}>{renderList(searchResults)}</div>
        </section>
      </div>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div style={statCard}>
      <div style={statLabel}>{label}</div>
      <div style={statValue}>{value}</div>
    </div>
  )
}

function Metric({
  label,
  value,
  tone = "default",
}: {
  label: string
  value: string
  tone?: "default" | "profit" | "neutral"
}) {
  const valueStyle =
    tone === "profit"
      ? { color: "#86efac" }
      : tone === "neutral"
      ? { color: "#cbd5e1" }
      : { color: "#f8fafc" }

  return (
    <div style={metricBox}>
      <div style={metricLabel}>{label}</div>
      <div style={{ ...metricValue, ...valueStyle }}>{value}</div>
    </div>
  )
}

const pageShell: React.CSSProperties = {
  minHeight: "100vh",
  background:
    "radial-gradient(circle at top, rgba(139,92,246,0.10), transparent 30%), linear-gradient(180deg, #09090f 0%, #0f1115 100%)",
  color: "#e5e7eb",
  fontFamily: "system-ui, sans-serif",
  position: "relative",
  overflow: "hidden",
  padding: "36px 20px 60px",
}

const pageGlowTop: React.CSSProperties = {
  position: "absolute",
  width: 420,
  height: 420,
  borderRadius: "999px",
  background: "rgba(59,130,246,0.10)",
  filter: "blur(100px)",
  top: -120,
  right: -80,
  pointerEvents: "none",
}

const pageGlowBottom: React.CSSProperties = {
  position: "absolute",
  width: 360,
  height: 360,
  borderRadius: "999px",
  background: "rgba(168,85,247,0.10)",
  filter: "blur(100px)",
  bottom: -100,
  left: -60,
  pointerEvents: "none",
}

const container: React.CSSProperties = {
  maxWidth: 1280,
  margin: "0 auto",
  position: "relative",
  zIndex: 1,
}

const heroCard: React.CSSProperties = {
  background: "rgba(17,24,39,0.72)",
  backdropFilter: "blur(14px)",
  border: "1px solid rgba(148,163,184,0.14)",
  borderRadius: 24,
  padding: 24,
  boxShadow: "0 20px 50px rgba(0,0,0,0.30)",
}

const heroTopRow: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1.7fr 1fr",
  gap: 18,
  alignItems: "start",
}

const brandBadge: React.CSSProperties = {
  display: "inline-block",
  padding: "6px 10px",
  borderRadius: 999,
  background: "rgba(239,68,68,0.14)",
  color: "#fca5a5",
  border: "1px solid rgba(239,68,68,0.20)",
  fontSize: 12,
  fontWeight: 700,
  marginBottom: 12,
}

const heroTitle: React.CSSProperties = {
  margin: 0,
  fontSize: 38,
  lineHeight: 1.05,
  fontWeight: 800,
  color: "#f8fafc",
}

const heroSubtitle: React.CSSProperties = {
  marginTop: 12,
  marginBottom: 0,
  color: "#94a3b8",
  maxWidth: 760,
  lineHeight: 1.6,
  fontSize: 15,
}

const heroSideCard: React.CSSProperties = {
  background: "linear-gradient(180deg, rgba(30,41,59,0.70), rgba(15,23,42,0.82))",
  border: "1px solid rgba(148,163,184,0.14)",
  borderRadius: 20,
  padding: 18,
}

const heroSideTitle: React.CSSProperties = {
  color: "#94a3b8",
  fontSize: 12,
  textTransform: "uppercase",
  letterSpacing: 0.8,
}

const heroSideMain: React.CSSProperties = {
  marginTop: 8,
  fontSize: 22,
  fontWeight: 800,
  color: "#f8fafc",
}

const heroSideSub: React.CSSProperties = {
  marginTop: 8,
  color: "#cbd5e1",
  fontSize: 14,
  lineHeight: 1.5,
}

const statsGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: 12,
  marginTop: 20,
}

const statCard: React.CSSProperties = {
  background: "rgba(15,23,42,0.75)",
  border: "1px solid rgba(148,163,184,0.12)",
  borderRadius: 18,
  padding: "16px 18px",
}

const statLabel: React.CSSProperties = {
  fontSize: 12,
  color: "#94a3b8",
  marginBottom: 8,
}

const statValue: React.CSSProperties = {
  fontSize: 24,
  fontWeight: 800,
  color: "#f8fafc",
}

const panelCard: React.CSSProperties = {
  marginTop: 22,
  background: "rgba(17,24,39,0.72)",
  backdropFilter: "blur(14px)",
  border: "1px solid rgba(148,163,184,0.14)",
  borderRadius: 24,
  padding: 22,
  boxShadow: "0 20px 50px rgba(0,0,0,0.22)",
}

const panelHeader: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 16,
  marginBottom: 18,
}

const sectionTitle: React.CSSProperties = {
  margin: 0,
  fontSize: 22,
  fontWeight: 800,
  color: "#f8fafc",
}

const sectionText: React.CSSProperties = {
  marginTop: 6,
  marginBottom: 0,
  color: "#94a3b8",
  lineHeight: 1.55,
  fontSize: 14,
}

const filtersGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: 12,
}

const selectStyle: React.CSSProperties = {
  padding: 13,
  background: "rgba(15,23,42,0.82)",
  border: "1px solid rgba(148,163,184,0.14)",
  borderRadius: 14,
  color: "white",
  fontSize: 14,
  outline: "none",
}

const searchRow: React.CSSProperties = {
  display: "flex",
  gap: 12,
  flexWrap: "wrap",
  marginTop: 14,
}

const inputStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 260,
  padding: 14,
  background: "rgba(15,23,42,0.82)",
  border: "1px solid rgba(148,163,184,0.14)",
  borderRadius: 14,
  color: "white",
  fontSize: 16,
  outline: "none",
}

const buttonBlue: React.CSSProperties = {
  padding: "14px 18px",
  borderRadius: 14,
  border: "1px solid rgba(96,165,250,0.25)",
  background: "linear-gradient(180deg, #2563eb, #1d4ed8)",
  color: "white",
  cursor: "pointer",
  fontWeight: 800,
  boxShadow: "0 10px 24px rgba(37,99,235,0.28)",
}

const buttonGreen: React.CSSProperties = {
  padding: "14px 18px",
  borderRadius: 14,
  border: "1px solid rgba(34,197,94,0.20)",
  background: "linear-gradient(180deg, #16a34a, #15803d)",
  color: "white",
  cursor: "pointer",
  fontWeight: 800,
  boxShadow: "0 10px 24px rgba(22,163,74,0.24)",
}

const infoRow: React.CSSProperties = {
  marginTop: 14,
  color: "#94a3b8",
  fontSize: 13,
  display: "flex",
  gap: 16,
  flexWrap: "wrap",
}

const warningBox: React.CSSProperties = {
  marginTop: 16,
  padding: 12,
  borderRadius: 14,
  background: "rgba(127,29,29,0.22)",
  border: "1px solid rgba(239,68,68,0.24)",
  color: "#fecaca",
}

const mutedText: React.CSSProperties = {
  marginTop: 12,
  color: "#94a3b8",
}

const listWrap: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 12,
}

const rowCard: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(280px, 1.2fr) minmax(360px, 1fr)",
  gap: 16,
  alignItems: "center",
  padding: 16,
  borderRadius: 18,
  background: "linear-gradient(180deg, rgba(15,23,42,0.70), rgba(15,23,42,0.90))",
  border: "1px solid rgba(148,163,184,0.12)",
}

const leftZone: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 14,
  minWidth: 0,
}

const iconWrap: React.CSSProperties = {
  width: 56,
  height: 56,
  borderRadius: 16,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "rgba(30,41,59,0.9)",
  border: "1px solid rgba(148,163,184,0.10)",
  flexShrink: 0,
}

const titleRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  flexWrap: "wrap",
}

const itemName: React.CSSProperties = {
  fontWeight: 800,
  fontSize: 16,
  color: "#f8fafc",
}

const metaRow: React.CSSProperties = {
  display: "flex",
  gap: 12,
  flexWrap: "wrap",
  marginTop: 8,
  color: "#94a3b8",
  fontSize: 12,
}

const rightZone: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))",
  gap: 10,
}

const metricBox: React.CSSProperties = {
  padding: "12px 10px",
  borderRadius: 14,
  background: "rgba(2,6,23,0.42)",
  border: "1px solid rgba(148,163,184,0.10)",
}

const metricLabel: React.CSSProperties = {
  fontSize: 11,
  color: "#94a3b8",
  marginBottom: 6,
}

const metricValue: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 800,
  color: "#f8fafc",
}

const pillBase: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "4px 9px",
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 800,
}

const warningPill: React.CSSProperties = {
  background: "rgba(239,68,68,0.14)",
  color: "#fca5a5",
  border: "1px solid rgba(239,68,68,0.24)",
}