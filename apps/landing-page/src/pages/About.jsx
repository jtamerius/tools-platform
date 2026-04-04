export default function About() {
  return (
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
              I'm J. Tamerius — a builder focused on data engineering, geospatial analysis, and
              internal tooling. I enjoy turning raw, messy data into something useful and building
              the systems that make that repeatable.
            </p>
            <p style={styles.body}>
              My work spans cloud infrastructure, backend pipelines, and the front-end interfaces
              that make data accessible to the people who need it. I care about making things that
              actually get used, not just things that technically work.
            </p>
          </section>

          <div style={styles.rule} />

          <section style={styles.section}>
            <h2 style={styles.sectionHeading}>What I'm working on</h2>
            <p style={styles.body}>
              This platform is a personal internal tools hub — a place to host small apps,
              experiments, and utilities that I build for myself and collaborators. Everything here
              is serverless, runs on AWS, and deploys automatically from a monorepo.
            </p>
            <p style={styles.body}>
              Current interests include geospatial data pipelines, weather and climate datasets,
              and making AWS infrastructure boring in the best way possible.
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
                href="mailto:contact@jtamerius.com"
                style={styles.link}
                onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text)' }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)' }}
              >
                contact@jtamerius.com
              </a>
              {' '}or find me on{' '}
              <a
                href="https://github.com/jtamerius"
                target="_blank"
                rel="noopener noreferrer"
                style={styles.link}
                onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text)' }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)' }}
              >
                GitHub
              </a>.
            </p>
          </section>
        </div>
      </div>
    </main>
  )
}

const FACTS = [
  { label: 'Location', value: 'United States' },
  { label: 'Primary stack', value: 'Python · AWS · React' },
  { label: 'Interests', value: 'Geospatial · Climate · Data pipelines' },
  { label: 'Infrastructure', value: 'Serverless · CloudFormation · Amplify' },
]

const styles = {
  main: {
    flex: 1,
    maxWidth: 'var(--max-w)',
    width: '100%',
    margin: '0 auto',
    padding: '72px 24px 80px',
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
