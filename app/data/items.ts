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

      const isWeaponOrOffhand =
        id.includes("MAIN_") ||
        id.includes("2H_") ||
        id.includes("OFF_")

      if (!isWeaponOrOffhand) return false

      const banned = [
        "_TEST",
        "_NONTRADABLE",
        "_QUEST",
        "_DEBUG",
        "_TUTORIAL",
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