import { useMemo } from 'react'

const API_URL = import.meta.env.VITE_API_URL ?? ''

export function useReviewApi(getAccessToken) {
  return useMemo(() => {
    const req = async (path, opts = {}) => {
      const token = await getAccessToken()
      const res = await fetch(`${API_URL}${path}`, {
        ...opts,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          ...(opts.headers || {}),
        },
      })
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
      return res.json()
    }

    return {
      fetchQueue: async () => {
        const data = await req('/api/queue')
        return data.records ?? []
      },
      fetchSearch: async (filters) => {
        const q = new URLSearchParams()
        Object.entries(filters || {}).forEach(([k, v]) => {
          if (v != null && v !== '') q.set(k, v)
        })
        const data = await req(`/api/search?${q}`)
        return data.records ?? []
      },
      fetchImage: async (pk, sk) => {
        const q = new URLSearchParams({ pk, sk })
        const data = await req(`/api/image?${q}`)
        return data.url
      },
      fetchNeighbors: async (sk) => {
        const q = new URLSearchParams({ sk })
        const data = await req(`/api/neighbors?${q}`)
        return data.records ?? []
      },
      fetchHistory: async (camId, hours = 24) => {
        const q = new URLSearchParams({ cam_id: camId, hours: String(hours) })
        const data = await req(`/api/history?${q}`)
        return data.records ?? []
      },
      submitDecision: (pk, sk, decision) =>
        req('/api/decisions', {
          method: 'POST',
          body: JSON.stringify({ pk, sk, decision }),
        }),
    }
  }, [getAccessToken])
}
