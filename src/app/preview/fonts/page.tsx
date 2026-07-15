/**
 * /preview/fonts — Classic Coven display-serif preview.
 *
 * Shows EB Garamond, Instrument Serif, and Fraunces side-by-side against
 * identical Coven copy so the human can gut-check which one to canonize
 * in DESIGN.md. Body text stays on the current var(--font-sans) stack
 * (Inter/Geist) so the display-vs-body pairing is realistic.
 *
 * Route: http://localhost:3000/preview/fonts
 *
 * This is a design-review page, not app chrome. Delete once a winner is
 * picked and DESIGN.md is updated.
 */

export const metadata = {
  title: "Font Preview — Classic Coven",
};

const SAMPLE_HERO = "OpenCoven";
const SAMPLE_TAGLINE = "An open ecosystem for persistent AI familiars.";
const SAMPLE_H1 = "The Coven remembers.";
const SAMPLE_H2 = "A familiar is not a faceless bot.";
const SAMPLE_BODY =
  "Most AI today feels temporary: a user opens a chat, explains context, gets a response, and starts over. OpenCoven is built around a different future — AI that can stay. The next generation of AI should be durable, personal systems that remember what matters, understand their purpose, use tools, collaborate with other agents, and grow alongside the people and projects they serve.";
const SAMPLE_QUOTE =
  "AI should be powerful without becoming opaque, personal without pretending to be human, and extensible without collapsing into chaos.";
const SAMPLE_ITALIC = "the whispering woods";
const SAMPLE_META = "familiar · memory · continuity · tools";

type Candidate = {
  slug: "eb-garamond" | "instrument-serif" | "fraunces";
  rank: string;
  name: string;
  pitch: string;
  displayVar: string;
  displayFallback: string;
  displayLineHeight: number;
  heroSize: string;
  h1Size: string;
  h2Size: string;
};

const CANDIDATES: Candidate[] = [
  {
    slug: "eb-garamond",
    rank: "🥇",
    name: "EB Garamond",
    pitch: "The grimoire pick — old-book warmth, italics with character.",
    displayVar: "var(--font-eb-garamond)",
    displayFallback: "'EB Garamond', Garamond, 'Times New Roman', serif",
    displayLineHeight: 1.15,
    heroSize: "clamp(3.5rem, 8vw, 6rem)",
    h1Size: "clamp(2rem, 4vw, 3rem)",
    h2Size: "clamp(1.375rem, 2.5vw, 1.75rem)",
  },
  {
    slug: "instrument-serif",
    rank: "🥈",
    name: "Instrument Serif",
    pitch: "The editorial-witch pick — high-contrast, swoon italics.",
    displayVar: "var(--font-instrument-serif)",
    displayFallback: "'Instrument Serif', Garamond, serif",
    displayLineHeight: 1.1,
    heroSize: "clamp(4rem, 9vw, 7rem)",
    h1Size: "clamp(2.25rem, 4.5vw, 3.5rem)",
    h2Size: "clamp(1.5rem, 2.75vw, 2rem)",
  },
  {
    slug: "fraunces",
    rank: "🥉",
    name: "Fraunces",
    pitch: "The shapeshifter — variable optical + wonk axes.",
    displayVar: "var(--font-fraunces)",
    displayFallback: "'Fraunces', Georgia, serif",
    displayLineHeight: 1.15,
    heroSize: "clamp(3.5rem, 8vw, 6rem)",
    h1Size: "clamp(2rem, 4vw, 3rem)",
    h2Size: "clamp(1.375rem, 2.5vw, 1.75rem)",
  },
];

