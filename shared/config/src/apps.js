/* eslint-disable-next-line */
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
    id: 'landing-page',
    name: 'Home',
    description: 'Internal tools landing page',
    url: isProd ? 'https://tools.jtamerius.com' : 'https://staging.dfgc4jtftrltl.amplifyapp.com',
    subdomain: 'tools',
    isPublic: true,
    requiredGroup: null,
  },
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
    id: 'news',
    name: 'Global News',
    description: 'Top headlines from 96 countries, categorized by AI',
    url: isProd ? 'https://tools.jtamerius.com/#/news' : 'https://staging.dfgc4jtftrltl.amplifyapp.com/#/news',
    subdomain: 'tools',
    isPublic: true,
    requiredGroup: null,
  },
]
