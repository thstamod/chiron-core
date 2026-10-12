export const databasePageSize = 500

interface DatabasePage<T> {
  data: T[] | null
  error: { message: string } | null
}

export async function fetchAllPages<T>(
  loadPage: (from: number, to: number) => PromiseLike<DatabasePage<T>>,
  errorPrefix: string,
  pageSize = databasePageSize,
): Promise<T[]> {
  const rows: T[] = []

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await loadPage(from, from + pageSize - 1)
    if (error) throw new Error(`${errorPrefix}: ${error.message}`)

    const page = data ?? []
    rows.push(...page)
    if (page.length < pageSize) return rows
  }
}
