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

type ResultItem = {
  id: string
  displayName: string
  profit: number
  buy: number
  bm: number
  city: string
  cityUpdated?: string
  bmUpdated?: string
  score: number
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
const AUTO_REFRESH_MS = 60000
const CHUNK_SIZE = 35
const TOP_LIMIT = 30
const SEARCH_LIMIT = 50
const CACHE_TTL_MS = 60000

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
    minProfit: 50000,
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

  function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  async function safeFetchPrices(ids: string[]): Promise<ApiRow[]> {
    const url = `https://west.albion-online-data.com/api/v2/stats/prices/${ids.join(",")}`

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

  function computeScore(args: {
    profit: number
    buy: number
    tier: number
    enchant: number
    cityFresh: boolean
    bmFresh: boolean
  }) {
    let score = 0

    score += args.profit / 1000

    if (args.buy <= 500000) score += 40
    else if (args.buy <= 1000000) score += 25
    else if (args.buy <= 1500000) score += 10
    else score -= 10

    if (args.enchant === 0) score += 25
    else if (args.enchant === 1) score += 18
    else if (args.enchant === 2) score += 8
    else score -= 20

    if (args.tier === 4) score += 20
    else if (args.tier === 5) score += 18
    else if (args.tier === 6) score += 12
    else if (args.tier === 7) score -= 5
    else if (args.tier === 8) score -= 10

    if (args.cityFresh) score += 15
    if (args.bmFresh) score += 15

    return Math.round(score)
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
        await sleep(800)
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
            r.sell_price_min > 0 &&
            isRecent(r.sell_price_min_date)
        )

        if (!bm) continue

        let bestCandidate: ResultItem | null = null

        for (const row of rows) {
          if (row.city === "Black Market") continue
          if (row.sell_price_min <= 0) continue
          if (!isRecent(row.sell_price_min_date)) continue
          if (row.sell_price_min > currentFilters.maxBuyPrice) continue

          const tax = bm.sell_price_min * TAX_RATE
          const profit = Math.round(bm.sell_price_min - row.sell_price_min - tax)

          if (profit < currentFilters.minProfit) continue

          const score = computeScore({
            profit,
            buy: row.sell_price_min,
            tier,
            enchant,
            cityFresh: isRecent(row.sell_price_min_date),
            bmFresh: isRecent(bm.sell_price_min_date),
          })

          const candidate: ResultItem = {
            id: itemID,
            displayName: getDisplayName(itemID),
            profit,
            buy: row.sell_price_min,
            bm: bm.sell_price_min,
            city: row.city,
            cityUpdated: row.sell_price_min_date,
            bmUpdated: bm.sell_price_min_date,
            score,
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

      await sleep(250)
    }

    const finalData = Object.values(bestByItem).sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return b.profit - a.profit
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
      const limitedItems = filteredItems.slice(0, 180)

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

      const limitedItems = matched.slice(0, 80)
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
  }, [loaded, items])

  useEffect(() => {
    if (!loaded || items.length === 0) return
    loadSafeTop()
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
  }, [loaded, items, filters])

  function renderList(list: ResultItem[]) {
    return list.map((r) => {
      const [baseId] = r.id.split("@")

      return (
        <div
          key={r.id + r.city}
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "14px 12px",
            borderBottom: "1px solid #2a2f3a",
            gap: 16,
            flexWrap: "wrap",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              minWidth: 320,
              flex: 1,
            }}
          >
            <img
              src={`https://render.albiononline.com/v1/item/${baseId}.png`}
              alt={r.displayName}
              width={40}
              height={40}
            />

            <div style={{ display: "flex", flexDirection: "column" }}>
              <span style={{ fontWeight: 700, fontSize: 15 }}>
                {r.displayName}
              </span>

              <span style={{ fontSize: 12, color: "#9ca3af" }}>
                Comprar en {r.city}
              </span>

              <span style={{ fontSize: 12, color: "#9ca3af" }}>
                Ciudad: {minutesAgo(r.cityUpdated)} | BM: {minutesAgo(r.bmUpdated)}
              </span>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              gap: 18,
              flexWrap: "wrap",
              fontSize: 14,
              alignItems: "center",
              justifyContent: "flex-end",
            }}
          >
            <span>
              Score: <b>{r.score}</b>
            </span>

            <span>
              Buy: <b>{r.buy.toLocaleString()}</b>
            </span>

            <span>
              BM: <b>{r.bm.toLocaleString()}</b>
            </span>

            <span style={{ color: "#22c55e", fontWeight: 800 }}>
              +{r.profit.toLocaleString()}
            </span>
          </div>
        </div>
      )
    })
  }

  return (
    <div
      style={{
        background: "#0f1115",
        minHeight: "100vh",
        padding: "40px",
        fontFamily: "system-ui, sans-serif",
        color: "#e5e7eb",
      }}
    >
      <div
        style={{
          maxWidth: 1200,
          margin: "0 auto",
        }}
      >
        <h1
          style={{
            fontSize: 34,
            marginBottom: 12,
          }}
        >
          Sweet Violence BM
        </h1>

        <p
          style={{
            color: "#9ca3af",
            marginBottom: 24,
            lineHeight: 1.5,
          }}
        >
          Modo Profit Seguro: filtra items más ejecutables, con menos riesgo y menos throttle.
        </p>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 12,
            marginBottom: 16,
          }}
        >
          <select
            value={filters.category}
            onChange={(e) =>
              setFilters((prev) => ({ ...prev, category: e.target.value }))
            }
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
            onChange={(e) =>
              setFilters((prev) => ({ ...prev, minTier: Number(e.target.value) }))
            }
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
            onChange={(e) =>
              setFilters((prev) => ({ ...prev, maxTier: Number(e.target.value) }))
            }
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
            onChange={(e) =>
              setFilters((prev) => ({ ...prev, maxEnchant: Number(e.target.value) }))
            }
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
            onChange={(e) =>
              setFilters((prev) => ({ ...prev, maxBuyPrice: Number(e.target.value) }))
            }
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
            onChange={(e) =>
              setFilters((prev) => ({ ...prev, minProfit: Number(e.target.value) }))
            }
            style={selectStyle}
          >
            <option value={20000}>Profit mín 20k</option>
            <option value={50000}>Profit mín 50k</option>
            <option value={80000}>Profit mín 80k</option>
            <option value={100000}>Profit mín 100k</option>
            <option value={150000}>Profit mín 150k</option>
          </select>
        </div>

        <div
          style={{
            display: "flex",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <input
            placeholder="Buscar item específico"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                handleSearch()
              }
            }}
            style={{
              flex: 1,
              minWidth: 260,
              padding: 14,
              background: "#1a1d24",
              border: "1px solid #2a2f3a",
              borderRadius: 8,
              color: "white",
              fontSize: 16,
              outline: "none",
            }}
          />

          <button
            onClick={handleSearch}
            disabled={loadingSearch || !loaded}
            style={buttonBlue}
          >
            {loadingSearch ? "Buscando..." : "Buscar"}
          </button>

          <button
            onClick={loadSafeTop}
            disabled={loadingTop || !loaded}
            style={buttonGreen}
          >
            {loadingTop ? "Actualizando..." : "Recargar Profit Seguro"}
          </button>
        </div>

        <div
          style={{
            marginTop: 16,
            color: "#9ca3af",
            fontSize: 14,
            display: "flex",
            gap: 18,
            flexWrap: "wrap",
          }}
        >
          <span>Impuesto BM: {(TAX_RATE * 100).toFixed(1)}%</span>
          <span>Antigüedad máx: {MAX_PRICE_AGE_MINUTES} min</span>
          <span>Auto refresh: {AUTO_REFRESH_MS / 1000}s</span>
          <span>Cache local: {CACHE_TTL_MS / 1000}s</span>
          <span>Top seguro: {TOP_LIMIT}</span>
          {lastUpdated && (
            <span>Última actualización: {lastUpdated.toLocaleTimeString()}</span>
          )}
        </div>

        {apiWarning && (
          <div
            style={{
              marginTop: 16,
              padding: 12,
              borderRadius: 8,
              background: "#3f1d1d",
              border: "1px solid #7f1d1d",
              color: "#fecaca",
            }}
          >
            {apiWarning}
          </div>
        )}

        {!loaded && (
          <p style={{ marginTop: 20, color: "#9ca3af" }}>Cargando items...</p>
        )}

        <div
          style={{
            marginTop: 30,
            background: "#1a1d24",
            padding: 20,
            borderRadius: 12,
            border: "1px solid #2a2f3a",
          }}
        >
          <h2 style={{ marginBottom: 20 }}>Top Profit Seguro</h2>

          {loadingTop && <p style={{ color: "#9ca3af" }}>Escaneando mercado...</p>}

          {!loadingTop && topResults.length === 0 && (
            <p style={{ color: "#9ca3af" }}>
              No se encontraron flips seguros con esos filtros.
            </p>
          )}

          {renderList(topResults)}
        </div>

        <div
          style={{
            marginTop: 30,
            background: "#1a1d24",
            padding: 20,
            borderRadius: 12,
            border: "1px solid #2a2f3a",
          }}
        >
          <h2 style={{ marginBottom: 20 }}>Resultados del Buscador</h2>

          {loadingSearch && (
            <p style={{ color: "#9ca3af" }}>Buscando item...</p>
          )}

          {!loadingSearch && query.trim().length >= 2 && searchResults.length === 0 && (
            <p style={{ color: "#9ca3af" }}>
              No se encontraron resultados para esa búsqueda con esos filtros.
            </p>
          )}

          {!loadingSearch && query.trim().length < 2 && (
            <p style={{ color: "#9ca3af" }}>
              Escribe al menos 2 letras para buscar un item concreto.
            </p>
          )}

          {renderList(searchResults)}
        </div>
      </div>
    </div>
  )
}

const selectStyle: React.CSSProperties = {
  padding: 12,
  background: "#1a1d24",
  border: "1px solid #2a2f3a",
  borderRadius: 8,
  color: "white",
  fontSize: 14,
  outline: "none",
}

const buttonBlue: React.CSSProperties = {
  padding: "14px 18px",
  borderRadius: 8,
  border: "1px solid #2a2f3a",
  background: "#2563eb",
  color: "white",
  cursor: "pointer",
  fontWeight: 700,
}

const buttonGreen: React.CSSProperties = {
  padding: "14px 18px",
  borderRadius: 8,
  border: "1px solid #2a2f3a",
  background: "#16a34a",
  color: "white",
  cursor: "pointer",
  fontWeight: 700,
}