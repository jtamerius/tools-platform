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
    url: isProd ? 'https://tools.jtamerius.com' : 'https://staging.d223wq48sddq6t.amplifyapp.com',
    subdomain: 'tools',
    isPublic: true,
    requiredGroup: null,
  },
  {
    id: 'weather-app',
    name: 'Ensemble Weather',
    description: 'Multi-model ensemble forecasts for the Southwest US',
    url: isProd ? 'https://weather.jtamerius.com' : 'https://staging.d26oqifvpt9ysq.amplifyapp.com',
    subdomain: 'weather',
    isPublic: true,
    requiredGroup: null,
  },
  {
    id: 'finance-app',
    name: 'Finance Tracker',
    description: 'Personal finance tracking and analysis',
    url: isProd ? 'https://finance.jtamerius.com' : 'https://staging.d1k4zfq8stlbd.amplifyapp.com',
    subdomain: 'finance',
    isPublic: false,
    requiredGroup: 'admin',
  },
  {
    id: 'globe-app',
    name: 'Interactive Globe',
    description: 'Real-time 3D Earth with day/night cycle, atmosphere, and interactive overlays',
    url: isProd ? 'https://globe.jtamerius.com' : 'https://staging.d31dppeu1ai6hv.amplifyapp.com',
    subdomain: 'globe',
    isPublic: true,
    requiredGroup: null,
  },
  {
    id: 'news',
    name: 'Global News',
    description: 'Top headlines from 96 countries, categorized by AI',
    url: isProd ? 'https://tools.jtamerius.com/#/news' : 'https://staging.d223wq48sddq6t.amplifyapp.com/#/news',
    subdomain: 'tools',
    isPublic: true,
    requiredGroup: null,
  },
]
