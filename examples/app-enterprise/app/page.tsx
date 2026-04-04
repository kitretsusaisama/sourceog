// sourceog-renderer/src/__tests__/fixtures/EnterprisePage.tsx
// Alibaba CTO 2027 Standard — Test Fixture Component

import React from 'react';
import type { Metadata } from 'sourceog/platform';

/**
 * Page Component: Enterprise Landing Page
 * 
 * Serves as a test fixture for verifying:
 * 1. RSC Worker Pool rendering.
 * 2. TSX/JSX transpilation pipeline.
 * 3. Metadata generation.
 * 4. Basic component hydration.
 */
export default function EnterprisePage(): React.JSX.Element {
  return (
    <main style={styles.main}>
      <div style={styles.container}>
        <header style={styles.header}>
          <h1 style={styles.title}>Enterprise Architecture</h1>
          <p style={styles.subtitle}>
            Rendered by SourceOG Worker Pool
          </p>
        </header>

        <section style={styles.grid} aria-label="Features">
          <FeatureCard 
            title="Zero Config" 
            description="Auto-detects tsx, esbuild, and sucrase." 
          />
          <FeatureCard 
            title="High Performance" 
            description="O(1) queue and optimized worker recycling." 
          />
          <FeatureCard 
            title="Type Safe" 
            description="Strict contracts for planning and execution." 
          />
        </section>
      </div>
    </main>
  );
}

/**
 * Sub-component for feature cards.
 * Demonstrates component composition within the renderer.
 */
const styles = {
  card: {},
  cardTitle: {},
  cardText: {}
};

function FeatureCard({ 
  title, 
  description 
}: { 
  readonly title: string; 
  readonly description: string; 
}): React.JSX.Element {
  return (
    <div style={styles.card}>
      <h3 style={styles.cardTitle}>{title}</h3>
      <p style={styles.cardText}>{description}</p>
    </div>
  );
}

/**
 * Metadata Export
 * Used by the renderer to generate <head> tags.
 */
export const generateMetadata = (): Metadata => ({
  title: 'Enterprise Landing Page',
  description: 'Demonstration of SourceOG high-performance rendering capabilities.',
});

/**
 * Inline Styles
 * Ensures the fixture is self-contained and renders correctly without CSS pipeline.
 */
const styles = {
  main: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0f172a', // Slate 900
    color: '#f8fafc', // Slate 50
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  container: {
    maxWidth: '64rem',
    width: '100%',
  },
  header: {
    textAlign: 'center' as const,
    marginBottom: '3rem',
  },
  title: {
    fontSize: '2.25rem',
    fontWeight: 'bold',
    letterSpacing: '-0.025em',
    marginBottom: '0.5rem',
    color: '#38bdf8', // Sky 400
  },
  subtitle: {
    fontSize: '1.125rem',
    color: '#94a3b8', // Slate 400
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
    gap: '1.5rem',
  },
  card: {
    padding: '1.5rem',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: '0.75rem',
    border: '1px solid rgba(255, 255, 255, 0.1)',
  },
  cardTitle: {
    fontSize: '1.125rem',
    fontWeight: '600',
    marginBottom: '0.5rem',
    color: '#e2e8f0', // Slate 200
  },
  cardText: {
    fontSize: '0.875rem',
    lineHeight: '1.5',
    color: '#cbd5e1', // Slate 300
  },
};
