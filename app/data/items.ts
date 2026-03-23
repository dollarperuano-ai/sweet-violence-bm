export type Item = {
  id: string
  name: string
}

export async function getAllItems(): Promise<Item[]> {
  const res = await fetch(
    "https://raw.githubusercontent.com/ao-data/ao-bin-dumps/master/formatted/items.json",
    { cache: "no-store" }
  )

  const data = await res.json()

  const items: Item[] = data
    .filter((item: any) => {
      const id = item?.UniqueName
      const name = item?.LocalizedNames?.["ES-ES"]

      if (!id || !name) return false
      if (!/^T[4-8]_/.test(id)) return false

      if (
        !id.includes("MAIN_") &&
        !id.includes("2H_") &&
        !id.includes("OFF_")
      ) {
        return false
      }

      const banned = [
        "_MORGANA",
        "_UNDEAD",
        "_KEEPER",
        "_AVALON",
        "_HELL",
        "_CRYSTAL",
        "_FACTION",
        "_TEST",
        "_NONTRADABLE",
      ]

      if (banned.some((bad) => id.includes(bad))) return false

      return true
    })
    .map((item: any) => ({
      id: item.UniqueName,
      name: item.LocalizedNames["ES-ES"],
    }))
    .sort((a: Item, b: Item) => a.name.localeCompare(b.name, "es"))

  return items
}