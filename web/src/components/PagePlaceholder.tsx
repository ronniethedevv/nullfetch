interface Props {
  phase: string;
  title: string;
  description: string;
  bullets?: string[];
}

/**
 * Shared "this page is coming in Phase N" panel. Keeps the routing
 * navigable without dropping a stub that lies about being functional.
 */
export function PagePlaceholder({ phase, title, description, bullets }: Props) {
  return (
    <section className="page page--placeholder">
      <div className="placeholder">
        <div className="placeholder__phase mono">// {phase}</div>
        <h1 className="placeholder__title">{title}</h1>
        <p className="placeholder__desc">{description}</p>
        {bullets && bullets.length > 0 && (
          <ul className="placeholder__list">
            {bullets.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
