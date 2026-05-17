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
      fetchMultiHistory: async (hours = 24) => {
        const cams = ['952-N', '952-S', '957-N', '957-S', '1053-N', '3285-N', '3287-N', '3288-N', '3289-S', '3291-E']
        const results = await Promise.all(
          cams.map(id =>
            req(`/api/history?${new URLSearchParams({ cam_id: id, hours: String(hours) })}`)
              .then(d => [id, d.records ?? []])
          )
        )
        return Object.fromEntries(results)
      },
      submitDecision: (pk, sk, decision) =>
        req('/api/decisions', {
          method: 'POST',
          body: JSON.stringify({ pk, sk, decision }),
        }),

      // Cam config / zones
      fetchCamConfig: async (camId) => {
        const q = new URLSearchParams({ cam_id: camId })
        const data = await req(`/api/cam-config?${q}`)
        return data.cam_config
      },
      saveCamZones: (camId, zones) =>
        req('/api/cam-config', {
          method: 'PUT',
          body: JSON.stringify({ cam_id: camId, zones }),
        }),

      // Labeling
      fetchLabel: async (pk, sk) => {
        const q = new URLSearchParams({ pk, sk })
        return req(`/api/label?${q}`)
      },
      saveLabel: (pk, sk, boxes, imageWidth, imageHeight) =>
        req('/api/label', {
          method: 'POST',
          body: JSON.stringify({ pk, sk, boxes, image_width: imageWidth, image_height: imageHeight }),
        }),
      fetchLabelQueue: async (camId, hours = 48, mode = 'all') => {
        const q = new URLSearchParams({ cam_id: camId, hours: String(hours) })
        const data = await req(`/api/history?${q}`)
        const records = (data.records ?? [])
          .filter(r => r.s3_key)
          .sort((a, b) => a.sk < b.sk ? -1 : 1)
        if (mode === 'unlabeled') return records.filter(r => !r.labeled)
        if (mode === 'labeled') return records.filter(r => r.labeled)
        return records
      },

      // Model management
      fetchModels: async (camId) => {
        const q = new URLSearchParams({ cam_id: camId })
        return req(`/api/models?${q}`)
      },
      getModelUploadUrl: (camId, inference) =>
        req('/api/model-upload-url', {
          method: 'POST',
          body: JSON.stringify({ cam_id: camId, inference }),
        }),
      updateModelMeta: (camId, version, updates) =>
        req('/api/model-meta', {
          method: 'PATCH',
          body: JSON.stringify({ cam_id: camId, version, ...updates }),
        }),
      exportLabels: async (camId, opts = {}) => {
        const q = new URLSearchParams({ cam_id: camId, ...opts })
        return req(`/api/export-labels?${q}`)
      },
    }
  }, [getAccessToken])
}
