import { EmptyState } from "@/components/ui/empty-state";
import { SearchInput } from "@/components/ui/search-input";
import {
  AUTOMATION_TEMPLATES,
  TEMPLATE_CATEGORIES,
  type AutomationTemplate,
} from "@/lib/automation-templates";

type TemplatesPanelProps = {
  query: string;
  onQueryChange: (query: string) => void;
  onSelect: (template: AutomationTemplate) => void;
};

/** Template browsing is intentionally self-contained: filtering and category
 * rendering stay beside the catalogue contract rather than the Rituals shell. */
export function TemplatesPanel({ query, onQueryChange, onSelect }: TemplatesPanelProps) {
  const normalizedQuery = query.toLowerCase().trim();
  const filtered = normalizedQuery
    ? AUTOMATION_TEMPLATES.filter(
        (template) => template.title.toLowerCase().includes(normalizedQuery) || template.scheduleLabel.toLowerCase().includes(normalizedQuery),
      )
    : AUTOMATION_TEMPLATES;
  const categories = TEMPLATE_CATEGORIES.map((category) => ({
    category,
    templates: filtered.filter((template) => template.category === category),
  })).filter(({ templates }) => templates.length > 0);

  return (
    <div className="automation-templates-panel">
      <div className="mb-5">
        <SearchInput
          value={query}
          onValueChange={onQueryChange}
          onClear={() => onQueryChange("")}
          placeholder="Search templates…"
          aria-label="Search templates"
        />
      </div>
      {categories.length === 0 ? (
        <EmptyState className="mt-8" icon="ph:magnifying-glass" headline={`No templates match "${query.trim()}"`} subtitle="Try a different search term." />
      ) : (
        categories.map(({ category, templates }) => (
          <section key={category} className="mb-6">
            <h2 className="mb-3 text-[length:var(--text-xs)] font-semibold uppercase tracking-widest [color:var(--text-muted)]!">{category}</h2>
            <div className="automation-templates-grid">
              {templates.map((template) => (
                <button key={template.id} type="button" className="automation-template-card focus-ring" onClick={() => onSelect(template)}>
                  <span className="automation-template-card__emoji" aria-hidden>{template.emoji}</span>
                  <span className="automation-template-card__title">{template.title}</span>
                  <span className="automation-template-card__schedule">{template.scheduleLabel}</span>
                </button>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
