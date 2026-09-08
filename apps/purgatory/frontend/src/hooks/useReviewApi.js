import { useMemo } from 'react'

const API_URL = import.meta.env.VITE_API_URL ?? ''

export function useReviewApi() {
  return useMemo(() => {
    const req = async (path, opts = {}) => {
      const res = await fetch(`${API_URL}${path}`, {
        ...opts,
        headers: {
          'Content-Type': 'application/json',
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
      // The API caps history at 168h. Anything longer is a job for
      // fetchSeries, which reads pre-aggregated cells instead of raw records.
      fetchSeries: async ({ scale = 'day', start, end, cams } = {}) => {
        const q = new URLSearchParams({ scale, start, end })
        if (cams && cams.length) q.set('cams', cams.join(','))
        return req(`/api/series?${q}`)
      },

      // Split a long range into ~30-day requests. An all-history hour-scale
      // pull is ~28k cells, which would blow API Gateway's 6 MB response cap
      // in one shot; the same chunking pattern the solarhail frontend uses.
      fetchSeriesChunked: async ({ scale = 'hour', start, end, cams, chunkDays = 30 } = {}) => {
        const ranges = []
        const last = new Date(`${end}T00:00:00Z`)
        let cursor = new Date(`${start}T00:00:00Z`)
        while (cursor <= last) {
          const chunkEnd = new Date(cursor)
          chunkEnd.setUTCDate(chunkEnd.getUTCDate() + chunkDays - 1)
          ranges.push([
            cursor.toISOString().slice(0, 10),
            (chunkEnd > last ? last : chunkEnd).toISOString().slice(0, 10),
          ])
          cursor = new Date(chunkEnd)
          cursor.setUTCDate(cursor.getUTCDate() + 1)
        }
        const parts = await Promise.all(ranges.map(([s0, e0]) => {
          const q = new URLSearchParams({ scale, start: s0, end: e0 })
          if (cams && cams.length) q.set('cams', cams.join(','))
          return req(`/api/series?${q}`)
        }))
        const by_cam = {}
        const corridor = []
        for (const part of parts) {
          for (const [cam, cells] of Object.entries(part.by_cam ?? {})) {
            (by_cam[cam] ??= []).push(...cells)
          }
          corridor.push(...(part.corridor ?? []))
        }
        corridor.sort((a, b) => (a.sk < b.sk ? -1 : 1))
        return { scale, start, end, by_cam, corridor }
      },

      fetchHistory: async (camId, hours = 24) => {
        const q = new URLSearchParams({ cam_id: camId, hours: String(Math.min(hours, 168)) })
        const data = await req(`/api/history?${q}`)
        return data.records ?? []
      },
      fetchMultiHistory: async (hours = 24) => {
        const cams = ['952-N', '952-S', '957-N', '957-S', '1053-N', '3285-N', '3287-N', '3288-N', '3289-S', '3291-E']
        const results = await Promise.allSettled(
          cams.map(id =>
            req(`/api/history?${new URLSearchParams({ cam_id: id, hours: String(Math.min(hours, 168)) })}`)
              .then(d => [id, d.records ?? []])
          )
        )
        return Object.fromEntries(
          results.filter(r => r.status === 'fulfilled').map(r => r.value)
        )
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
  }, [])
}
