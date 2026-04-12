export const APPS = [
  {
    id: 'landing-page',
    name: 'Home',
    description: 'Internal tools landing page',
    url: 'https://tools.jtamerius.com',
    subdomain: 'tools',
    isPublic: true,
    requiredGroup: null,
  },
  {
    id: 'maritime-trajectory',
    name: 'Maritime Trajectory',
    description: 'Visualize AIS vessel paths and explore predicted trajectories on a live Deck.gl map.',
    url: 'https://maritime.jtamerius.com',
    subdomain: 'maritime',
    isPublic: false,
    requiredGroup: 'member',
  },
]
