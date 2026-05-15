const isProd = import.meta.env.VITE_ENV === 'production'

/**
 * Central registry of all platform apps.
 * Add a new entry here whenever you scaffold a new app.
 *
 * @type {Array<{
 *   id: string,
 *   name: string,
 *   description: string,
 *   url: string,
 *   subdomain: string,
 *   isPublic: boolean,
 *   requiredGroup: string | null,
 * }>}
 */
export const APPS = [
  {
    id: 'weather-app',
    name: 'Ensemble Weather',
    description: 'Multi-model ensemble forecasts for the Southwest US',
    url: isProd ? 'https://weather.jtamerius.com' : 'https://staging.d3ro6gzwr4icy0.amplifyapp.com',
    subdomain: 'weather',
    isPublic: true,
    requiredGroup: null,
  },
  {
    id: 'finance-app',
    name: 'Finance Tracker',
    description: 'Personal finance tracking and analysis',
    url: isProd ? 'https://finance.jtamerius.com' : 'https://staging.d3r6r8egymbh24.amplifyapp.com',
    subdomain: 'finance',
    isPublic: false,
    requiredGroup: 'admin',
  },

  {
    id: 'investment-tracker',
    name: 'Investment Tracker',
    description: 'Track monthly seller-statement payments and estimated investment values.',
    url: isProd ? 'https://investments.jtamerius.com' : 'https://staging.d1kqq0ntalvbmo.amplifyapp.com',
    subdomain: 'investments',
    isPublic: false,
    requiredGroup: 'admin',
  },
  {
    id: 'adventure-builder',
    name: 'Adventure Builder',
    description: 'Create and visualize choose-your-own-adventure stories.',
    url: isProd ? 'https://adventure.jtamerius.com' : 'https://staging.d1sgxuayv4jvam.amplifyapp.com',
    subdomain: 'adventure',
    isPublic: false,
    requiredGroup: 'admin',
  },
  {
    id: 'purgatory',
    name: 'Purgatory Crowding',
    description: 'Traffic-cam + RWIS ingestion and review for Purgatory Resort crowding prediction.',
    url: isProd ? 'https://purg.jtamerius.com' : 'https://staging.purgatory.amplifyapp.com',
    subdomain: 'purg',
    isPublic: false,
    requiredGroup: 'admin',
  },
]