function CandidateCard({ candidate }: { candidate: Candidate }) {
  const displayFamily = `${candidate.displayVar}, ${candidate.displayFallback}`;
  return (
    <section
      data-preview-card={candidate.slug}
      style={{
        border: "1px solid var(--border-subtle, rgba(154, 142, 205, 0.24))",
        borderRadius: 16,
        padding: "clamp(1.5rem, 3vw, 2.5rem)",
        background: "var(--surface-0, #0f0a14)",
        color: "var(--text-primary, #f4f1fa)",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 12,
          marginBottom: "1.5rem",
          paddingBottom: "1rem",
          borderBottom: "1px solid var(--border-subtle, rgba(154, 142, 205, 0.18))",
          flexWrap: "wrap",
        }}
      >
        <span aria-hidden style={{ fontSize: 22 }}>{candidate.rank}</span>
        <h3
          style={{
            margin: 0,
            fontFamily: displayFamily,
            fontSize: "1.5rem",
            fontWeight: 500,
            letterSpacing: "-0.01em",
          }}
        >
          {candidate.name}
        </h3>
        <span
          style={{
            fontSize: 13,
            color: "var(--text-muted, #9a8ecd)",
            fontFamily: "var(--font-sans), system-ui, sans-serif",
          }}
        >
          {candidate.pitch}
        </span>
      </header>

      <div
        style={{
          fontFamily: displayFamily,
          fontSize: candidate.heroSize,
          lineHeight: candidate.displayLineHeight,
          letterSpacing: "-0.02em",
          fontWeight: 500,
          margin: 0,
        }}
      >
        {SAMPLE_HERO}
      </div>

      <p
        style={{
          fontFamily: "var(--font-sans), system-ui, sans-serif",
          fontSize: "clamp(1rem, 1.4vw, 1.125rem)",
          lineHeight: 1.55,
          color: "var(--text-muted, #c5bded)",
          marginTop: "0.75rem",
          marginBottom: "2rem",
          maxWidth: "44ch",
        }}
      >
        {SAMPLE_TAGLINE}
      </p>

      <h1
        style={{
          fontFamily: displayFamily,
          fontSize: candidate.h1Size,
          lineHeight: candidate.displayLineHeight,
          letterSpacing: "-0.015em",
          fontWeight: 500,
          margin: "0 0 0.75rem",
        }}
      >
        {SAMPLE_H1}
      </h1>

      <h2
        style={{
          fontFamily: displayFamily,
          fontSize: candidate.h2Size,
          lineHeight: 1.2,
          fontStyle: "italic",
          fontWeight: 400,
          margin: "0 0 1.25rem",
          color: "var(--text-muted, #c5bded)",
        }}
      >
        {SAMPLE_H2}
      </h2>

      <p
        style={{
          fontFamily: "var(--font-sans), system-ui, sans-serif",
          fontSize: "1rem",
          lineHeight: 1.65,
          maxWidth: "62ch",
          margin: "0 0 1.5rem",
        }}
      >
        {SAMPLE_BODY}
      </p>

      <blockquote
        style={{
          fontFamily: displayFamily,
          fontSize: "clamp(1.125rem, 1.75vw, 1.375rem)",
          fontStyle: "italic",
          lineHeight: 1.4,
          margin: "0 0 1.5rem",
          padding: "0.5rem 0 0.5rem 1.25rem",
          borderLeft: "2px solid var(--oc-purple-primary, #9a8ecd)",
          color: "var(--text-primary, #f4f1fa)",
          maxWidth: "48ch",
        }}
      >
        “{SAMPLE_QUOTE}”
      </blockquote>

      <div
        style={{
          display: "flex",
          gap: 16,
          flexWrap: "wrap",
          alignItems: "baseline",
          paddingTop: "1rem",
          borderTop: "1px solid var(--border-subtle, rgba(154, 142, 205, 0.18))",
        }}
      >
        <span
          style={{
            fontFamily: displayFamily,
            fontStyle: "italic",
            fontSize: "1.5rem",
          }}
        >
          {SAMPLE_ITALIC}
        </span>
        <span
          style={{
            fontFamily: "var(--font-mono), ui-monospace, monospace",
            fontSize: 12,
            color: "var(--text-muted, #9a8ecd)",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
          }}
        >
          {SAMPLE_META}
        </span>
      </div>
    </section>
  );
}

export default function FontPreviewPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        background: "var(--surface-app, #000)",
        color: "var(--text-primary, #f4f1fa)",
        padding: "clamp(2rem, 5vw, 4rem)",
      }}
    >
      <div style={{ maxWidth: 1080, margin: "0 auto" }}>
        <header style={{ marginBottom: "3rem" }}>
          <p
            style={{
              fontFamily: "var(--font-mono), ui-monospace, monospace",
              fontSize: 12,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: "var(--oc-purple-primary, #9a8ecd)",
              margin: "0 0 0.75rem",
            }}
          >
            Charm · Font Preview · Classic Coven
          </p>
          <h1
            style={{
              fontFamily: "var(--font-sans), system-ui, sans-serif",
              fontSize: "clamp(2rem, 3.5vw, 2.75rem)",
              lineHeight: 1.15,
              letterSpacing: "-0.02em",
              margin: "0 0 0.75rem",
              fontWeight: 600,
            }}
          >
            Three display serifs, one Coven.
          </h1>
          <p
            style={{
              fontFamily: "var(--font-sans), system-ui, sans-serif",
              fontSize: "1.05rem",
              lineHeight: 1.6,
              color: "var(--text-muted, #c5bded)",
              maxWidth: "58ch",
              margin: 0,
            }}
          >
            Each card renders the same Coven copy in a different display face.
            Body text stays on the current sans stack so the pairing is honest.
            Pick the one that feels most like the Coven, and we&rsquo;ll canonize
            it across <code style={{ fontFamily: "var(--font-mono)" }}>DESIGN.md</code>,
            Cave, and every downstream surface.
          </p>
        </header>

        <div style={{ display: "grid", gap: "2rem" }}>
          {CANDIDATES.map((c) => (
            <CandidateCard key={c.slug} candidate={c} />
          ))}
        </div>

        <footer
          style={{
            marginTop: "3rem",
            paddingTop: "1.5rem",
            borderTop: "1px solid var(--border-subtle, rgba(154, 142, 205, 0.18))",
            fontFamily: "var(--font-mono), ui-monospace, monospace",
            fontSize: 12,
            color: "var(--text-muted, #9a8ecd)",
            letterSpacing: "0.04em",
          }}
        >
          Delete this route once a winner is chosen. See branch{" "}
          <span style={{ color: "var(--text-primary, #f4f1fa)" }}>
            charm/font-preview-classic-coven
          </span>
          .
        </footer>
      </div>
    </main>
  );
}
