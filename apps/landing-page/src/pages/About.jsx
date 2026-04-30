import SubtleVoronoiCanvas from '../components/SubtleVoronoiCanvas'
import BackButton from '../components/BackButton'

export default function About() {
  return (
    <>
    <SubtleVoronoiCanvas />
    <BackButton />
    <main style={styles.main}>
      <div style={styles.content}>

        {/* Header */}
        <div style={styles.header}>
          <p style={styles.eyebrow}>About</p>
          <h1 style={styles.heading}>A bit about me</h1>
        </div>

        {/* Bio sections */}
        <div style={styles.sections}>
          <section style={styles.section}>
            <h2 style={styles.sectionHeading}>Background</h2>
            <p style={styles.body}>
              I’m James Tamerius. I build data products and decision-support tools at the
              intersection of geospatial analysis, forecasting, and clean energy. My work focuses
              on turning messy operational, program, and environmental data into systems that
              support real decisions, especially in electrification and infrastructure planning.
            </p>
            <p style={styles.body}>
              I currently serve as Director of Data Science at the Center for Sustainable Energy,
              where I’ve led the development of analytics platforms used by states, utilities, and
              agencies. My work spans EV infrastructure siting, charging performance and
              utilization analytics, incentive program design and measurement, and forecasting
              under policy and market scenarios. I tend to work end-to-end: defining the problem,
              building models and data pipelines, and shipping tools that get used in real
              planning and operational contexts.
            </p>
            <p style={styles.body}>
              Before that, my background was in environmental health and spatial epidemiology,
              where I focused on spatiotemporal modeling of weather, environmental, and
              population-level systems, along with the visualization and communication of complex
              dynamics, and published extensively in peer-reviewed journals. That foundation still
              shapes how I approach problems: grounded in real-world variability, attentive to
              uncertainty, and focused on making complex systems understandable and usable.
            </p>
          </section>

          <div style={styles.rule} />

          <section style={styles.section}>
            <h2 style={styles.sectionHeading}>What I'm working on</h2>
            <p style={styles.body}>
              This platform is a personal tools hub: a place to host small apps, experiments, and
              utilities I build for myself and collaborators. It’s where I explore ideas and build
              practical software around data, maps, and decision-making. It’s built entirely on
              AWS, designed as a serverless architecture, with a CI/CD pipeline via GitHub, and
              developed in my free time.
            </p>
            <p style={styles.body}>
              Most of what I build here follows a simple pattern: take an unclear question or
              messy dataset, impose structure, and turn it into something usable. That might be a
              geospatial workflow, a forecasting tool, a small API, or a lightweight internal app.
            </p>
            <p style={styles.body}>
              Current interests include geospatial data products, forecasting and scenario
              analysis, electrification and infrastructure planning, weather and climate datasets,
              and building cloud systems that are simple, reliable, and easy to maintain.
            </p>
          </section>

          <div style={styles.rule} />

          {/* Snapshot grid */}
          <section style={styles.section}>
            <h2 style={styles.sectionHeading}>Quick facts</h2>
            <div style={styles.grid}>
              {FACTS.map(({ label, value }) => (
                <div key={label} style={styles.fact}>
                  <span style={styles.factLabel}>{label}</span>
                  <span style={styles.factValue}>{value}</span>
                </div>
              ))}
            </div>
          </section>

          <div style={styles.rule} />

          {/* Contact */}
          <section style={styles.section}>
            <h2 style={styles.sectionHeading}>Contact</h2>
            <p style={styles.body}>
              Reach me at{' '}
              <a
                href="mailto:james.tamerius@gmail.com"
                style={styles.link}
                onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text)' }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)' }}
              >
                james.tamerius@gmail.com
              </a>.
            </p>
          </section>
        </div>
      </div>
    </main>
    </>
  )
}

const FACTS = [
  { label: 'Location', value: 'Colorado, USA' },
  { label: 'Primary stack', value: 'Python · AWS · SQL · Geospatial tooling' },
  { label: 'Interests', value: 'Spatiotemporal analysis · Clean energy · Forecasting · Infrastructure planning · Visualization · Product development' },
  { label: 'Infrastructure', value: 'Serverless · AWS · APIs · Data pipelines' },
]

const styles = {
  main: {
    flex: 1,
    maxWidth: 'var(--max-w)',
    width: '100%',
    margin: '0 auto',
    padding: '72px 24px 80px',
    position: 'relative',
    zIndex: 1,
  },
  content: {
    maxWidth: '680px',
  },
  header: {
    marginBottom: '56px',
  },
  eyebrow: {
    fontSize: '0.7rem',
    fontWeight: 600,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: 'var(--text-faint)',
    marginBottom: '16px',
  },
  heading: {
    fontSize: 'clamp(1.8rem, 4vw, 2.6rem)',
    fontWeight: 700,
    letterSpacing: '-0.03em',
    lineHeight: 1.2,
    color: 'var(--text)',
  },
  sections: {
    display: 'flex',
    flexDirection: 'column',
  },
  section: {
    padding: '8px 0',
  },
  sectionHeading: {
    fontSize: '0.8rem',
    fontWeight: 600,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: 'var(--text-faint)',
    marginBottom: '20px',
  },
  body: {
    fontSize: '1rem',
    color: 'var(--text-muted)',
    lineHeight: 1.75,
    marginBottom: '16px',
  },
  rule: {
    height: '1px',
    background: 'var(--border)',
    margin: '40px 0',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
    gap: '24px',
  },
  fact: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  factLabel: {
    fontSize: '0.7rem',
    fontWeight: 600,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: 'var(--text-faint)',
  },
  factValue: {
    fontSize: '0.9rem',
    color: 'var(--text-muted)',
    lineHeight: 1.5,
  },
  link: {
    color: 'var(--text-muted)',
    textDecoration: 'underline',
    textUnderlineOffset: '3px',
    transition: 'color 0.12s ease',
  },
}
