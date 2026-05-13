import { useState, useEffect } from 'react';
import { fetchStateSummary } from '../services/api';

export function useStateSummary(startDate, endDate) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!startDate || !endDate) return;
    setLoading(true);
    fetchStateSummary(startDate, endDate)
      .then(r => setRows(r))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [startDate, endDate]);

  return { rows, loading };
}
